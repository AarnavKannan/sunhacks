"""Detect + track every vehicle in the bottom-right tile of demo.mp4 (frames 0..399).

Primary detector: the dataset's burned-in 3D wireframes (cyan=car, yellow=van, green=truck).
1. Wire pixels = class chroma that differs from the median background (data/br_bg.png).
2. Every vehicle is modelled as a cuboid on the road (X, Y, yaw, L, W, H in the README world
   frame) projected with cam.py; it is fitted to the wire mask by chamfer distance. The fitted
   wireframe reproduces the burned-in one to < 1 px, so its projected bottom face = road contact.
3. Tracks: existing cuboids are re-fitted each frame from a constant-velocity world prediction
   (dims fixed per track); wire pixels nobody explains seed new tracks; tracks broken by
   misses are stitched; gaps are interpolated (src="interp", occluded=true).
Writes data/tracks_px.json and review_tracks/*.png.

Run: <venv python> detect_track.py
"""
import json, os, sys
import cv2, numpy as np
from scipy import ndimage
from scipy.optimize import minimize

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cam  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", ".."))
VIDEO = os.path.join(ROOT, "demo.mp4")
TILE = (481, 304, 479, 300)
TW, TH = TILE[2], TILE[3]
N = 400
FPS = 12.5
CLASSES = ("car", "van", "truck")
PRIOR = {"car": [(4.5, 1.8, 1.5)], "van": [(5.2, 2.0, 2.4), (6.5, 2.1, 2.8)],
         "truck": [(12.0, 2.5, 3.6), (16.5, 2.55, 3.9), (8.0, 2.4, 3.2)]}
DIM_LO = {"car": (3.2, 1.4, 1.1), "van": (4.0, 1.6, 1.7), "truck": (5.5, 2.0, 2.4)}
DIM_HI = {"car": (5.8, 2.2, 2.1), "van": (8.0, 2.4, 3.4), "truck": (20.0, 2.9, 4.6)}
EDGES = [(0, 1), (1, 2), (2, 3), (3, 0), (4, 5), (5, 6), (6, 7), (7, 4), (0, 4), (1, 5), (2, 6), (3, 7)]
TS = np.linspace(0, 1, 14)
CAP = 6.0


# ------------------------------------------------------------------ io / masks
def load_tiles():
    cap = cv2.VideoCapture(VIDEO)
    out = []
    x, y, w, h = TILE
    for _ in range(N):
        ok, f = cap.read()
        if not ok:
            break
        out.append(f[y:y + h, x:x + w].copy())
    return np.stack(out)


def chroma(img):
    img = img.astype(np.float32)
    B, G, R = img[..., 0], img[..., 1], img[..., 2]
    return (2 * R - G - B) / 2, (G - B) * 0.866


def class_masks(frame, bg_ab, thr=18.0):
    a, b = chroma(frame)
    mag, dmag = np.hypot(a, b), np.hypot(a - bg_ab[0], b - bg_ab[1])
    hue = np.degrees(np.arctan2(b, a)) % 360
    ok = (mag > thr) & (dmag > thr * 0.8)
    m = {"van": ok & (hue >= 35) & (hue < 85),
         "truck": ok & (hue >= 115) & (hue < 176),
         "car": ok & (hue >= 168) & (hue < 230)}
    m["van"][:22, :22] = False  # logo
    return m


# ------------------------------------------------------------------ cuboid model
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


def samples(P):
    return np.concatenate([P[a][None] * (1 - TS[:, None]) + P[b][None] * TS[:, None] for a, b in EDGES])


def seg_dist(pts, P):
    A = np.array([P[a] for a, _ in EDGES]); B = np.array([P[b] for _, b in EDGES])
    d = B - A
    t = np.clip(((pts[:, None, :] - A[None]) * d[None]).sum(-1) / np.maximum((d * d).sum(-1), 1e-6)[None], 0, 1)
    q = A[None] + t[..., None] * d[None]
    return np.sqrt(((pts[:, None, :] - q) ** 2).sum(-1)).min(1)


def fwd_cost(P, D):
    S = samples(P)
    inside = (S[:, 0] >= 0) & (S[:, 0] <= TW - 1) & (S[:, 1] >= 0) & (S[:, 1] <= TH - 1)
    if inside.mean() < 0.3:
        return CAP, inside.mean()
    v = ndimage.map_coordinates(D, [S[inside, 1], S[inside, 0]], order=1)
    return float(np.mean(np.minimum(v, CAP))), float(inside.mean())


def full_p(x, dims):
    return [x[0], x[1], x[2], *dims]


def bottom_top(p):
    P = corners(p)
    return P[:4], P[4:]


# ------------------------------------------------------------------ fitting
def fit_seed(cls, comp_pts, bbox, D):
    """Fit a new cuboid (6 dof) to a residual wire component."""
    x0, y0, x1, y1 = bbox
    gx, gy = cam.to_ground((x0 + x1) / 2, y1)
    gx, gy = float(gx[0]), float(gy[0])
    sub = comp_pts[np.random.default_rng(0).choice(len(comp_pts), min(160, len(comp_pts)), replace=False)]
    lo, hi = DIM_LO[cls], DIM_HI[cls]

    def cost(q):
        p = list(q)
        pen = sum(max(0, lo[i] - p[3 + i]) + max(0, p[3 + i] - hi[i]) for i in range(3)) * 5
        P = corners(p)
        if not np.all(np.isfinite(P)):
            return 99
        fc, ins = fwd_cost(P, D)
        rc = np.mean(np.minimum(seg_dist(sub, P), CAP))
        return fc + 0.7 * rc + pen

    best = None
    for dims in PRIOR[cls]:
        for k in (0.5, 0.2, 0.9):
            p0 = [gx + dims[0] * k, gy, 0.0, *dims]
            r = minimize(cost, p0, method="Nelder-Mead", options=dict(maxiter=1500, xatol=1e-3, fatol=1e-4))
            if best is None or r.fun < best.fun:
                best = r
    return list(best.x), float(best.fun)


def refit(p_pred, dims, D, yaw_free=False, prior_xy=None, w_prior=0.0):
    def cost(q):
        p = [q[0], q[1], q[2], *dims]
        P = corners(p)
        if not np.all(np.isfinite(P)):
            return 99
        c, _ = fwd_cost(P, D)
        if prior_xy is not None:
            c += w_prior * np.hypot(q[0] - prior_xy[0], (q[1] - prior_xy[1]) * 3)
        return c

    starts = [p_pred[:3]]
    if yaw_free:
        starts += [[p_pred[0], p_pred[1], p_pred[2] + d] for d in (-0.35, 0.35)]
    best = None
    for s in starts:
        r = minimize(cost, s, method="Nelder-Mead", options=dict(maxiter=400, xatol=1e-3, fatol=1e-4,
                                                                   initial_simplex=np.array(s) + np.array(
                                                                       [[0, 0, 0], [1.0, 0, 0], [0, 0.4, 0], [0, 0, 0.12]])))
        if best is None or r.fun < best.fun:
            best = r
    p = [*best.x, *dims]
    fc, ins = fwd_cost(corners(p), D)
    return p, fc, ins


def refine_dims(p, cls, D):
    lo, hi = DIM_LO[cls], DIM_HI[cls]

    def cost(q):
        pen = sum(max(0, lo[i] - q[3 + i]) + max(0, q[3 + i] - hi[i]) for i in range(3)) * 5
        P = corners(q)
        if not np.all(np.isfinite(P)):
            return 99
        return fwd_cost(P, D)[0] + pen

    r = minimize(cost, p, method="Nelder-Mead", options=dict(maxiter=1200, xatol=1e-3, fatol=1e-4))
    return list(r.x), float(r.fun)


def draw_wire(P, shape, th=3):
    m = np.zeros(shape, np.uint8)
    for a, b in EDGES:
        pa, pb = P[a], P[b]
        if not (np.all(np.isfinite(pa)) and np.all(np.isfinite(pb))):
            continue
        cv2.line(m, (int(round(pa[0])), int(round(pa[1]))), (int(round(pb[0])), int(round(pb[1]))), 1, th)
    return m.astype(bool)


def hull_mask(P, shape):
    m = np.zeros(shape, np.uint8)
    h = cv2.convexHull(np.round(P).astype(np.int32))
    cv2.fillConvexPoly(m, h, 1)
    return m.astype(bool)


# ------------------------------------------------------------------ paint
def paint_sample(frame, P, wire_any):
    c = P.mean(0)
    Q = c + (P - c) * 0.55
    m = hull_mask(Q, frame.shape[:2]) & ~ndimage.binary_dilation(wire_any, np.ones((3, 3), bool))
    px = frame[m]
    if len(px) < 8:
        return None
    return np.median(px.astype(np.float32), axis=0)


def name_colour(bgr):
    b, g, r = [float(c) for c in bgr]
    h, s, v = cv2.cvtColor(np.uint8([[[b, g, r]]]), cv2.COLOR_BGR2HSV)[0, 0].astype(int)
    if s < 50 or max(r, g, b) - min(r, g, b) < 25:
        if v > 170: return "white"
        if v > 125: return "silver"
        if v > 80: return "grey"
        return "black"
    hd = h * 2
    if hd < 15 or hd >= 340: return "red"
    if hd < 40: return "orange" if v > 120 else "brown"
    if hd < 70: return "yellow"
    if hd < 165: return "green"
    if hd < 260: return "blue"
    return "purple"


# ------------------------------------------------------------------ tracker
class Track:
    def __init__(self, tid, cls, f, p, cost):
        self.id, self.cls, self.dims = tid, cls, list(p[3:])
        self.poses = {f: list(p[:3])}
        self.costs = {f: cost}
        self.miss = 0
        self.paints = []

    @property
    def last_f(self):
        return max(self.poses)

    def predict(self, f):
        fs = sorted(self.poses)[-5:]
        x = np.array(self.poses[fs[-1]], float)
        if len(fs) >= 2:
            x0 = np.array(self.poses[fs[0]], float)
            v = (x - x0) / (fs[-1] - fs[0])
            v[2] = 0 if abs(v[2]) < 0.02 else v[2]
            x = x + v * (f - fs[-1])
        return list(x)


ACCEPT = 1.35     # mean chamfer px for a track re-fit
SEED_OK = 1.9     # seed total cost


def run_frames(tiles, bg_ab, log=print):
    tracks, live, nid = [], [], 1
    for f in range(len(tiles)):
        ms = class_masks(tiles[f], bg_ab)
        Ds = {c: ndimage.distance_transform_edt(~ms[c]) for c in CLASSES}
        wire_any = ms["car"] | ms["van"] | ms["truck"]
        explained = np.zeros(wire_any.shape, bool)
        # 1. re-fit live tracks, biggest (nearest) first
        live = [t for t in live if t.miss <= 8]
        order = sorted(live, key=lambda t: -float(np.ptp(corners([*t.predict(f), *t.dims])[:, 1])))
        for t in order:
            pred = t.predict(f)
            D = Ds[t.cls].copy()
            D[explained & ~ms[t.cls]] = CAP  # (no-op guard)
            p, fc, ins = refit(pred, t.dims, Ds[t.cls], yaw_free=True, prior_xy=pred[:2], w_prior=0.02)
            if fc < ACCEPT and ins >= 0.3:
                t.poses[f] = list(p[:3]); t.costs[f] = fc; t.miss = 0
                P = corners(p)
                explained |= draw_wire(P, wire_any.shape, 3)
                if len(t.poses) % 12 == 3 and ins > 0.95:
                    q, c2 = refine_dims(p, t.cls, Ds[t.cls])
                    if c2 < fc:
                        t.dims = [0.6 * a + 0.4 * b for a, b in zip(t.dims, q[3:])]
                if ins > 0.95:
                    pc = paint_sample(tiles[f], P, wire_any)
                    if pc is not None:
                        t.paints.append(pc)
            else:
                t.miss += 1
        # 2. seed new tracks from unexplained wire pixels
        for _ in range(12):
            seeded = False
            for c in CLASSES:
                res = ms[c] & ~explained
                lab, n = ndimage.label(ndimage.binary_dilation(res, np.ones((3, 3), bool)), np.ones((3, 3), bool))
                objs = ndimage.find_objects(lab)
                cand = []
                for i, sl in enumerate(objs, 1):
                    reg = (lab[sl] == i) & res[sl]
                    cnt = int(reg.sum())
                    w, h = sl[1].stop - sl[1].start, sl[0].stop - sl[0].start
                    if cnt < 22 or w < 6 or h < 6:
                        continue
                    cand.append((cnt, i, sl, reg))
                cand.sort(key=lambda z: -z[0])
                for cnt, i, sl, reg in cand[:6]:
                    ys, xs = np.nonzero(reg)
                    pts = np.stack([xs + sl[1].start, ys + sl[0].start], 1).astype(float)
                    bbox = (sl[1].start, sl[0].start, sl[1].stop - 1, sl[0].stop - 1)
                    p, cost = fit_seed(c, pts, bbox, Ds[c])
                    P = corners(p)
                    fc, ins = fwd_cost(P, Ds[c])
                    wm = draw_wire(P, wire_any.shape, 3)
                    cover = (wm & reg_full(reg, sl, wire_any.shape)).sum() / max(1, cnt)
                    if cost < SEED_OK and fc < ACCEPT and cover > 0.35:
                        t = Track(nid, c, f, p, fc); nid += 1
                        tracks.append(t); live.append(t)
                        explained |= wm
                        seeded = True
                    else:
                        explained |= reg_full(reg, sl, wire_any.shape)  # give up on this blob this frame
            if not seeded:
                break
        if f % 25 == 0:
            log(f"f={f} live={sum(1 for t in live if t.miss == 0)} total={len(tracks)}")
    return tracks


def reg_full(reg, sl, shape):
    m = np.zeros(shape, bool)
    m[sl] = reg
    return m


def stitch(tracks):
    """Join a track that ends with one that starts shortly after at the predicted place."""
    tracks = sorted(tracks, key=lambda t: min(t.poses))
    merged = True
    while merged:
        merged = False
        for a in tracks:
            for b in tracks:
                if a is b or b.cls != a.cls or min(b.poses) <= a.last_f or min(b.poses) - a.last_f > 25:
                    continue
                pa = a.predict(min(b.poses))
                pb = b.poses[min(b.poses)]
                if np.hypot(pa[0] - pb[0], (pa[1] - pb[1]) * 3) < max(3.0, 0.08 * abs(pb[0])):
                    a.poses.update(b.poses); a.costs.update(b.costs); a.paints += b.paints
                    tracks.remove(b); merged = True
                    break
            if merged:
                break
    return tracks


def pose_at(t, f):
    fs = sorted(t.poses)
    if f in t.poses:
        return t.poses[f], False
    a = max(g for g in fs if g < f); b = min(g for g in fs if g > f)
    w = (f - a) / (b - a)
    pa, pb = np.array(t.poses[a]), np.array(t.poses[b])
    d = pb - pa
    d[2] = (d[2] + np.pi) % (2 * np.pi) - np.pi
    return list(pa + w * d), True


def main():
    tiles = load_tiles()
    if len(sys.argv) > 1:
        tiles = tiles[:int(sys.argv[1])]
    bg = cv2.imread(os.path.join(HERE, "data", "br_bg.png"))
    tracks = run_frames(tiles, chroma(bg))
    tracks = [t for t in tracks if len(t.poses) >= 4]
    tracks = stitch(tracks)
    out = build_output(tracks, tiles)
    with open(os.path.join(HERE, "data", "tracks_px.json"), "w") as fh:
        json.dump(out, fh)
    review(tiles, out["tracks"])
    print("tracks", len(out["tracks"]))


def build_output(tracks, tiles):
    out_tracks = []
    for k, t in enumerate(sorted(tracks, key=lambda t: (min(t.poses), t.id))):
        fs = sorted(t.poses)
        # heading: align yaw with motion (+X away from camera), yaw mod pi otherwise ambiguous
        dx = t.poses[fs[-1]][0] - t.poses[fs[0]][0]
        frames = []
        for f in range(fs[0], fs[-1] + 1):
            x, interp = pose_at(t, f)
            yaw = x[2]
            if dx < 0 and np.cos(yaw) > 0:
                yaw += np.pi
            elif dx >= 0 and np.cos(yaw) < 0:
                yaw -= np.pi
            yaw = (yaw + np.pi) % (2 * np.pi) - np.pi
            p = [x[0], x[1], yaw, *t.dims]
            P = corners(p)
            bb = [float(P[:, 0].min()), float(P[:, 1].min()), float(P[:, 0].max()), float(P[:, 1].max())]
            bb = [max(0.0, bb[0]), max(0.0, bb[1]), min(TW - 1.0, bb[2]), min(TH - 1.0, bb[3])]
            frames.append({"f": f, "bbox": [round(v, 1) for v in bb],
                           "bottom": [[round(float(u), 2), round(float(v), 2)] for u, v in P[:4]],
                           "top": [[round(float(u), 2), round(float(v), 2)] for u, v in P[4:]],
                           "src": "interp" if interp else "wire", "occluded": bool(interp),
                           "fit_px": None if interp else round(t.costs[f], 2),
                           "world": [round(float(x[0]), 3), round(float(x[1]), 3), round(float(yaw), 4)]})
        if t.paints:
            paint = np.median(np.stack(t.paints), axis=0)
        else:
            paint = np.array([128, 128, 128.0])
        out_tracks.append({"id": f"t{k + 1:03d}", "class": t.cls, "paint": name_colour(paint),
                           "paint_hex": "#%02x%02x%02x" % (int(paint[2]), int(paint[1]), int(paint[0])),
                           "role": None, "dims_m": [round(v, 3) for v in t.dims], "frames": frames})
    assign_roles(out_tracks)
    return {"fps": FPS, "frames": N, "tile": list(TILE),
            "notes": "bottom/top = projected cuboid corners (box frame +L/2+W/2, +L/2-W/2, -L/2-W/2, -L/2+W/2; "
                     "+L = heading). world = [X, Y, yaw] from cam.py at fit time (dims_m = L,W,H). "
                     "src=interp frames are interpolated cuboid poses (occluded=true). fit_px = mean chamfer px.",
            "tracks": out_tracks}


def assign_roles(tracks):
    # van: class van present at f=0 whose bbox centre is in the tile x 60..140, y 130..210 region
    best = None
    for t in tracks:
        f0 = t["frames"][0]
        if t["class"] == "van" and f0["f"] == 0:
            x0, y0, x1, y1 = f0["bbox"]
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            d = np.hypot(cx - 101, cy - 170)
            if d < 40 and (best is None or d < best[0]):
                best = (d, t)
    van = best[1] if best else None
    if van:
        van["role"] = "van"
    # yellow car: the yellow-painted car closest to the van around f=279
    best = None
    for t in tracks:
        if t is van or t["class"] != "car":
            continue
        fr = {x["f"]: x for x in t["frames"]}
        if 279 not in fr or van is None:
            continue
        vb = {x["f"]: x for x in van["frames"]}.get(279)
        if vb is None:
            continue
        a, b = fr[279]["bbox"], vb["bbox"]
        d = np.hypot((a[0] + a[2] - b[0] - b[2]) / 2, (a[1] + a[3] - b[1] - b[3]) / 2)
        score = d - (40 if t["paint"] in ("yellow", "orange") else 0)
        if best is None or score < best[0]:
            best = (score, t)
    if best:
        best[1]["role"] = "yellow"


def review(tiles, tracks, frames=(0, 100, 200, 262, 270, 280, 300, 399)):
    d = os.path.join(HERE, "review_tracks")
    os.makedirs(d, exist_ok=True)
    rng = np.random.default_rng(1)
    col = {t["id"]: tuple(int(c) for c in rng.integers(40, 255, 3)) for t in tracks}
    for f in frames:
        im = cv2.resize(tiles[f], None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
        for t in tracks:
            for fr in t["frames"]:
                if fr["f"] != f:
                    continue
                c = (0, 0, 255) if t["role"] else col[t["id"]]
                B = (np.array(fr["bottom"]) * 2).round().astype(np.int32)
                Tp = (np.array(fr["top"]) * 2).round().astype(np.int32)
                th = 2 if fr["src"] == "wire" else 1
                cv2.polylines(im, [B], True, c, th)
                cv2.polylines(im, [Tp], True, c, 1)
                for i in range(4):
                    cv2.line(im, tuple(B[i]), tuple(Tp[i]), c, 1)
                lab = t["id"][1:] + ("*" if fr["src"] == "interp" else "")
                x0, y0 = int(fr["bbox"][0] * 2), int(fr["bbox"][1] * 2)
                cv2.putText(im, lab, (x0, max(9, y0 - 2)), cv2.FONT_HERSHEY_SIMPLEX, 0.36, (0, 0, 0), 3)
                cv2.putText(im, lab, (x0, max(9, y0 - 2)), cv2.FONT_HERSHEY_SIMPLEX, 0.36, c, 1)
        cv2.putText(im, f"f={f}", (850, 590), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
        cv2.imwrite(os.path.join(d, f"f{f:03d}.png"), im)


if __name__ == "__main__":
    main()
