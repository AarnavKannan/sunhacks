"""Per-frame cuboid detection of every crash-side vehicle in the bottom-right tile (frames 0..399).

The source clip carries the dataset's burned-in 3-D wireframes (cyan = car, yellow = van,
green = truck).  Every crash-carriageway vehicle is modelled as a road-standing cuboid
(X_front, Y, yaw, L, W, H in world W, cam.py) and found by an exhaustive chamfer search:

1. Wire pixels of each class = class chroma that differs from the median background (data/br_bg.png).
2. A fixed grid of candidate cuboids (front-bottom X on ~1 px rows, Y every 0.2 m on the crash side,
   2-3 dimension templates per class, yaw 0) is projected once; every frame scores all candidates
   by mean distance-to-wire of 60 edge samples (one gather per frame).
3. Greedy acceptance in cost order: a candidate must hit wire with >= 45 % of its samples that are
   not already explained by an accepted box, and its ground footprint must not overlap an accepted
   one.  Accepted boxes are refined (X, Y, yaw, L, H; W fixed per class) by Nelder-Mead.
4. Output: data/../review_tracks/dets.json  -- per-frame detections (no identities); identities are
   built by clean_tracks.py.  Ground contact = projected bottom face of the fitted cuboid.

Run: <venv python> detect_track.py [--workers 3] [--frames 0:400]
"""
import argparse, json, os, sys, time
import cv2, numpy as np
from scipy import ndimage
from scipy.optimize import minimize

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cam  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", ".."))
VIDEO = os.path.join(ROOT, "demo_32s.mp4")
TILE = (481, 304, 479, 300)
TW, TH = TILE[2], TILE[3]
N = 400
FPS = 12.5
CAP = 4.0
OUT_DIR = os.path.join(HERE, "review_tracks")
CACHE = os.environ.get("W1_TILES", os.path.join(OUT_DIR, "tiles.npy"))

# (class, L, W, H) templates for the grid search; refinement frees L, H, yaw.
TEMPLATES = [("car", 4.3, 1.8, 1.45), ("car", 4.9, 1.85, 1.55),
             ("van", 5.2, 2.0, 2.2), ("van", 6.2, 2.05, 2.6),
             ("truck", 8.5, 2.5, 3.3), ("truck", 12.5, 2.5, 3.7), ("truck", 16.5, 2.55, 3.95)]
DIM_LO = {"car": (3.3, 1.6, 1.15), "van": (4.2, 1.8, 1.8), "truck": (6.0, 2.2, 2.6)}
DIM_HI = {"car": (5.6, 2.1, 2.0), "van": (7.5, 2.4, 3.3), "truck": (19.0, 2.7, 4.6)}
EDGES = [(0, 1), (1, 2), (2, 3), (3, 0), (4, 5), (5, 6), (6, 7), (7, 4), (0, 4), (1, 5), (2, 6), (3, 7)]
NS = 5
TS = np.linspace(0, 1, NS)
Y_GRID = np.arange(-31.0, -6.39, 0.2)


# ------------------------------------------------------------------ frames / masks
def load_tiles():
    if os.path.exists(CACHE):
        return np.load(CACHE, mmap_mode="r")
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    cap = cv2.VideoCapture(VIDEO)
    x, y, w, h = TILE
    tmp = CACHE + ".tmp.npy"
    mm = np.lib.format.open_memmap(tmp, mode="w+", dtype=np.uint8, shape=(N, h, w, 3))
    for i in range(N):
        ok, f = cap.read()
        if not ok:
            raise SystemExit(f"video ended at frame {i}")
        mm[i] = f[y:y + h, x:x + w]
    mm.flush()
    del mm
    os.replace(tmp, CACHE)
    return np.load(CACHE, mmap_mode="r")


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


# ------------------------------------------------------------------ cuboid geometry
def corners_w(Xf, Y, yaw, L, W, H):
    """World corners; Xf = X of the box front (camera side) along the box axis, centre Xf + L/2."""
    Xc = Xf + L / 2
    c, s = np.cos(yaw), np.sin(yaw)
    loc = np.array([[L / 2, W / 2], [L / 2, -W / 2], [-L / 2, -W / 2], [-L / 2, W / 2]])
    gx = Xc + c * loc[:, 0] - s * loc[:, 1]
    gy = Y + s * loc[:, 0] + c * loc[:, 1]
    return np.r_[gx, gx], np.r_[gy, gy], np.r_[np.zeros(4), np.full(4, H)]


def corners_px(p):
    u, v = cam.to_img(*corners_w(*p))
    return np.stack([u, v], 1)


def edge_samples(P):
    """P (..., 8, 2) -> (..., 12*NS, 2)."""
    A = P[..., [a for a, _ in EDGES], :]
    B = P[..., [b for _, b in EDGES], :]
    S = A[..., :, None, :] * (1 - TS[:, None]) + B[..., :, None, :] * TS[:, None]
    return S.reshape(*P.shape[:-2], len(EDGES) * NS, 2)


# ------------------------------------------------------------------ candidate grid (frame independent)
def build_grid():
    # front-bottom X rows: ~0.8 px spacing in v
    xs, X = [], 52.0
    fh = cam.f * cam.h
    while X < 1600:
        xs.append(X)
        X += max(0.08, 0.8 * X * X / fh)
    xs = np.array(xs)
    grids = []
    for ti, (cls, L, W, H) in enumerate(TEMPLATES):
        XX, YY = np.meshgrid(xs, Y_GRID, indexing="ij")
        XX, YY = XX.ravel(), YY.ravel()
        Xc = XX + L / 2
        loc = np.array([[L / 2, W / 2], [L / 2, -W / 2], [-L / 2, -W / 2], [-L / 2, W / 2]])
        gx = np.concatenate([Xc[:, None] + loc[None, :, 0]] * 2, 1)
        gy = np.concatenate([YY[:, None] + loc[None, :, 1]] * 2, 1)
        gz = np.concatenate([np.zeros((len(XX), 4)), np.full((len(XX), 4), H)], 1)
        u, v = cam.to_img(gx.ravel(), gy.ravel(), gz.ravel())
        P = np.stack([u, v], 1).reshape(len(XX), 8, 2)
        # keep candidates with the box at least partly in the tile and not hopelessly tiny
        bb0, bb1 = P.min(1), P.max(1)
        vis = (bb1[:, 0] > 0) & (bb0[:, 0] < TW - 1) & (bb1[:, 1] > 0) & (bb0[:, 1] < TH - 1)
        S = edge_samples(P[vis])
        ui, vi = np.round(S[..., 0]).astype(np.int32), np.round(S[..., 1]).astype(np.int32)
        inside = (ui >= 0) & (ui < TW) & (vi >= 0) & (vi < TH)
        idx = np.where(inside, vi * TW + ui, TW * TH).astype(np.int32)  # sentinel -> 0 cost, not counted
        frac = inside.mean(1)
        keep = frac >= 0.5
        grids.append(dict(t=ti, cls=cls, dims=(L, W, H), X=XX[vis][keep], Y=YY[vis][keep],
                          idx=idx[keep], nin=inside[keep].sum(1).astype(np.float32), P=P[vis][keep].astype(np.float32),
                          scale=np.maximum(1.0, (bb1[vis][keep][:, 1] - bb0[vis][keep][:, 1]) / 22.0).astype(np.float32)))
    return grids


# ------------------------------------------------------------------ per-frame detection
def cost_bilinear(p, D):
    P = corners_px(p)
    if not np.all(np.isfinite(P)):
        return CAP, 0.0
    S = edge_samples(P)
    ins = (S[:, 0] >= 0) & (S[:, 0] <= TW - 1) & (S[:, 1] >= 0) & (S[:, 1] <= TH - 1)
    if ins.mean() < 0.45:
        return CAP, float(ins.mean())
    v = ndimage.map_coordinates(D, [S[ins, 1], S[ins, 0]], order=1)
    return float(np.mean(np.minimum(v, CAP))), float(ins.mean())


_EA = np.array([a for a, _ in EDGES]); _EB = np.array([b for _, b in EDGES])
_SL = np.array([0.5, 0.5, -0.5, -0.5] * 2); _SW = np.array([0.5, -0.5, -0.5, 0.5] * 2)
_SZ = np.array([0, 0, 0, 0, 1, 1, 1, 1.0])


def costs_vec(Q, D):
    """Q (M, 6) cuboids (Xf, Y, yaw, L, W, H) -> mean bilinear chamfer (M,), inside fraction (M,)."""
    Xf, Y, yaw, L, W, H = [Q[:, i:i + 1] for i in range(6)]
    c, s = np.cos(yaw), np.sin(yaw)
    lx, ly = _SL * L, _SW * W
    gx = Xf + L / 2 + c * lx - s * ly
    gy = Y - cam.cy0 + s * lx + c * ly
    gz = _SZ * H - cam.h
    R = cam.R
    C0 = R[0, 0] * gx + R[0, 1] * gy + R[0, 2] * gz
    C1 = R[1, 0] * gx + R[1, 1] * gy + R[1, 2] * gz
    C2 = R[2, 0] * gx + R[2, 1] * gy + R[2, 2] * gz
    u = cam.f * C0 / C2 + cam.CX
    v = cam.f * C1 / C2 + cam.CY
    su = (u[:, _EA, None] * (1 - TS) + u[:, _EB, None] * TS).reshape(len(Q), -1)
    sv = (v[:, _EA, None] * (1 - TS) + v[:, _EB, None] * TS).reshape(len(Q), -1)
    ins = (su >= 0) & (su < TW - 1.001) & (sv >= 0) & (sv < TH - 1.001)
    suc, svc = np.clip(su, 0, TW - 1.001), np.clip(sv, 0, TH - 1.001)
    u0, v0 = suc.astype(np.int32), svc.astype(np.int32)
    du, dv = suc - u0, svc - v0
    d = (D[v0, u0] * (1 - du) * (1 - dv) + D[v0, u0 + 1] * du * (1 - dv)
         + D[v0 + 1, u0] * (1 - du) * dv + D[v0 + 1, u0 + 1] * du * dv)
    d = np.where(ins, np.minimum(d, CAP), 0.0)
    nin = ins.sum(1)
    cost = d.sum(1) / np.maximum(nin, 1)
    frac = nin / ins.shape[1]
    cost = np.where(frac < 0.45, CAP, cost)
    return cost, frac


def refine(cls, p0, D):
    """Vectorised coordinate search around the grid hit. Free Xf, Y, yaw, L, H; W fixed per template."""
    lo, hi = DIM_LO[cls], DIM_HI[cls]
    Xf, Y, yaw, L, W, H = p0
    sx = max(0.08, Xf ** 2 / (cam.f * cam.h) * 0.8)   # ~0.8 px of row
    sy = max(0.04, Xf / cam.f * 1.0)                  # ~1 px of column

    def pen(Q):
        return (np.maximum(0, lo[0] - Q[:, 3]) + np.maximum(0, Q[:, 3] - hi[0]) + np.maximum(0, lo[2] - Q[:, 5])
                + np.maximum(0, Q[:, 5] - hi[2])) * 3 + 0.2 * np.abs(Q[:, 2])

    best = np.array([Xf, Y, 0.0, L, W, H])
    bc = None
    for it, (nx, ny, ly, ll, lh) in enumerate([(2, 2, 1, 2, 1), (2, 2, 2, 1, 1), (1, 1, 1, 1, 1)]):
        sc = 1.0 if it == 0 else 0.5 if it == 1 else 0.25
        gX = best[0] + np.arange(-nx, nx + 1) * sx * sc * 1.5
        gY = best[1] + np.arange(-ny, ny + 1) * sy * sc * 1.5
        gyaw = best[2] + np.arange(-ly, ly + 1) * 0.04 * sc
        gL = best[3] + np.arange(-ll, ll + 1) * (0.35 if cls != "truck" else 1.5) * sc
        gH = best[5] + np.arange(-lh, lh + 1) * 0.2 * sc
        G = np.stack(np.meshgrid(gX, gY, gyaw, gL, gH, indexing="ij"), -1).reshape(-1, 5)
        Q = np.column_stack([G[:, 0], G[:, 1], G[:, 2], G[:, 3], np.full(len(G), W), G[:, 4]])
        c, fr = costs_vec(Q, D)
        tot = c + pen(Q)
        j = int(np.argmin(tot))
        if bc is None or tot[j] < bc:
            bc, best = tot[j], Q[j]
    c, fr = costs_vec(best[None], D)
    return tuple(float(x) for x in best), float(c[0]), float(fr[0])


def draw_wire(P, shape, th=3):
    m = np.zeros(shape, np.uint8)
    for a, b in EDGES:
        pa, pb = P[a], P[b]
        cv2.line(m, (int(round(pa[0])), int(round(pa[1]))), (int(round(pb[0])), int(round(pb[1]))), 1, th)
    return m.astype(bool)


def hull_mask(P, shape):
    m = np.zeros(shape, np.uint8)
    cv2.fillConvexPoly(m, cv2.convexHull(np.round(P).astype(np.int32)), 1)
    return m.astype(bool)


def paint_sample(frame, P, wire_any):
    c = P.mean(0)
    Q = c + (P - c) * 0.6
    m = hull_mask(Q, frame.shape[:2]) & ~ndimage.binary_dilation(wire_any, np.ones((3, 3), bool))
    px = frame[m]
    if len(px) < 6:
        return None
    return [float(x) for x in np.median(px.astype(np.float32), axis=0)]


def footprint_conflict(a, b):
    """Ground footprints overlap substantially (both boxes axis-aligned approx)."""
    ax0, ax1 = a[0], a[0] + a[3]
    bx0, bx1 = b[0], b[0] + b[3]
    ox = min(ax1, bx1) - max(ax0, bx0)
    oy = min(a[1] + a[4] / 2, b[1] + b[4] / 2) - max(a[1] - a[4] / 2, b[1] - b[4] / 2)
    return ox > 0.6 and oy > 0.5


def bbox_iou(P, Q):
    a0, a1, b0, b1 = P.min(0), P.max(0), Q.min(0), Q.max(0)
    iw, ih = min(a1[0], b1[0]) - max(a0[0], b0[0]), min(a1[1], b1[1]) - max(a0[1], b0[1])
    if iw <= 0 or ih <= 0:
        return 0.0
    i = iw * ih
    return float(i / ((a1 - a0).prod() + (b1 - b0).prod() - i))


ACCEPT = 1.25      # mean chamfer px of a grid candidate
REFINED_OK = 1.1   # mean chamfer px after refinement
SUPPORT = 0.45     # fraction of samples on not-yet-explained wire


def detect_frame(frame, bg_ab, grids):
    ms = class_masks(frame, bg_ab)
    wire_any = ms["car"] | ms["van"] | ms["truck"]
    Ds = {c: ndimage.distance_transform_edt(~ms[c]).astype(np.float32) for c in ms}
    flat = {c: np.append(np.minimum(Ds[c], CAP).ravel(), np.float32(0)) for c in Ds}
    hit = {c: np.append((Ds[c] <= 1.5).ravel(), False) for c in Ds}
    cands = []
    for gi, g in enumerate(grids):
        cost = flat[g["cls"]][g["idx"]].sum(1) / np.maximum(g["nin"], 1)
        ok = np.nonzero(cost < ACCEPT * g["scale"])[0]
        for i in ok:
            cands.append((float(cost[i] / g["scale"][i]), gi, int(i)))
    cands.sort()
    cands = cands[:6000]
    claimed = np.zeros(TH * TW + 1, bool)
    dets = []
    tried = 0
    for cost, gi, i in cands:
        g = grids[gi]
        cls = g["cls"]
        idx = g["idx"][i]
        inside = idx < TH * TW
        new = hit[cls][idx] & ~claimed[idx] & inside
        if new.sum() / max(1, inside.sum()) < SUPPORT:
            continue
        L, W, H = g["dims"]
        p0 = (float(g["X"][i]), float(g["Y"][i]), 0.0, L, W, H)
        if any(footprint_conflict(p0, d["p"]) for d in dets):
            continue
        tried += 1
        if tried > 120:
            break
        p, c, ins = refine(cls, p0, Ds[cls])
        if c > REFINED_OK * max(1.0, float(g["scale"][i]) ** 0.5):
            continue
        if any(footprint_conflict(p, d["p"]) for d in dets):
            continue
        P = corners_px(p)
        if any(d["cls"] == cls and bbox_iou(P, d["P"]) > 0.7 for d in dets):
            continue
        # support re-check with the refined box
        S = edge_samples(P)
        ui, vi = np.round(S[:, 0]).astype(int), np.round(S[:, 1]).astype(int)
        ins_m = (ui >= 0) & (ui < TW) & (vi >= 0) & (vi < TH)
        ii = np.where(ins_m, vi * TW + ui, TH * TW)
        new = hit[cls][ii] & ~claimed[ii] & ins_m
        if new.sum() / max(1, ins_m.sum()) < SUPPORT * 0.9:
            continue
        claimed[:-1] |= draw_wire(P, (TH, TW), 3).ravel()
        dets.append(dict(cls=cls, p=p, cost=c, ins=ins, grid_cost=cost, P=P))
    out = []
    for d in dets:
        P = d["P"]
        Xf, Y, yaw, L, W, H = d["p"]
        bb = [float(P[:, 0].min()), float(P[:, 1].min()), float(P[:, 0].max()), float(P[:, 1].max())]
        out.append({"class": d["cls"], "X_front": round(Xf, 3), "Xc": round(Xf + L / 2, 3), "Y": round(Y, 3),
                    "yaw": round(yaw, 4), "dims": [round(L, 3), round(W, 3), round(H, 3)],
                    "fit_px": round(d["cost"], 3), "inside": round(d["ins"], 3),
                    "bbox": [round(x, 1) for x in bb],
                    "bottom": [[round(float(a), 2), round(float(b), 2)] for a, b in P[:4]],
                    "top": [[round(float(a), 2), round(float(b), 2)] for a, b in P[4:]],
                    "paint_bgr": paint_sample(frame, P, wire_any)})
    return out


_G = {}


def _init():
    _G["tiles"] = load_tiles()
    bg = cv2.imread(os.path.join(HERE, "data", "br_bg.png"))
    _G["bg"] = chroma(bg)
    _G["grids"] = build_grid()


def _work(f):
    if not _G:
        _init()
    fr = np.ascontiguousarray(_G["tiles"][f])
    return f, detect_frame(fr, _G["bg"], _G["grids"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=1)
    ap.add_argument("--frames", default="0:400")
    ap.add_argument("--out", default=os.path.join(OUT_DIR, "dets.json"))
    ap.add_argument("--resume", action="store_true")
    a = ap.parse_args()
    lo, hi = map(int, a.frames.split(":"))
    load_tiles()
    t0 = time.time()
    res = {int(f): d for f, d in json.load(open(a.out))["frames"].items()} if a.resume and os.path.exists(a.out) else {}
    frames = [f for f in range(lo, hi) if f not in res]
    os.makedirs(os.path.dirname(a.out), exist_ok=True)

    def save():
        tmp = a.out + ".tmp"
        with open(tmp, "w") as fh:
            json.dump({"fps": FPS, "tile": list(TILE), "templates": TEMPLATES,
                       "notes": "Per-frame crash-side cuboids fitted to source wireframes; coordinates in W; bottom is on Z=0.",
                       "frames": {str(f): res[f] for f in sorted(res)}}, fh)
        os.replace(tmp, a.out)
    if a.workers > 1:
        import multiprocessing as mp
        with mp.get_context("fork").Pool(a.workers, initializer=_init) as pool:
            for f, d in pool.imap_unordered(_work, frames, chunksize=4):
                res[f] = d
                if len(res) % 25 == 0:
                    save()
                    print(f"{len(res)}/{len(frames)} frames, {time.time() - t0:.0f}s", flush=True)
    else:
        for f in frames:
            res[f] = _work(f)[1]
            if len(res) % 25 == 0:
                save()
                print(f"{len(res)}/{hi-lo} frames, {time.time() - t0:.0f}s", flush=True)
    save()
    print("done", sum(len(v) for v in res.values()), "detections", f"{time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
