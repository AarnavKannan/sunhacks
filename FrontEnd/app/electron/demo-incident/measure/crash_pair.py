"""Generate the measured crash-pair input and source reprojection review.

Run from any directory with the repository venv. Saved per-frame source fits in
review_crash/car_approach_fixed_yaw.json and van_raw.json plus the checked CAR_TURN
controls below are the measurement inputs. Output is data/crash_pair.json; source
labels, uncertainty and unresolved evidence limitations are retained explicitly.
This also provides tile-cache, wire-mask, cuboid-projection and fitting helpers.

Cuboid p = (X, Y, yaw_rad, L, W, H) in world W (README.md): (X, Y) = ground-footprint centre,
yaw = heading of the vehicle's front, 0 = +X (away from camera), pi/2 = +Y.
Wire masks are the dataset's burned-in 3D boxes (cyan = car, yellow = van) as in detect_track.py,
but WITHOUT background differencing, because the stopped van (and its wire) is part of the
temporal-median background for frames 0..290.
"""
import os, sys
import cv2, numpy as np
from scipy import ndimage
from scipy.optimize import minimize
from scipy.interpolate import PchipInterpolator
from scipy.signal import savgol_filter
import json

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cam  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", ".."))
VIDEO = os.path.join(ROOT, "demo_32s.mp4")
TILE = (481, 304, 479, 300)
TW, TH = TILE[2], TILE[3]
N = 400
FPS = 12.5
CACHE = os.environ.get("CRASH_TILE_CACHE", os.path.join(HERE, "review_crash", "_tiles"))
EDGES = [(0, 1), (1, 2), (2, 3), (3, 0), (4, 5), (5, 6), (6, 7), (7, 4), (0, 4), (1, 5), (2, 6), (3, 7)]
TS = np.linspace(0, 1, 16)
CAP = 5.0


def ensure_tiles():
    """Decode demo_32s.mp4 once; cache the crash-camera tile of every frame as PNG."""
    os.makedirs(CACHE, exist_ok=True)
    if len([n for n in os.listdir(CACHE) if n.endswith(".png")]) >= N:
        return
    cap = cv2.VideoCapture(VIDEO)
    x, y, w, h = TILE
    for i in range(N):
        ok, f = cap.read()
        if not ok:
            raise SystemExit(f"video ended at frame {i}")
        cv2.imwrite(os.path.join(CACHE, f"f{i:03d}.png"), f[y:y + h, x:x + w])


def tile(f):
    im = cv2.imread(os.path.join(CACHE, f"f{f:03d}.png"))
    if im is None:
        raise FileNotFoundError(f"tile {f}")
    return im


def chroma(img):
    img = img.astype(np.float32)
    B, G, R = img[..., 0], img[..., 1], img[..., 2]
    return (2 * R - G - B) / 2, (G - B) * 0.866


def wire_masks(img, thr=40.0):
    a, b = chroma(img)
    mag = np.hypot(a, b)
    hue = np.degrees(np.arctan2(b, a)) % 360
    ok = mag > thr
    m = {"van": ok & (hue >= 35) & (hue < 85), "car": ok & (hue >= 168) & (hue < 230)}
    m["van"][:22, :22] = False  # logo
    return m


def paint_mask(img):
    """Pale-yellow body paint of the yellow car (hue ~ 15-35 deg OpenCV/2 scale ~ 8-20, low-moderate sat)."""
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(int)
    H, S, V = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    return (H >= 10) & (H <= 28) & (S >= 45) & (V >= 110)


def corners_w(p):
    X, Y, yaw, L, W, H = p
    c, s = np.cos(yaw), np.sin(yaw)
    loc = np.array([[L / 2, W / 2], [L / 2, -W / 2], [-L / 2, -W / 2], [-L / 2, W / 2]])
    gx = X + c * loc[:, 0] - s * loc[:, 1]
    gy = Y + s * loc[:, 0] + c * loc[:, 1]
    return np.r_[gx, gx], np.r_[gy, gy], np.r_[np.zeros(4), np.full(4, H)]


def corners(p):
    u, v = cam.to_img(*corners_w(p))
    return np.stack([u, v], 1)


def footprint_w(p):
    gx, gy, _ = corners_w(p)
    return np.stack([gx[:4], gy[:4]], 1)


def edge_samples(P):
    return np.concatenate([P[a][None] * (1 - TS[:, None]) + P[b][None] * TS[:, None] for a, b in EDGES])


def dist_map(mask):
    return ndimage.distance_transform_edt(~mask).astype(np.float32)


def fwd_cost(P, D):
    S = edge_samples(P)
    inside = (S[:, 0] >= 0) & (S[:, 0] <= TW - 1) & (S[:, 1] >= 0) & (S[:, 1] <= TH - 1)
    if inside.mean() < 0.25:
        return CAP, float(inside.mean())
    v = ndimage.map_coordinates(D, [S[inside, 1], S[inside, 0]], order=1)
    return float(np.mean(np.minimum(v, CAP))), float(inside.mean())


def rev_cost(P, pts):
    """Mean distance of the given wire pixels to the projected box edges (explains the wire)."""
    if len(pts) == 0:
        return 0.0
    A = np.array([P[a] for a, _ in EDGES]); B = np.array([P[b] for _, b in EDGES])
    d = B - A
    t = np.clip(((pts[:, None, :] - A[None]) * d[None]).sum(-1) / np.maximum((d * d).sum(-1), 1e-6)[None], 0, 1)
    q = A[None] + t[..., None] * d[None]
    return float(np.mean(np.minimum(np.sqrt(((pts[:, None, :] - q) ** 2).sum(-1)).min(1), CAP)))


def fit_pose(p0, dims, D, rev_pts=None, w_rev=0.5, prior=None, w_prior=0.0, yaw_starts=(0.0,), fix_yaw=None):
    """Fit (X, Y, yaw) of a cuboid with fixed dims to a wire distance map D."""
    def cost(q):
        yaw = q[2] if fix_yaw is None else fix_yaw
        p = [q[0], q[1], yaw, *dims]
        P = corners(p)
        if not np.all(np.isfinite(P)):
            return 99.0
        c, _ = fwd_cost(P, D)
        if rev_pts is not None and w_rev > 0:
            c += w_rev * rev_cost(P, rev_pts)
        if prior is not None and w_prior > 0:
            c += w_prior * (((q[0] - prior[0]) / prior[3]) ** 2 + ((q[1] - prior[1]) / prior[4]) ** 2)
        return c

    best = None
    for dy in yaw_starts:
        s = np.array([p0[0], p0[1], p0[2] + dy])
        simplex = s + np.array([[0, 0, 0], [1.2, 0, 0], [0, 0.35, 0], [0, 0, 0.15]])
        r = minimize(cost, s, method="Nelder-Mead",
                     options=dict(maxiter=600, xatol=1e-3, fatol=1e-4, initial_simplex=simplex))
        if best is None or r.fun < best.fun:
            best = r
    q = best.x
    yaw = q[2] if fix_yaw is None else fix_yaw
    p = [q[0], q[1], yaw, *dims]
    fc, ins = fwd_cost(corners(p), D)
    return p, float(best.fun), fc, ins


def roi_mask(shape, P, margin):
    x0, y0 = np.floor(P.min(0) - margin).astype(int)
    x1, y1 = np.ceil(P.max(0) + margin).astype(int)
    m = np.zeros(shape, bool)
    m[max(0, y0):max(0, min(shape[0], y1)), max(0, x0):max(0, min(shape[1], x1))] = True
    return m


def draw_box(img, P, color, th=1, scale=1.0, bottom_only=False):
    P = P * scale
    edges = EDGES[:4] if bottom_only else EDGES
    for a, b in edges:
        pa, pb = P[a], P[b]
        if not (np.all(np.isfinite(pa)) and np.all(np.isfinite(pb))):
            continue
        cv2.line(img, (int(round(pa[0])), int(round(pa[1]))), (int(round(pb[0])), int(round(pb[1]))), color, th, cv2.LINE_AA)


def hull_mask(P, shape):
    m = np.zeros(shape, np.uint8)
    h = cv2.convexHull(np.round(P).astype(np.int32))
    cv2.fillConvexPoly(m, h, 1)
    return m.astype(bool)


def atomic_json(path, value):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + '.tmp', 'w') as out:
        json.dump(value, out, indent=1, allow_nan=False)
        out.write('\n')
    os.replace(path + '.tmp', path)


REVIEW = os.path.join(HERE, 'review_crash')
CAR_DIMS = [4.3, 1.8, 1.5]
VAN_DIMS = [5.0537455, 2.05, 2.656723]
CONTACT_FRAME = 291

# Ground-footprint centres read against the visible paint, wheel/silhouette and box
# base, rather than the image-box centre. The free wire fit drifts onto the queue
# after f288; these frame-checked controls deliberately replace that failed fit.
# Each row is f, X, Y, body heading (unwrapped degrees). Sparse controls between
# observations are explicitly interpolated, not promoted to measured samples.
CAR_TURN = [
    [266, 130.53, -15.77, 173], [270, 121.9, -15.72, 160],
    [275, 110.76, -14.29, 151], [278, 105.8, -13.43, 123],
    [280, 102.6, -12.5, 100], [282, 99.4, -11.4, 70],
    [284, 96.2, -10.0, 40], [285, 94.5, -9.5, 25],
    [286, 93.0, -9.1, 10], [288, 89.9, -9.1, -20],
    [289, 88.4, -9.4, -40], [290, 86.4, -9.7, -60],
    [291, 83.96, -9.6, -90], [292, 84.15, -9.7, -110],
    [294, 84.0, -9.8, -130], [296, 82.7, -10.0, -138],
    [300, 80.0, -10.5, -145], [305, 77.9, -10.7, -155],
    [310, 75.7, -11.2, -170], [312, 75.2, -11.55, -174],
    [314, 74.7, -11.9, -178], [316, 74.3, -12.2, -180],
    # Last visible paint/box constrains a region behind the van, not an exact
    # stop. Holding that region from f319 is an occluded-rest assumption.
    [318, 74.15, -12.65, -180], [319, 74.15, -12.65, -180],
]


def smooth(values, window=11):
    return savgol_filter(np.asarray(values), window, 2, axis=0, mode='interp')


def lane_of(y):
    lines = [-9.031, -12.673, -16.144, -19.788, -23.563, -26.846, -29.871]
    if y > lines[0]:
        return 0  # median/verge; lane occupancy itself is recorded separately
    for lane in range(1, 7):
        if y >= lines[lane]:
            return lane
    return 7


def footprint_lanes(p):
    poly = footprint_w(p)
    ymin, ymax = poly[:, 1].min(), poly[:, 1].max()
    edges = [-9.031, -12.673, -16.144, -19.788, -23.563, -26.846, -29.871]
    return [k for k in range(1, 7) if ymax >= edges[k] and ymin <= edges[k - 1]]


def make_samples(frames, poses, dims, mass, sources, sigmas, who):
    dt = 1 / FPS
    # Velocity/acceleration are finite differences of the delivered, smoothed
    # positions, so no independent speed curve can disagree with replay.
    velocity = np.gradient(poses[:, :2], dt, axis=0, edge_order=2)
    acceleration = np.gradient(velocity, dt, axis=0, edge_order=2)
    yaw_rate = np.gradient(poses[:, 2], dt, edge_order=2)
    if who == 'white-van':
        static = np.asarray(frames) <= 290
        velocity[static] = 0
        acceleration[np.asarray(frames) < 290] = 0
        yaw_rate[static] = 0
        resting = np.asarray(frames) >= 354
        velocity[resting] = acceleration[resting] = 0
        yaw_rate[resting] = 0
    else:
        resting = np.asarray(frames) >= 319
        velocity[resting] = acceleration[resting] = 0
        yaw_rate[resting] = 0
    out = []
    for i, f in enumerate(frames):
        p = [*poses[i, :2], np.deg2rad(poses[i, 2]), *dims]
        if f >= (319 if who == 'yellow-car' else 354):
            cause = 'coasting'
        elif 290 <= f <= 299:
            cause = 'impact'
        elif f > 299 or (who == 'yellow-car' and f >= 283):
            cause = 'sliding'
        elif who == 'yellow-car' and f >= 246:
            cause = 'steering'
        elif who == 'yellow-car' and f < 246:
            cause = 'other'  # far-range fit derivatives do not identify a cause
        elif np.linalg.norm(acceleration[i]) < .5:
            cause = 'coasting'
        elif who == 'yellow-car':
            cause = 'braking' if np.dot(velocity[i], acceleration[i]) < 0 else 'accelerating'
        else:
            cause = 'coasting'
        row = {'f':int(f), 't':round(f / FPS, 6), 'x':float(poses[i, 0]), 'y':float(poses[i, 1]),
               'heading_deg':float(poses[i, 2] % 360), 'speed_mps':float(np.linalg.norm(velocity[i])),
               'vx':float(velocity[i, 0]), 'vy':float(velocity[i, 1]),
               'ax':float(acceleration[i, 0]), 'ay':float(acceleration[i, 1]),
               'yaw_rate_dps':float(yaw_rate[i]), 'fx_n':float(mass * acceleration[i, 0]),
               'fy_n':float(mass * acceleration[i, 1]), 'cause':cause,
               'sigma_m':float(sigmas[i]), 'src':sources[i], 'lane':lane_of(poses[i, 1]),
               'lanes_occupied':footprint_lanes(p)}
        out.append(row)
    return out


def lane_sequence(samples):
    out = []
    for sample in samples:
        lane = sample['lane']
        if out and out[-1]['lane'] == lane:
            out[-1]['to_f'] = sample['f']
        else:
            out.append({'from_f':sample['f'], 'to_f':sample['f'], 'lane':lane,
                        'note':'Centre-based lane; see per-frame lanes_occupied for footprint straddling.'})
    return out


def measured_tracks():
    pre = json.load(open(os.path.join(REVIEW, 'car_approach_fixed_yaw.json')))
    van_raw = json.load(open(os.path.join(REVIEW, 'van_raw.json')))
    first = 151
    car_frames = np.arange(first, N)
    car_poses = np.zeros((len(car_frames), 3))
    approach = np.array([r['p'][:2] for r in pre])
    approach = smooth(approach, 15)
    # Four tiny/partially occluded detections at first identification do not
    # constrain an independent pose; extend the following short observed segment.
    trend = np.polyfit(np.arange(155, 171), approach[4:20, 0], 1)
    approach[:4, 0] = np.polyval(trend, np.arange(151, 155))
    approach[:4, 1] = np.median(approach[4:15, 1])
    # Approach fit and checked turn seed share one endpoint.
    blend = np.linspace(0, 1, 6)[:, None]
    approach[110:116] += blend * (np.asarray(CAR_TURN[0][1:3]) - approach[-1])
    car_poses[:116, :2] = approach
    approach_v = np.gradient(approach, 1 / FPS, axis=0)
    heading = np.rad2deg(np.unwrap(np.arctan2(approach_v[:, 1], approach_v[:, 0])))
    heading += 360 * round((180 - float(np.median(heading))) / 360)
    car_poses[:116, 2] = smooth(heading, 11)
    turn = np.asarray(CAR_TURN, float)
    for k in range(3):
        curve = PchipInterpolator(turn[:, 0], turn[:, k + 1])
        ff = np.clip(car_frames[115:], 266, 319)
        car_poses[115:, k] = curve(ff)
    car_src, car_sigma = [], []
    measured_turn = {int(r[0]) for r in CAR_TURN if r[0] <= 316 and r[0] != CONTACT_FRAME}
    for f, pose in zip(car_frames, car_poses):
        if f >= 319:
            src, sigma = 'occluded-rest', 3.0 + .025 * (f - 319)
        elif f >= 317:
            src, sigma = 'interpolated', 2.5
        elif f < 155:
            src, sigma = 'interpolated', 15.0
        elif f <= 266:
            src = 'measured'
            sigma = max(.4, .000035 * pose[0] ** 2)
        elif int(f) in measured_turn:
            src, sigma = 'measured', .9 if f < 278 else 1.2
        else:
            src, sigma = 'interpolated', 1.5 if f < 291 else 1.8
        car_src.append(src)
        car_sigma.append(sigma)
    car_samples = make_samples(car_frames, car_poses, CAR_DIMS, 1350, car_src, car_sigma, 'yellow-car')

    van_frames = np.arange(N)
    van_poses = np.zeros((N, 3))
    stopped = [80.56428664, -10.36844654, 180.52943482]
    van_poses[:] = stopped
    # Median fits over five adjacent source frames suppress box-line rasterisation
    # and vehicle rocking; per-frame observations remain in van_raw.json.
    knots = [[290, *stopped], [291, 80.55, -10.37, 180.8],
             [292, 80.35, -10.43, 182.0], [293, 80.0, -10.52, 184.0],
             [294, 79.5, -10.6, 185.0]]
    for f in list(range(295, 351, 5)) + [353]:
        a = np.array([r['p'][:3] for r in van_raw[max(291, f - 2):min(N, f + 3)]])
        med = np.median(a, axis=0)
        # The wire box is symmetric front/back. Keep the front toward the camera.
        knots.append([f, float(med[0]), float(med[1]), float(np.rad2deg(med[2]))])
    rest = np.median(np.array([r['p'][:3] for r in van_raw[354:]]), axis=0)
    rest[2] = np.rad2deg(rest[2])
    knots[-1][1:] = list(map(float, rest))
    # Van approaches its final pose monotonically; apparent reverse movement of
    # <0.5 m in the rasterised box is measurement noise, not an observed reversal.
    for i in range(1, len(knots)):
        knots[i][1] = min(knots[i][1], knots[i - 1][1])
    a = np.asarray(knots)
    for k in range(3):
        curve = PchipInterpolator(a[:, 0], a[:, k + 1])
        van_poses[291:, k] = curve(np.clip(van_frames[291:], 290, 353))
    van_poses[354:] = van_poses[353]
    van_src = ['measured' if f <= 290 or f in {int(k[0]) for k in knots} or f >= 354 else 'interpolated' for f in van_frames]
    van_sigma = [.25 if f <= 290 else (.65 if s == 'measured' else .9) for f, s in zip(van_frames, van_src)]
    van_samples = make_samples(van_frames, van_poses, VAN_DIMS, 2500, van_src, van_sigma, 'white-van')
    return {
        'yellow-car':{'class':'car', 'paint':'yellow', 'paint_hex':'#d1bb70', 'crash':True,
                      'length_m':CAR_DIMS[0], 'width_m':CAR_DIMS[1], 'height_m':CAR_DIMS[2],
                      'mass_kg':1350, 'samples':car_samples, 'first_reliable_identification_frame':151,
                      'last_visible_paint_frame':316, 'rest_pose_observed':False},
        'white-van':{'class':'van', 'paint':'white', 'paint_hex':'#f2f2ed', 'crash':True,
                     'length_m':VAN_DIMS[0], 'width_m':VAN_DIMS[1], 'height_m':VAN_DIMS[2],
                     'mass_kg':2500, 'samples':van_samples, 'rest_pose_observed':True}}


def build():
    vehicles = measured_tracks()
    car = {s['f']:s for s in vehicles['yellow-car']['samples']}
    van = {s['f']:s for s in vehicles['white-van']['samples']}
    dims = VAN_DIMS
    v = van[CONTACT_FRAME]
    poly = footprint_w([v['x'],v['y'],np.deg2rad(v['heading_deg']),*dims])
    rear_median = poly[np.argmax(poly[:, 0] + .1 * poly[:, 1])]
    point = list(map(float, rear_median))
    normal = [-1.0, 0.0]  # from approaching car to the rear face of the van
    van_post = np.mean([[van[f]['vx'],van[f]['vy']] for f in range(296,301)], axis=0)
    impulse = float(2500 * abs(van_post[0]))
    vehicle_contact = {'a':'yellow-car', 'b':'white-van', 'kind':'vehicle-vehicle',
                       'frame':CONTACT_FRAME, 't':CONTACT_FRAME / FPS, 'point':point,
                       'normal_W':normal, 'impulse_ns':impulse, 'source':'inferred', 'sigma_s':.08,
                       'note':'First supported rear/median-side-corner contact f291; physical touch is hidden by the van and bounded to f290-292. Van rocks at f292 then translates clearly at f293. Impulse is van mass times fitted post-impact longitudinal velocity over f296-300, including unresolved tyre forces; mass is assumed.'}
    divider_path = os.path.join(HERE,'data','divider.json')
    divider = json.load(open(divider_path))
    edge = float(divider['face_Y_crash_side'])
    first = None
    edge_point = None
    for f in range(270,291):
        s = car[f]
        fp = footprint_w([s['x'],s['y'],np.deg2rad(s['heading_deg']),*CAR_DIMS])
        if fp[:,1].max() >= edge:
            first = f
            # First intersection of a footprint edge with the observed verge edge.
            hits=[]
            for p,q in zip(fp,np.roll(fp,-1,axis=0)):
                if (p[1]-edge)*(q[1]-edge) <= 0 and abs(q[1]-p[1]) > 1e-8:
                    hits.append(p[0]+(edge-p[1])*(q[0]-p[0])/(q[1]-p[1]))
            edge_point = [float(np.mean(hits)),edge]
            break
    contacts = [vehicle_contact]
    if first is not None:
        contacts.append({'a':'yellow-car','b':'median-divider','kind':'vehicle-static',
                         'frame':first,'t':first/FPS,'point':edge_point,'normal_W':[0.0,1.0],
                         'source':'inferred','sigma_s':.16,
                         'note':'Footprint first crosses the measured soft-verge edge, supported by paint/wheel silhouette at the snow/asphalt boundary. Timing +/-2 frames; this is verge encroachment, not proof of a rigid hedge/barrier impact. Static impulse is unidentifiable and is intentionally omitted. Steering, sliding and soft-ground resistance cannot be separated from this view.'})
    evidence = [
        'Source: demo_32s.mp4, frames 0..399, 12.5 fps, exact bottom-right crop (481,304,479,300), cam.py/calib_joint.json. All coordinates, vectors and contact normals here are W.',
        'Yellow-car first reliable identity is f151 (12.08 s), initially in lane 1. It is a tiny unlabelled light vehicle in earlier distant frames, but a unique association before f151 cannot be established from this crop; the actual first in-view frame remains unresolved. No invented approach is added for f0-150. f151-154 are labelled interpolated because the first box is partially occluded/tiny.',
        'Agreement with the user: the identified yellow car approaches in lane 1, moves outward into lane 2, then turns sharply back toward lane 1/median and rotates before hitting the van rear/median-side corner. It does not follow a straight lane-2 approach throughout the clip.',
        'Qualified agreement: the outward manoeuvre passes alongside slower traffic, consistent with overtaking, but driver intent cannot be observed. A large outward-then-inward lateral swing and body rotation are clear. Repeated small wiggles before that swing are not resolved and have not been fabricated.',
        'The van is stationary at (80.564,-10.368) in lane 1 next to the median, through f290. Its constant pose was fitted to visible ground/top box corners, not an assumed lane centre. Small pre-impact raw fit drift is rasterisation/occlusion noise.',
        'First supported vehicle contact is f291 (23.28 s); hidden physical touch may fall in f290-292. Van body rocks at f292 and moves forward unmistakably by f293. The prior fallback 22.3 s contact is contradicted.',
        'The van travels about 18 m toward the camera and slightly outward, then stops near f353. It remains partially visible at the lower-left border through f399. No out-of-view van extrapolation is necessary; clipped pose uncertainty is larger.',
        'Yellow paint/side silhouette remains measurable beside the van through f316. f317-318 interpolate the last occluded turn. f319-399 hold the final constrained region behind the van with src=occluded-rest and sigma growing from 3 to 5 m. The exact resting pose/time is NOT directly measured. Continued hidden motion cannot be excluded; this retention avoids disappearance without inventing an unobserved path.',
        'W3 divider.json was checked: median-divider is a snow-covered grass verge, crash-side face Y=-8.637, X=55.5..158.875. The far-side median-barrier face is Y=-5.025. Yellow footprint/silhouette reaches the soft verge before vehicle contact. No yellow-car/far-barrier contact and no van/divider contact are supported; no such contacts are emitted.',
        'Body heading during the spin uses visible bonnet/window/side silhouette to resolve the 180-degree cuboid ambiguity. Sparse frame-checked controls, interpolated frames, and the approximate final hidden heading retain 1.2-5 m position uncertainty; precise yaw is less certain than vehicle presence.',
        'The car f291 pose is contact-constrained within the roughly 1.2 m visual position uncertainty; the actual touching surfaces are hidden. It is labelled interpolated, not an independently measured contact pose. Body heading can remain uncertain by roughly 20-40 degrees in the partially occluded spin.',
        'Van dimensions are the calibration cuboid (5.054 x 2.05 x 2.657 m). Yellow dimensions 4.3 x 1.8 x 1.5 m are class priors constrained by its unoccluded box, with roughly 0.5 m length/0.15 m width uncertainty. Masses 1350 and 2500 kg are assumptions, not video measurements; forces/impulses scale linearly with these masses.',
        'Velocity and acceleration are finite differences of the delivered frame positions; planar force equals assumed mass times acceleration. Cause labels describe the observed phase, not a measured decomposition of tyre, verge and body-contact forces. Impact impulses and peak forces are model-dependent, not sensor readings.',
        'The flat-plane camera is calibrated best at X<335 m. Early yellow-car poses extend beyond that range; at X~540 m one image row is about 16 m. Their sigma reflects this weak depth/grade constraint. Do not interpret those early acceleration fluctuations as braking events.'
    ]
    legacy = dict(vehicle_contact)
    legacy.update({'normal_deg':180.0, 'duration_s':.4,
                   'peak_force_n':max(np.hypot(s['fx_n'],s['fy_n']) for s in vehicles['white-van']['samples'] if 290 <= s['f'] <= 300)})
    result = {'fps':FPS,'vehicles':vehicles,'contact':legacy,'contacts':contacts,
              'lane_sequence':{key:lane_sequence(value['samples']) for key,value in vehicles.items()},
              'divider_edge_observed':{'id':'median-divider','face_Y_crash_side':edge,'x_range':divider['x_range'],
                                       'source':'data/divider.json, checked against source crash crops'},
              'evidence_notes':evidence}
    atomic_json(os.path.join(HERE,'data','crash_pair.json'),result)
    return result


def review(result):
    os.makedirs(os.path.join(REVIEW,'overlays'),exist_ok=True)
    tracks = {k:{s['f']:s for s in v['samples']} for k,v in result['vehicles'].items()}
    selected = sorted(set(range(270,301)) | {0,100,151,155,180,200,220,240,250,266,310,316,317,318,325,340,360,399})
    metrics = []
    for f in selected:
        raw = tile(f)
        im = cv2.resize(raw,None,fx=3,fy=3,interpolation=cv2.INTER_NEAREST)
        line_u,line_v = cam.to_img(np.linspace(55.5,158.875,100),np.full(100,result['divider_edge_observed']['face_Y_crash_side']))
        cv2.polylines(im,[np.round(np.c_[line_u,line_v]*3).astype(np.int32)],False,(60,160,60),2,cv2.LINE_AA)
        notes=[]
        for k,color in [('white-van',(70,40,250)),('yellow-car',(230,70,180))]:
            if f not in tracks[k]:
                notes.append(k+': not reliably identified')
                continue
            s = tracks[k][f]
            dims = VAN_DIMS if k=='white-van' else CAR_DIMS
            p = [s['x'],s['y'],np.deg2rad(s['heading_deg']),*dims]
            P = corners(p)
            draw_box(im,P,color,1,3)
            draw_box(im,P,color,3,3,bottom_only=True)
            u,v = cam.to_img(s['x'],s['y'])
            cv2.circle(im,(int(u[0]*3),int(v[0]*3)),4,color,-1)
            notes.append(f"{k}: {s['src']}, sigma={s['sigma_m']:.1f}m, lane={s['lane']}")
            if s['src']=='measured':
                m=wire_masks(raw)['van' if k=='white-van' else 'car']
                err,inside=fwd_cost(P,dist_map(m))
                metrics.append({'f':f,'id':k,'wire_distance_px_capped_at_5':err,'projected_edge_inside_fraction':inside,
                                'note':'One-way distance to source annotation only; occlusion/incorrect annotation and other cars can bias it. Not proof of identity or physical accuracy.'})
        # Put the legend outside the source image: the distant yellow car is only
        # a few pixels high, and an overlaid title would hide its entire approach.
        legend = np.full((88,im.shape[1],3),245,np.uint8)
        cv2.putText(legend,f'f{f:03d}, t={f/FPS:.2f}s; thick=ground footprint; green=verge edge',(8,24),0,.55,(20,20,20),1,cv2.LINE_AA)
        for i,note in enumerate(notes):
            cv2.putText(legend,note,(8,48+i*24),0,.52,(20,20,20),1,cv2.LINE_AA)
        im = np.vstack([legend,im])
        cv2.imwrite(os.path.join(REVIEW,'overlays',f'f{f:03d}.png'),im)
    sheets = [('overlays_contact_a',list(range(270,286))),
              ('overlays_contact_b',list(range(286,301))),
              ('overlays_required',[0,100,151,200,250,266,310,316,317,318,325,340,360,399])]
    for name,fs in sheets:
        ims=[cv2.resize(cv2.imread(os.path.join(REVIEW,'overlays',f'f{f:03d}.png')),(718,494)) for f in fs]
        ims += [np.zeros_like(ims[0])] * ((-len(ims)) % 4)
        cv2.imwrite(os.path.join(REVIEW,name+'.jpg'),np.vstack([np.hstack(ims[i:i+4]) for i in range(0,len(ims),4)]))
    atomic_json(os.path.join(REVIEW,'reprojection_metrics.json'),metrics)
    car=tracks['yellow-car'];van=tracks['white-van']
    def avg(track,fs):return np.mean([[track[f]['vx'],track[f]['vy']] for f in fs],axis=0)
    before=avg(car,range(284,290)); after=avg(car,range(296,302));vafter=avg(van,range(296,302))
    pairs=result['vehicles']
    report={'contact_frame':CONTACT_FRAME,'contact_time_s':CONTACT_FRAME/FPS,'contact_frame_uncertainty':1,
            'yellow_first_reliable_identification':151,'yellow_last_visible_paint':316,
            'yellow_preimpact_mean_velocity_W_mps':before.tolist(),'yellow_preimpact_mean_speed_mps':float(np.linalg.norm(before)),
            'yellow_postimpact_mean_velocity_W_mps':after.tolist(),'yellow_delta_v_W_mps':(after-before).tolist(),
            'yellow_delta_v_mps':float(np.linalg.norm(after-before)),
            'van_preimpact_speed_mps':0.0,'van_postimpact_velocity_W_mps':vafter.tolist(),
            'van_delta_v_mps':float(np.linalg.norm(vafter)),
            'van_travel_distance_m':float(sum(np.hypot(van[f]['x']-van[f-1]['x'],van[f]['y']-van[f-1]['y']) for f in range(291,N))),
            'van_final_pose_W':[van[399]['x'],van[399]['y'],van[399]['heading_deg']],
            'yellow_retained_pose_W':[car[399]['x'],car[399]['y'],car[399]['heading_deg']],
            'samples':{k:len(v['samples']) for k,v in pairs.items()},
            'source_counts':{k:{src:sum(s['src']==src for s in v['samples']) for src in sorted({s['src'] for s in v['samples']})} for k,v in pairs.items()},
            'force_identity_max_error_n':max(abs(s[force]-v['mass_kg']*s[accel]) for v in pairs.values() for s in v['samples'] for force,accel in [('fx_n','ax'),('fy_n','ay')]),
            'contacts':result['contacts'],'lane_sequence':result['lane_sequence'],
            'all_numbers_finite':all(np.isfinite(value) for v in pairs.values() for s in v['samples'] for value in s.values() if isinstance(value,(float,int))),
            'reprojection_frames':selected,
            'limitations':['Actual first in-view yellow-car frame before reliable identity f151 unresolved.',
                           'Contact surfaces hidden; f291 +/-1 frame is best supported timing.',
                           'Final yellow resting pose is an occluded retention assumption, not an observed stop.',
                           'Far-range flat-plane depth, body yaw in the spin, and clipped van fit have substantial uncertainty.',
                           'Masses/force causes/static impulse decomposition not measured.']}
    atomic_json(os.path.join(REVIEW,'report.json'),report)
    return report


if __name__=='__main__':
    ensure_tiles()
    result=build()
    report=review(result)
    print(json.dumps({k:report[k] for k in ['contact_frame','contact_time_s','samples','yellow_preimpact_mean_speed_mps','yellow_delta_v_mps','van_delta_v_mps','van_travel_distance_m','all_numbers_finite','force_identity_max_error_n']},indent=2))
