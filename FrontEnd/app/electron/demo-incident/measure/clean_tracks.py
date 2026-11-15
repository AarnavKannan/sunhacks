"""Identity-stable crash-side tracks from per-frame cuboid detections.

Input : review_tracks/dets.json   (detect_track.py; per-frame cuboids in W, no identities)
Output: data/tracks_px_clean.json (one track per physical vehicle, frames 0..399)

1. Online association (Hungarian, per frame) with a constant-velocity Kalman filter in ground
   coordinates (X along road, Y lateral).  Measurement noise follows the camera geometry:
   sigma_X ~ X^2/(f h) per pixel of row error, sigma_Y ~ X/f per pixel, so far (horizon) vehicles
   are gated loosely along the road and tightly across it.  Class must match.
2. Offline stitching: a track that ends is joined to one that starts within 60 frames if the start
   lies inside the forward prediction gate of the first and the backward gate of the second.
3. Duplicate tracks that coexist on the same ground footprint are merged; short clutter is dropped.
4. Frames inside a track's observed span without a detection are interpolated (src "interpolated",
   occluded true).  Lane index per frame from the measured painted lines (lane 1 = next to median).
5. Crash pair labelled: the stationary van in lane 1 ("white-van") and the car that runs into its
   rear around frames 280-295 ("yellow-car").  W2's crash_pair.json is authoritative for those two.

Run: <venv python> clean_tracks.py [--dets review_tracks/dets.json] [--out data/tracks_px_clean.json]
"""
import argparse, hashlib, json, math, os, sys
from collections import Counter
import cv2, numpy as np
from scipy.optimize import linear_sum_assignment, least_squares

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cam  # noqa: E402

FPS = 12.5
DT = 1 / FPS
N = 400
FH = cam.f * cam.h
LINES = cam.LINES
CRASH_LINES = [LINES[k] for k in ("L_edge_inner", "L_1_2", "L_2_3", "L_3_4", "L_4_5", "L_5_6", "L_edge_outer")]
EDGES = [(0, 1), (1, 2), (2, 3), (3, 0), (4, 5), (5, 6), (6, 7), (7, 4), (0, 4), (1, 5), (2, 6), (3, 7)]


def lane_of(Y):
    """0 = median side of the inner edge line, 1..6 = painted lanes from the median, 7 = beyond outer edge."""
    for i, yl in enumerate(CRASH_LINES):
        if Y > yl:
            return i
    return 7


def meas_sigma(X, fit=0.3):
    k = 1.0 + 1.5 * max(0.0, fit)  # px
    X = max(X, 40.0)
    return max(0.2, k * X * X / FH), max(0.08, 0.9 * k * X / cam.f)


def meas_cov(X, Y, fit=0.3):
    sx, sy = meas_sigma(X, fit)
    # Row/range error also shifts lateral position along the same camera ray.
    # Treating these as independent made one far vehicle spawn many identities.
    slope = (Y - cam.cy0) / max(X, 40.)
    return np.array([[sx*sx, slope*sx*sx],
                     [slope*sx*sx, sy*sy+(slope*sx)**2]])


# ------------------------------------------------------------------ Kalman (state X, vX, Y, vY)
class KTrack:
    _nid = 1

    def __init__(self, f, d):
        self.id = KTrack._nid
        KTrack._nid += 1
        self.cls = d["class"]
        sx, sy = meas_sigma(d["Xc"], d["fit_px"])
        self.x = np.array([d["Xc"], -18.0, d["Y"], 0.0])
        self.P = np.diag([sx ** 2, 15.0 ** 2, sy ** 2, 1.0 ** 2])
        self.P[np.ix_([0,2],[0,2])] = meas_cov(d['Xc'], d['Y'], d['fit_px'])
        self.dets = {f: d}
        self.last = f
        self.hits = 1

    def predict_to(self, f):
        if getattr(self, "_prediction_key", None) == (f, self.last):
            return self._prediction
        n = f - self.last
        x, P = self.x.copy(), self.P.copy()
        for _ in range(n):
            F = np.array([[1, DT, 0, 0], [0, 1, 0, 0], [0, 0, 1, DT], [0, 0, 0, 1]])
            qa, ql = 4.0 ** 2, 1.2 ** 2
            G = np.array([[DT ** 2 / 2, 0], [DT, 0], [0, DT ** 2 / 2], [0, DT]])
            Q = G @ np.diag([qa, ql]) @ G.T
            x = F @ x
            P = F @ P @ F.T + Q
        self._prediction_key = (f, self.last)
        self._prediction = (x, P)
        return x, P

    def gate(self, f, d):
        x, P = self.predict_to(f)
        sx, sy = meas_sigma(d["Xc"], d["fit_px"])
        S = P[np.ix_([0, 2], [0, 2])] + meas_cov(d['Xc'], d['Y'], d['fit_px'])
        r = np.array([d["Xc"] - x[0], d["Y"] - x[2]])
        # Analytic 2-D inverse avoids a LAPACK call for every candidate pair.
        det = S[0, 0] * S[1, 1] - S[0, 1] * S[1, 0]
        return float((S[1, 1] * r[0] ** 2 + S[0, 0] * r[1] ** 2
                      - (S[0, 1] + S[1, 0]) * r[0] * r[1]) / det)

    def update(self, f, d):
        x, P = self.predict_to(f)
        sx, sy = meas_sigma(d["Xc"], d["fit_px"])
        H = np.array([[1, 0, 0, 0], [0, 0, 1, 0]])
        S = H @ P @ H.T + meas_cov(d['Xc'], d['Y'], d['fit_px'])
        K = P @ H.T @ np.linalg.inv(S)
        x = x + K @ (np.array([d["Xc"], d["Y"]]) - H @ x)
        P = (np.eye(4) - K @ H) @ P
        # crash-side traffic cannot reverse: clamp away-from-camera velocity
        if x[1] > 3.0:
            x[1] = 3.0
        self.x, self.P, self.last = x, P, f
        self.dets[f] = d
        self.hits += 1


GATE = 13.8  # chi2(2) 99.9 %


def collapse_truck_parts(frames):
    """A long wireframe can be fitted separately at its front and rear face.

    Require strongly overlapping source silhouettes and nearly identical bottom
    rows, rather than merging according to uncertain world range alone.
    """
    count = 0
    for f, ds in frames.items():
        changed = True
        while changed:
            changed = False
            for i, a in enumerate(ds):
                if a['class'] != 'truck':
                    continue
                for j in range(i + 1, len(ds)):
                    b = ds[j]
                    if b['class'] != 'truck' or abs(a['Y'] - b['Y']) > 3.25:
                        continue
                    aa, bb = np.array(a['bbox']), np.array(b['bbox'])
                    wh = np.maximum(0, np.minimum(aa[2:], bb[2:]) - np.maximum(aa[:2], bb[:2]))
                    inter = float(np.prod(wh))
                    area_a, area_b = float(np.prod(aa[2:]-aa[:2])), float(np.prod(bb[2:]-bb[:2]))
                    iou = inter / max(area_a + area_b - inter, 1)
                    if iou < .44 or abs(aa[3]-bb[3]) > .25 * max(aa[3]-aa[1],bb[3]-bb[1]):
                        continue
                    target = np.r_[np.minimum(aa[:2],bb[:2]),np.maximum(aa[2:],bb[2:])]
                    W = max(a['dims'][1],b['dims'][1])
                    p0 = [(a['Xc']+b['Xc'])/2,(a['Y']+b['Y'])/2,max(a['dims'][0],b['dims'][0]),max(a['dims'][2],b['dims'][2])]
                    def residual(p):
                        P=corners_px(p[0],p[1],0,p[2],W,p[3])
                        return np.r_[P.min(0),P.max(0)]-target
                    fit=least_squares(residual,p0,bounds=([40,-40,6,2.6],[1800,-6,22,4.6]),max_nfev=35)
                    X,Y,L,H=fit.x
                    P=corners_px(X,Y,0,L,W,H)
                    merged=dict(a, Xc=round(float(X),3), X_front=round(float(X-L/2),3),Y=round(float(Y),3),yaw=0.,
                        dims=[round(float(L),3),W,round(float(H),3)],
                        bottom=P[:4].round(2).tolist(),top=P[4:].round(2).tolist(),bbox=np.r_[P.min(0),P.max(0)].round(1).tolist(),
                        fit_px=round(max(a['fit_px'],b['fit_px'])+.15+float(np.mean(abs(fit.fun))),3),
                        merged_source_parts=a.get('merged_source_parts',1)+b.get('merged_source_parts',1))
                    ds[i]=merged
                    ds.pop(j)
                    count+=1
                    changed=True
                    break
                if changed:
                    break
    return count


def track_online(frames):
    live, done = [], []
    for f in range(N):
        dets = frames.get(f, [])
        live2 = []
        for t in live:
            if f - t.last > 10:
                done.append(t)
            else:
                live2.append(t)
        live = live2
        if live and dets:
            C = np.full((len(live), len(dets)), 1e6)
            for i, t in enumerate(live):
                for j, d in enumerate(dets):
                    if d["class"] != t.cls:
                        continue
                    g = t.gate(f, d)
                    if g < GATE:
                        C[i, j] = g + 0.15 * (f - t.last - 1)
            ri, ci = linear_sum_assignment(C)
            used = set()
            for i, j in zip(ri, ci):
                if C[i, j] < 1e5:
                    live[i].update(f, dets[j])
                    used.add(j)
        else:
            used = set()
        for j, d in enumerate(dets):
            if j not in used:
                live.append(KTrack(f, d))
    return done + live


# ------------------------------------------------------------------ offline stitching / merging
def fit_line(t, end, n=12):
    key = (end, n, len(t.dets))
    if key in getattr(t, "_fit_cache", {}):
        return t._fit_cache[key]
    fs = sorted(t.dets)
    sel = fs[-n:] if end else fs[:n]
    F = np.array(sel, float)
    X = np.array([t.dets[f]["Xc"] for f in sel])
    Y = np.array([t.dets[f]["Y"] for f in sel])
    w = np.array([1.0 / meas_sigma(t.dets[f]["Xc"])[0] ** 2 for f in sel])
    if len(sel) >= 3 and np.ptp(F) >= 2:
        # Weak association-only velocity prior stabilizes the very distant
        # endpoints, where one pixel can mean tens of metres of range.
        A = np.stack([np.ones_like(F), (F - F.mean()) / FPS], 1)
        precision = A.T @ (A * w[:, None]) + np.diag([0.0, 1 / 18.0 ** 2])
        rhs = A.T @ (w * X) + np.array([0.0, -18.0 / 18.0 ** 2])
        bx = np.linalg.solve(precision, rhs)
        vx = bx[1]
    else:
        vx = -18.0
    vx = min(vx, 2.0)
    f_ref = sel[-1] if end else sel[0]
    x_ref = float(np.average(X + (f_ref - F) * vx / FPS, weights=w))
    y_ref = float(np.median(Y[-4:] if end else Y[:4]))
    result = f_ref, x_ref, vx, y_ref, len(sel)
    t._fit_cache = {key: result, **{k: v for k, v in getattr(t, "_fit_cache", {}).items() if k[2] == len(t.dets)}}
    return result


def link_cost(a, b):
    fa, xa, va, ya, na = fit_line(a, True)
    fb, xb, vb, yb, nb = fit_line(b, False)
    gap = fb - fa
    if gap < 1 or gap > 20:
        return None
    if a.cls != b.cls:
        return None
    # forward from a, backward from b; compare at the midpoint
    fm = (fa + fb) / 2
    xa_m = xa + va * (fm - fa) / FPS
    xb_m = xb - vb * (fb - fm) / FPS
    sx = math.hypot(*[meas_sigma(x)[0] for x in (xa_m, xb_m)]) + 2.0 * gap / FPS * (1 + 8 / max(min(na, nb), 1))
    sy = math.hypot(*[meas_sigma(x)[1] for x in (xa_m, xb_m)]) + 0.25 + 0.6 * gap / FPS
    dv = abs(va - vb)
    c = ((xa_m - xb_m) / sx) ** 2 + ((ya - yb) / sy) ** 2 + (dv / 12.0) ** 2
    return c


def stitch(tracks):
    tracks = list(tracks)
    while True:
        best = None
        ends = sorted(tracks, key=lambda t: max(t.dets))
        for a in tracks:
            fa = max(a.dets)
            for b in tracks:
                if b is a:
                    continue
                fb = min(b.dets)
                if fb <= fa or fb - fa > 20:
                    continue
                c = link_cost(a, b)
                if c is not None and c < 4.0 and (best is None or c < best[0]):
                    best = (c, a, b)
        if best is None:
            break
        _, a, b = best
        a.dets.update(b.dets)
        a.hits += b.hits
        tracks.remove(b)
    return tracks


def merge_duplicates(tracks):
    """Two tracks that coexist on the same footprint for most of their overlap -> one."""
    changed = True
    while changed:
        changed = False
        for a in tracks:
            for b in tracks:
                if a is b or a.cls != b.cls:
                    continue
                common = sorted(set(a.dets) & set(b.dets))
                if len(common) < 2:
                    continue
                close = 0
                for f in common:
                    da, db = a.dets[f], b.dets[f]
                    # Camera depth uncertainty is not a physical overlap threshold:
                    # using 2.5*sigma_X merged real neighbors near the horizon.
                    if abs(da["Xc"] - db["Xc"]) < 0.65 * min(da["dims"][0], db["dims"][0]) and abs(da["Y"] - db["Y"]) < 0.65:
                        close += 1
                if close >= 0.7 * len(common):
                    keep, drop = (a, b) if len(a.dets) >= len(b.dets) else (b, a)
                    for f, d in drop.dets.items():
                        if f not in keep.dets or d["fit_px"] < keep.dets[f]["fit_px"]:
                            keep.dets[f] = d
                    tracks.remove(drop)
                    changed = True
                    break
            if changed:
                break
    return tracks


def merge_alternating_fragments(tracks):
    """Merge tracks which repeatedly alternate on the same source silhouette.

    Coexisting, spatially distinct measured boxes veto a merge. Interpolated
    predictions alone never establish two physical vehicles.
    """
    def box_at(t, f):
        if f in t.dets:
            return np.array(t.dets[f]['bbox'])
        fs=sorted(t.dets)
        j=np.searchsorted(fs,f)
        if j==0 or j==len(fs):
            return None
        a,b=fs[j-1:j+1];w=(f-a)/(b-a)
        return np.array(t.dets[a]['bbox'])*(1-w)+np.array(t.dets[b]['bbox'])*w
    def iou(a,b):
        size=np.maximum(0,np.minimum(a[2:],b[2:])-np.maximum(a[:2],b[:2]))
        q=float(np.prod(size))
        return q/max(float(np.prod(a[2:]-a[:2])+np.prod(b[2:]-b[:2]))-q,1)
    changed=True
    merges=0
    while changed:
        changed=False
        for i,a in enumerate(tracks):
            for b in tracks[i+1:]:
                if a.cls!=b.cls:
                    continue
                lo,hi=max(min(a.dets),min(b.dets)),min(max(a.dets),max(b.dets))
                if hi-lo<8:
                    continue
                both=sorted(set(a.dets)&set(b.dets))
                distinct=sum(iou(np.array(a.dets[f]['bbox']),np.array(b.dets[f]['bbox']))<.22 for f in both)
                if distinct>=min(3,max(1,len(both)//3)):
                    continue
                F=range(lo,hi+1,2)
                overlaps=[iou(box_at(a,f),box_at(b,f)) for f in F]
                if np.mean(np.array(overlaps)>.48)<.75:
                    continue
                keep,drop=(a,b) if len(a.dets)>=len(b.dets) else (b,a)
                for f,d in drop.dets.items():
                    if f not in keep.dets or d['fit_px']<keep.dets[f]['fit_px']:
                        keep.dets[f]=d
                tracks.remove(drop)
                merges+=1;changed=True
                break
            if changed:
                break
    return tracks,merges


# ------------------------------------------------------------------ output
def name_colour(bgr):
    b, g, r = [float(c) for c in bgr]
    h, s, v = cv2.cvtColor(np.uint8([[[b, g, r]]]), cv2.COLOR_BGR2HSV)[0, 0].astype(int)
    if s < 50 or max(r, g, b) - min(r, g, b) < 25:
        if v > 170:
            return "white"
        if v > 125:
            return "silver"
        if v > 80:
            return "grey"
        return "black"
    hd = h * 2
    if hd < 15 or hd >= 340:
        return "red"
    if hd < 40:
        return "orange" if v > 120 else "brown"
    if hd < 70:
        return "yellow"
    if hd < 165:
        return "green"
    if hd < 260:
        return "blue"
    return "purple"


def corners_px(Xc, Y, yaw, L, W, H):
    c, s = math.cos(yaw), math.sin(yaw)
    loc = np.array([[L / 2, W / 2], [L / 2, -W / 2], [-L / 2, -W / 2], [-L / 2, W / 2]])
    gx = Xc + c * loc[:, 0] - s * loc[:, 1]
    gy = Y + s * loc[:, 0] + c * loc[:, 1]
    u, v = cam.to_img(np.r_[gx, gx], np.r_[gy, gy], np.r_[np.zeros(4), np.full(4, H)])
    return np.stack([u, v], 1)


def partition_crash_pair(frames, path):
    """Reserve source detections for W2's authoritative pair before association.

    This prevents either crash vehicle's intermittent detections becoming an
    ordinary background car, or a nearby passing vehicle receiving a crash ID.
    """
    if not os.path.exists(path):
        return [], 0
    cp = json.load(open(path))
    out = []; removed = 0
    for id, t in cp['vehicles'].items():
        fs = []
        L,W,H = t['length_m'],t['width_m'],t['height_m']
        for s in t['samples']:
            f=int(s['f']);yaw=math.radians(s['heading_deg'])
            P=corners_px(s['x'],s['y'],yaw,L,W,H)
            target=np.r_[P.min(0),P.max(0)]
            best=None
            for j,d in enumerate(frames.get(f,[])):
                if d['class'] != t['class']:
                    continue
                if abs(d['Xc']-s['x'])>max(7.,s['x']*.16) or abs(d['Y']-s['y'])>2.2:
                    continue
                bb=np.array(d['bbox']);wh=np.maximum(0,np.minimum(bb[2:],target[2:])-np.maximum(bb[:2],target[:2]))
                intersection=float(np.prod(wh));iou=intersection/max(float(np.prod(bb[2:]-bb[:2])+np.prod(target[2:]-target[:2]))-intersection,1)
                threshold=.50 if s['src']!='measured' else .25
                if iou>threshold and (best is None or iou>best[0]):
                    best=(iou,j)
            if best:
                frames[f].pop(best[1]);removed+=1
            fs.append(dict(f=f,bbox=target.round(1).tolist(),bottom=P[:4].round(2).tolist(),top=P[4:].round(2).tolist(),
                           world=[round(s['x'],3),round(s['y'],3),round(yaw,4)],lane=s['lane'],
                           src=s['src'],sigma_m=s['sigma_m'],occluded=s['src']!='measured',fit_px=None))
        out.append(dict(id=id,**{k:t[k] for k in ['class','paint','paint_hex']},crash=True,
                        role='van' if id=='white-van' else 'yellow',dims_m=[L,W,H],
                        n_measured=sum(s['src']=='measured' for s in fs),frames=fs,authoritative='crash_pair.json'))
    return out,removed


def build(tracks):
    out = []
    for t in tracks:
        fs = sorted(t.dets)
        D = [t.dets[f] for f in fs]
        near = [d for d in D if d["Xc"] < 220 and d["inside"] > 0.97] or D
        L = float(np.median([d["dims"][0] for d in near]))
        W = float(np.median([d["dims"][1] for d in near]))
        H = float(np.median([d["dims"][2] for d in near]))
        paints = [d["paint_bgr"] for d in near if d.get("paint_bgr")] or [d["paint_bgr"] for d in D if d.get("paint_bgr")]
        pb = np.median(np.array(paints), 0) if paints else np.array([128.0, 128, 128])
        frames = []
        for f in range(fs[0], fs[-1] + 1):
            if f in t.dets:
                d = t.dets[f]
                Xc, Y, yaw = d["Xc"], d["Y"], d["yaw"]
                fr = {"f": f, "bbox": d["bbox"], "bottom": d["bottom"], "top": d["top"], "src": "measured",
                      "occluded": False, "fit_px": d["fit_px"], "dims_fit": d["dims"]}
            else:
                a = max(g for g in fs if g < f)
                b = min(g for g in fs if g > f)
                w = (f - a) / (b - a)
                da, db = t.dets[a], t.dets[b]
                Xc = da["Xc"] + w * (db["Xc"] - da["Xc"])
                Y = da["Y"] + w * (db["Y"] - da["Y"])
                yaw = da["yaw"] + w * (db["yaw"] - da["yaw"])
                P = corners_px(Xc, Y, yaw, L, W, H)
                bb = [float(P[:, 0].min()), float(P[:, 1].min()), float(P[:, 0].max()), float(P[:, 1].max())]
                fr = {"f": f, "bbox": [round(x, 1) for x in bb],
                      "bottom": [[round(float(a_), 2), round(float(b_), 2)] for a_, b_ in P[:4]],
                      "top": [[round(float(a_), 2), round(float(b_), 2)] for a_, b_ in P[4:]],
                      "src": "interpolated", "occluded": True, "fit_px": None, "gap": [a, b]}
            fr["world"] = [round(float(Xc), 3), round(float(Y), 3), round(float(yaw), 4)]
            fr["lane"] = lane_of(Y)
            frames.append(fr)
        out.append({"id": None, "class": t.cls, "paint": name_colour(pb),
                    "paint_hex": "#%02x%02x%02x" % (int(pb[2]), int(pb[1]), int(pb[0])),
                    "role": None, "dims_m": [round(L, 3), round(W, 3), round(H, 3)],
                    "n_measured": len(fs), "frames": frames})
    return out


def label_crash_pair(out):
    van = None
    best = None
    for t in out:
        if t["class"] != "van":
            continue
        fr = [x for x in t["frames"] if x["src"] == "measured" and 75 < x["world"][0] < 88 and -12 < x["world"][1] < -9]
        if not fr:
            continue
        span = len(fr)
        if best is None or span > best[0]:
            best = (span, t)
    if best:
        van = best[1]
        van["role"] = "van"
        van["id"] = "white-van"
    yellow = None
    if van:
        vf = {x["f"]: x for x in van["frames"]}
        best = None
        for t in out:
            if t is van or t["class"] != "car":
                continue
            sc = []
            for x in t["frames"]:
                if 270 <= x["f"] <= 300 and x["f"] in vf:
                    dx = x["world"][0] - vf[x["f"]]["world"][0]
                    dy = x["world"][1] - vf[x["f"]]["world"][1]
                    sc.append(math.hypot(max(0.0, dx - 4.8), dy))
            if len(sc) < 3:
                continue
            s = min(sc) - (3.0 if t["paint"] in ("yellow", "orange") else 0.0)
            if best is None or s < best[0]:
                best = (s, t)
        if best and best[0] < 3.0:
            yellow = best[1]
            yellow["role"] = "yellow"
            yellow["id"] = "yellow-car"
    return van, yellow


def apply_reviewed_corrections(out, path, det_path):
    """Apply only source-reviewed identities to the exact reviewed input.

    Keep every measured fit, including simultaneous alternative fits, so merging
    a duplicate cannot erase evidence or manufacture a new position. Canonical
    measured samples take precedence over predictions. This is deliberately a
    checked case manifest, not a general overlap-based recall claim.
    """
    if not os.path.exists(path):
        return out, [], [], [], None
    review = json.load(open(path))
    if hashlib.sha256(open(det_path, 'rb').read()).hexdigest() != review['detection_sha256']:
        raise ValueError('Reviewed identity manifest does not match detection input')
    by_id = {t['id']: t for t in out}
    def observations(tracks):
        result = Counter()
        for t in tracks:
            for fr in t['frames']:
                if fr['src'] != 'measured':
                    continue
                for q in [fr] + fr.get('alternate_measurements', []):
                    evidence = {k:q[k] for k in ['f','world','bbox','bottom','top','fit_px','dims_fit','lane','occluded'] if k in q}
                    result[json.dumps(evidence,sort_keys=True,separators=(',',':'))] += 1
        return result
    before = observations(out)
    for id, expected in review['expected_track_sha256'].items():
        actual = hashlib.sha256(json.dumps(by_id[id], sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        if actual != expected:
            raise ValueError(f'Reviewed identity signature changed: {id}; inspect before applying')
    audit = []
    partial_unassigned = []
    for edit in review['merges']:
        keep = by_id[edit['keep']]
        members = [by_id[id] for id in [edit['keep']] + edit['merge']]
        for index, member in enumerate(members):
            cutoff = edit.get('measurement_frame_max', {}).get(member['id'])
            if cutoff is not None:
                remainder = [fr for fr in member['frames'] if fr['f'] > cutoff]
                if remainder:
                    partial_unassigned.append(dict(member, frames=remainder,
                        n_measured=sum(fr['src']=='measured' for fr in remainder),
                        exclusion_kind='unassigned-association',
                        exclusion_reason=edit['partial_exclusion_reason'], review_evidence=edit['evidence']))
                members[index] = dict(member, frames=[fr for fr in member['frames'] if fr['f'] <= cutoff])
        priority = edit.get('priority', [edit['keep']] + edit['merge'])
        members.sort(key=lambda t: priority.index(t['id']))
        candidates = {}
        for t in members:
            for fr in t['frames']:
                if fr['src'] == 'measured':
                    candidates.setdefault(fr['f'], []).append((t['id'], fr))
        fs = sorted(candidates)
        measured = {}
        for f, choices in candidates.items():
            origin, fr = choices[0]
            fr = dict(fr, measurement_track_id=origin)
            if len(choices) > 1:
                fr['alternate_measurements'] = [dict(q, measurement_track_id=id) for id, q in choices[1:]]
            measured[f] = fr
        L, W, H = keep['dims_m']
        frames = []
        for f in range(fs[0], fs[-1] + 1):
            if f in measured:
                frames.append(measured[f])
                continue
            j = int(np.searchsorted(fs, f)); a, b = fs[j-1], fs[j]
            weight = (f-a)/(b-a)
            pose = np.array(measured[a]['world'])*(1-weight)+np.array(measured[b]['world'])*weight
            P = corners_px(*pose, L, W, H)
            frames.append(dict(f=f, world=pose.round(3).tolist(), lane=lane_of(pose[1]),
                bbox=np.r_[P.min(0), P.max(0)].round(1).tolist(), bottom=P[:4].round(2).tolist(),
                top=P[4:].round(2).tolist(), src='interpolated', occluded=True, fit_px=None, gap=[a,b]))
        keep.update(frames=frames, n_measured=len(fs), merged_track_ids=edit['merge'],
                    identity_review=edit['reason'])
        for id in edit['merge']:
            by_id.pop(id)
        audit.append(dict(keep=keep['id'], merged=edit['merge'], frames=[fs[0],fs[-1]],
                          measured_fits=sum(len(v) for v in candidates.values()), unique_measured_frames=len(fs)))
    reserved = []
    for edit in review['reservations']:
        t = by_id.pop(edit['id'])
        reserved.append(dict(t, physical_id=edit['physical_id'], reservation_reason=edit['reason'],
                             review_evidence=edit['evidence']))
    parts = partial_unassigned
    for edit in review.get('suppressed_parts', []):
        t = by_id.pop(edit['id'])
        parts.append(dict(t, exclusion_reason=edit['reason'], review_evidence=edit['evidence']))
    result = [t for t in out if t['id'] in by_id]
    after = observations(result + reserved + parts)
    if before != after:
        raise AssertionError('Identity review changed or lost a measured source observation')
    conservation = dict(measured_fits_before=sum(before.values()), measured_fits_after=sum(after.values()),
                        exact_measured_evidence_multiset_preserved=True)
    return result, audit, reserved, parts, conservation


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dets", default=os.path.join(HERE, "review_tracks", "dets.json"))
    ap.add_argument("--out", default=os.path.join(HERE, "data", "tracks_px_clean.json"))
    ap.add_argument("--min-hits", type=int, default=4)
    ap.add_argument("--crash-pair", default=os.path.join(HERE,"data","crash_pair.json"))
    ap.add_argument("--identity-review", default=os.path.join(HERE,"review_tracks","identity_corrections.json"))
    a = ap.parse_args()
    D = json.load(open(a.dets))
    frames = {int(f): v for f, v in D["frames"].items()}
    ndet = sum(len(v) for v in frames.values())
    n_parts = collapse_truck_parts(frames)
    pair, n_reserved = partition_crash_pair(frames,a.crash_pair)
    tr = track_online(frames)
    n0 = len(tr)
    tr = [t for t in tr if len(t.dets) >= 2]
    tr = stitch(tr)
    n1 = len(tr)
    tr = merge_duplicates(tr)
    tr, n_alternating = merge_alternating_fragments(tr)
    n2 = len(tr)
    tr = stitch(tr)
    # clutter: very short tracks
    tr = [t for t in tr if len(t.dets) >= a.min_hits]
    out = build(sorted(tr, key=lambda t: (min(t.dets), t.dets[min(t.dets)]["Xc"])))
    if pair:
        out.extend(pair)
        van=next((t for t in pair if t['id']=='white-van'),None)
        yellow=next((t for t in pair if t['id']=='yellow-car'),None)
    else:
        van, yellow = label_crash_pair(out)
    k = 0
    for t in out:
        if t["id"] is None:
            k += 1
            t["id"] = f"c{k:03d}"
    out, reviewed_merges, reserved, parts, conservation = apply_reviewed_corrections(out, a.identity_review, a.dets)
    res = {"fps": FPS, "frames": N, "tile": D["tile"],
           "source_sha256": {"detections": hashlib.sha256(open(a.dets,'rb').read()).hexdigest(),
                             "identity_review": hashlib.sha256(open(a.identity_review,'rb').read()).hexdigest() if os.path.exists(a.identity_review) else None,
                             "crash_pair": hashlib.sha256(open(a.crash_pair,'rb').read()).hexdigest() if os.path.exists(a.crash_pair) else None},
           "notes": "Crash-side tracks only (opposing carriageway omitted). bottom/top = projected cuboid corners "
                    "(box frame +L/2+W/2, +L/2-W/2, -L/2-W/2, -L/2+W/2; +L = +X). world = [Xc, Y, yaw] in W (cam.py). "
                    "src measured = fitted to the burned-in wireframe in that frame; interpolated = linear between the "
                    "measured frames in 'gap' (occluded or missed). lane: 1 = next to the median ... 6 = outermost, "
                    "0 = median side of the inner edge line, 7 = outside the outer edge line.",
           "stats": {"detections": ndet, "collapsed_truck_parts": n_parts, "crash_pair_detections_reserved": n_reserved, "online_tracks": n0, "after_stitch": n1, "alternating_fragments_merged": n_alternating, "after_merge": n2, "final": len(out)},
           "reviewed_identity_merges": reviewed_merges,
           "reserved_crash_silhouette_tracks": reserved,
           "excluded_source_part_tracks": parts,
           "identity_review_conservation": conservation,
           "tracks": out}
    tmp = a.out + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(res, fh)
    os.replace(tmp, a.out)
    print(res["stats"], "van", van and van["id"], "yellow", yellow and (yellow["id"], yellow["paint"]))


if __name__ == "__main__":
    main()
