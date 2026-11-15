"""Per-frame pixel tracks -> metric world trajectories, kinematics and forces (frame W).

Usage: python world_kinematics.py [--in data/tracks_px.json] [--out data/tracks_world.json] [--review review_world]
Method: ground back-projection via cam.to_ground (bottom corners if present, else bbox bottom-edge
contact point + class offset), per-track 2-D constant-acceleration Kalman/RTS smoother with full
camera-derived measurement covariance, innovation-gated outliers, and adaptive event detection that
injects velocity/acceleration jump noise (impact, hard braking) so sudden events are not smoothed away.
"""
import argparse, json, math, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cam  # noqa: E402

FPS = 12.5
DT = 1.0 / FPS
TILE_W, TILE_H = 479, 300
IMPACT_F = 279          # 22.3 s
PIX_SIG = 1.5           # bbox edge noise (px)

# class priors: length, width, height, length sigma, contact overhang (bbox bottom = nearest tyre contact)
PRIOR = {
    "car":   dict(L=4.6, W=1.85, H=1.5, sL=0.4, oh=0.85, m=1450.0),
    "van":   dict(L=5.4, W=2.05, H=2.3, sL=0.5, oh=0.95, m=2600.0),
    "truck": dict(L=14.0, W=2.5, H=3.8, sL=2.0, oh=1.4, m=18000.0),
    "bus":   dict(L=12.0, W=2.55, H=3.2, sL=1.0, oh=2.5, m=13000.0),
}
LRANGE = {"car": (3.6, 5.6), "van": (4.4, 7.0), "truck": (7.0, 20.0), "bus": (9.0, 15.0)}


def cls_key(c):
    c = (c or "car").lower()
    for k in PRIOR:
        if k in c:
            return k
    if c in ("suv", "sedan", "pickup", "hatchback"):
        return "car"
    if c in ("lorry", "semi", "hgv", "trailer"):
        return "truck"
    return "car"


def mass_for(k, L):
    if k == "truck":
        return float(np.clip(18000.0 * (L / 14.0) ** 2, 12000.0, 40000.0))
    return PRIOR[k]["m"]


def ground(u, v):
    X, Y = cam.to_ground(np.asarray(u, float), np.asarray(v, float))
    return np.stack([X, Y], -1)


def ground_jac(u, v, e=0.5):
    gu = (ground(u + e, v) - ground(u - e, v)) / (2 * e)
    gv = (ground(u, v + e) - ground(u, v - e)) / (2 * e)
    return np.stack([gu, gv], -1)  # (..., 2 [X,Y], 2 [u,v])


# ---------------------------------------------------------------- measurement
def measure_frame(fr, k, axis_dir):
    """Return (z[2], R[2x2], meas_len, meas_wid, src) or None. axis_dir: unit vector pointing away from camera along vehicle."""
    pr = PRIOR[k]
    bot = fr.get("bottom")
    if bot and len(bot) == 4 and all(p is not None for p in bot):
        P = np.array(bot, float)
        if np.all(P[:, 1] > 12):
            G = ground(P[:, 0], P[:, 1])
            c = G.mean(0)
            J = np.array([ground_jac(p[0], p[1])[0] for p in P])
            R = sum(j @ j.T for j in J) * PIX_SIG ** 2 / 16.0 * 2.0  # corner errors partly correlated
            e = [np.linalg.norm(G[(i + 1) % 4] - G[i]) for i in range(4)]
            Lm, Wm = (e[0] + e[2]) / 2, (e[1] + e[3]) / 2
            if Wm > Lm:
                Lm, Wm = Wm, Lm
            return c, R + np.eye(2) * 0.05 ** 2, Lm, Wm, "corners"
    bb = fr.get("bbox")
    if not bb:
        return None
    x0, y0, x1, y1 = map(float, bb)
    um, vb = (x0 + x1) / 2, y1
    if vb < 12:
        return None
    g = ground(um, vb)[0]
    J = ground_jac(um, vb)[0]
    su, sv = PIX_SIG, PIX_SIG
    cut_b = y1 >= TILE_H - 2
    cut_lr = x0 <= 1 or x1 >= TILE_W - 2
    if cut_b or cut_lr:
        fit = fit_cut_box(bb, k, axis_dir, cut_b, x0 <= 1, x1 >= TILE_W - 2)
        if fit is None:
            return None
        c, R = fit
        return c, R * (9.0 if fr.get("occluded") else 1.0), None, None, "bbox_cut"
    R = J @ np.diag([su ** 2, sv ** 2]) @ J.T
    off = pr["L"] / 2 - pr["oh"]
    c = g + axis_dir * off
    R = R + np.outer(axis_dir, axis_dir) * (pr["sL"] / 2) ** 2
    # bbox width -> width estimate (lateral extent at contact range)
    gl, gr = ground(x0, vb)[0], ground(x1, vb)[0]
    Wm = abs(gl[1] - gr[1])
    if fr.get("occluded"):
        R = R * 9.0
    return c, R, None, Wm, "bbox_cut" if (cut_b or cut_lr) else "bbox"


def fit_cut_box(bb, k, axis_dir, cut_b, cut_l, cut_r):
    """Truncated bbox: solve centre (x,y) so the prior-size silhouette matches the uncut edges."""
    from scipy.optimize import least_squares
    pr = PRIOR[k]
    keep = [i for i, cut in enumerate((cut_l, False, cut_r, cut_b)) if not cut]
    if len(keep) < 2:
        return None
    hd = math.degrees(math.atan2(axis_dir[1], axis_dir[0]))
    target = np.array(bb, float)[keep]

    def edges(p):
        uv = project_box(dict(x=p[0], y=p[1], heading_deg=hd, _cls=k), pr["L"], pr["W"], pr["H"])
        return np.array([uv[:, 0].min(), uv[:, 1].min(), uv[:, 0].max(), uv[:, 1].max()])[keep]

    v_top = bb[1]
    p0 = ground((bb[0] + bb[2]) / 2, min(bb[3], TILE_H - 1))[0]
    r = least_squares(lambda p: edges(p) - target, p0, x_scale=[5, 1])
    if not r.success:
        return None
    J = r.jac
    try:
        C = np.linalg.inv(J.T @ J) * (PIX_SIG * 2) ** 2
    except np.linalg.LinAlgError:
        return None
    # size-prior uncertainty: top edge depends on H and L
    C = C + np.outer(axis_dir, axis_dir) * (pr["sL"] / 2 + 0.5) ** 2
    if np.sqrt(np.max(np.linalg.eigvalsh(C))) > 15 or np.any(np.abs(r.fun) > 6):
        return None
    return r.x, C


# ---------------------------------------------------------------- smoother
def cv_blocks(dt):
    F1 = np.array([[1, dt, dt * dt / 2], [0, 1, dt], [0, 0, 1]])
    Q1 = np.array([[dt ** 5 / 20, dt ** 4 / 8, dt ** 3 / 6], [dt ** 4 / 8, dt ** 3 / 3, dt ** 2 / 2], [dt ** 3 / 6, dt ** 2 / 2, dt]])
    return F1, Q1


def rts(f0, n, Z, Rs, valid, qx, qy, jumps, x0):
    """State [x,vx,ax,y,vy,ay]. jumps: dict k -> (sig_v, sig_a) extra process noise entering frame k."""
    F1, Q1 = cv_blocks(DT)
    F = np.zeros((6, 6)); F[:3, :3] = F1; F[3:, 3:] = F1
    Qb = np.zeros((6, 6)); Qb[:3, :3] = Q1 * qx; Qb[3:, 3:] = Q1 * qy
    H = np.zeros((2, 6)); H[0, 0] = 1; H[1, 3] = 1
    xs_p = np.zeros((n, 6)); Ps_p = np.zeros((n, 6, 6)); xs = np.zeros((n, 6)); Ps = np.zeros((n, 6, 6))
    nis = np.full(n, np.nan); used = np.zeros(n, bool)
    x = x0.copy(); P = np.diag([25.0, 100.0, 4.0, 1.0, 4.0, 1.0])
    for k in range(n):
        if k > 0:
            Q = Qb.copy()
            if k in jumps:
                sv, sa = jumps[k]
                Q += np.diag([0, sv ** 2, sa ** 2, 0, (sv * 0.5) ** 2, (sa * 0.5) ** 2])
            x = F @ x; P = F @ P @ F.T + Q
        xs_p[k], Ps_p[k] = x, P
        if valid[k]:
            S = H @ P @ H.T + Rs[k]
            r = Z[k] - H @ x
            d2 = float(r @ np.linalg.solve(S, r))
            nis[k] = d2
            if d2 < 30.0:  # gate gross outliers (id switch, mis-detection)
                K = P @ H.T @ np.linalg.inv(S)
                x = x + K @ r; P = (np.eye(6) - K @ H) @ P
                used[k] = True
        xs[k], Ps[k] = x, P
    for k in range(n - 2, -1, -1):
        C = Ps[k] @ F.T @ np.linalg.inv(Ps_p[k + 1])
        xs[k] = xs[k] + C @ (xs[k + 1] - xs_p[k + 1])
        Ps[k] = Ps[k] + C @ (Ps[k + 1] - Ps_p[k + 1]) @ C.T
    return xs, Ps, nis, used


def detect_events(xs, Z, Rs, valid, used, existing):
    """Runs of same-sign normalized residuals (>=4 frames, |r|>2) along X or Y indicate an un-modelled jump."""
    n = len(xs)
    ev = []
    for ax, si in ((0, 0), (1, 3)):
        r = np.full(n, 0.0)
        for k in range(n):
            if valid[k] and used[k]:
                r[k] = (Z[k][ax] - xs[k][si]) / math.sqrt(Rs[k][ax, ax])
        k = 0
        while k < n:
            if abs(r[k]) > 2.0:
                s = np.sign(r[k]); j = k
                while j < n and r[j] * s > 1.0:
                    j += 1
                if j - k >= 4:
                    ev.append(max(1, k - 1))
                k = j
            else:
                k += 1
    return sorted(set(e for e in ev if e > 6 and all(abs(e - x) > 3 for x in existing)))


# ---------------------------------------------------------------- per track
def process_track(tr, fps):
    k = cls_key(tr.get("class"))
    pr = PRIOR[k]
    role = (tr.get("role") or "").lower()
    crash = role in ("van", "yellow") or bool(tr.get("crash"))
    frs = sorted([fr for fr in tr["frames"] if (fr.get("bbox") or fr.get("bottom")) and fr.get("src") != "interp"], key=lambda a: a["f"])
    if len(frs) < 2:
        return None
    f0, f1 = int(frs[0]["f"]), int(frs[-1]["f"])
    n = f1 - f0 + 1
    byf = {int(fr["f"]): fr for fr in frs}

    # pass 0: provisional direction from raw contact points
    raw = [(f, ground((fr["bbox"][0] + fr["bbox"][2]) / 2, fr["bbox"][3])[0]) for f, fr in byf.items() if fr.get("bbox")]
    if len(raw) < 2:
        raw = [(f, ground(*np.mean(np.array(fr["bottom"], float), 0))[0]) for f, fr in byf.items()]
    ff = np.array([a for a, _ in raw], float); GG = np.array([b for _, b in raw])
    slope = np.polyfit(ff * DT, GG[:, 0], 1)[0] if len(ff) >= 3 else 0.0
    medY = float(np.median(GG[:, 1]))
    if abs(slope) > 1.5:
        dirn = -1.0 if slope < 0 else 1.0
    else:
        dirn = -1.0 if medY < -4.5 else 1.0
    carriageway = "crash" if dirn < 0 else "right"

    heading_vec = np.array([dirn, 0.0])
    Lmeas, Wmeas = [], []
    for it in range(2):
        Z = np.zeros((n, 2)); Rs = np.tile(np.eye(2) * 1e6, (n, 1, 1)); valid = np.zeros(n, bool); srcs = ["interp"] * n
        for i in range(n):
            fr = byf.get(f0 + i)
            if fr is None:
                continue
            hv = heading_vec if heading_vec.ndim == 1 else heading_vec[i]
            axis = hv * (1.0 if hv[0] >= 0 else -1.0)  # vehicle axis pointing away from camera
            m = measure_frame(fr, k, axis)
            if m is None:
                continue
            Z[i], Rs[i], lm, wm, srcs[i] = m
            valid[i] = True
            if it == 0:
                if lm is not None:
                    Lmeas.append((lm, 1.0 / np.trace(m[1])))
                if wm is not None and m[4] == "bbox":
                    Wmeas.append(wm)
        vi = np.where(valid)[0]
        if len(vi) < 2:
            return None
        # init velocity from LS fit over first measurements
        sel = vi[: min(len(vi), 25)]
        if len(sel) >= 4 and (sel[-1] - sel[0]) >= 4:
            from scipy.stats import theilslopes
            vx0, bx = theilslopes(Z[sel, 0], sel * DT)[:2]
            vy0, by = theilslopes(Z[sel, 1], sel * DT)[:2]
            x0 = np.array([bx, vx0, 0, by, vy0, 0])
        else:
            vx0, vy0 = dirn * (10.0 if dirn < 0 else 27.0), 0.0
            x0 = np.array([Z[vi[0], 0] - vx0 * vi[0] * DT, vx0, 0, Z[vi[0], 1], vy0, 0])
        qx, qy = (2.0, 0.3) if k == "car" or k == "van" else (0.8, 0.15)
        jumps = {}
        if crash and f0 < IMPACT_F <= f1:
            jumps[IMPACT_F - f0] = (8.0, 30.0)
        for _ in range(3):
            xs, Ps, nis, used = rts(f0, n, Z, Rs, valid, qx, qy, jumps, x0)
            new = detect_events(xs, Z, Rs, valid, used, list(jumps))
            if not new:
                break
            for e in new:
                jumps[e] = (4.0, 8.0)
        v = xs[:, [1, 4]]
        sp = np.linalg.norm(v, axis=1)
        hv = np.where(sp[:, None] > 1.0, v / np.maximum(sp, 1e-9)[:, None], np.array([dirn, 0.0]))
        heading_vec = hv
    # heading from fitted cuboid bottom corners (long axis), oriented along travel, when available
    ch = np.full(n, np.nan)
    for i in range(n):
        fr = byf.get(f0 + i)
        bot = fr.get("bottom") if fr else None
        if bot and len(bot) == 4 and all(p is not None for p in bot) and min(p[1] for p in bot) > 12:
            G = ground(np.array(bot, float)[:, 0], np.array(bot, float)[:, 1])
            e1, e2 = G[1] - G[0], G[2] - G[1]
            ax_ = e1 if np.linalg.norm(e1) >= np.linalg.norm(e2) else e2
            if ax_ @ heading_vec[i] < 0:
                ax_ = -ax_
            ch[i] = math.atan2(ax_[1], ax_[0])
    good = ~np.isnan(ch)
    heading_src = "velocity"
    if good.sum() >= max(3, 0.5 * n):
        idx = np.arange(n)
        base = np.arctan2(heading_vec[:, 1], heading_vec[:, 0])
        d = np.angle(np.exp(1j * (ch[good] - base[good])))       # corner heading relative to velocity heading
        d = np.interp(idx, idx[good], d)
        from scipy.ndimage import median_filter, uniform_filter1d
        d = uniform_filter1d(median_filter(d, 7, mode="nearest"), 5, mode="nearest")
        hh = base + d
        heading_vec = np.stack([np.cos(hh), np.sin(hh)], 1)
        heading_src = "corners"

    # dims
    if len(Lmeas) >= 5:
        a = np.array(Lmeas); o = np.argsort(a[:, 0]); cw = np.cumsum(a[o, 1]); L = float(a[o, 0][np.searchsorted(cw, cw[-1] / 2)])
    else:
        L = pr["L"]
    L = float(np.clip(L, *LRANGE[k]))
    Wd = float(np.clip(np.median(Wmeas), pr["W"] * 0.85, pr["W"] * 1.2)) if len(Wmeas) >= 5 else pr["W"]
    mass = mass_for(k, L)

    # derived
    vx, vy, ax_, ay_ = xs[:, 1], xs[:, 4], xs[:, 2], xs[:, 5]
    sp = np.hypot(vx, vy)
    hd = np.unwrap(np.arctan2(heading_vec[:, 1], heading_vec[:, 0]))
    yaw = np.gradient(hd, DT) if n > 2 else np.zeros(n)
    if n > 5:
        kern = np.ones(5) / 5
        yaw = np.convolve(np.pad(yaw, 2, mode="edge"), kern, "valid")
    ux, uy = heading_vec[:, 0], heading_vec[:, 1]
    along = ax_ * ux + ay_ * uy
    lat = -ax_ * uy + ay_ * ux
    sig_a_long = np.sqrt(np.maximum(Ps[:, 2, 2] * ux ** 2 + Ps[:, 5, 5] * uy ** 2, 1e-6))
    ev_frames = sorted(jumps)
    samples = []
    for i in range(n):
        f = f0 + i
        if crash and abs(f - IMPACT_F) <= 2:
            cause = "impact"
        elif any(abs(i - e) <= 1 for e in ev_frames) and abs(along[i]) > 3.0 and along[i] < 0:
            cause = "braking"
        elif along[i] < -max(1.0, 2 * sig_a_long[i]):
            cause = "braking"
        elif along[i] > max(0.6, 2 * sig_a_long[i]):
            cause = "accelerating"
        elif abs(lat[i]) > 0.8 or abs(yaw[i]) > 3.0:
            cause = "steering"
        else:
            cause = "coasting"
        sig = math.sqrt(max(Ps[i, 0, 0], 0) + max(Ps[i, 3, 3], 0))
        samples.append(dict(
            f=f, t=round(f / fps, 4), x=round(float(xs[i, 0]), 3), y=round(float(xs[i, 3]), 3),
            heading_deg=round(float(math.degrees(hd[i]) % 360.0), 2), speed_mps=round(float(sp[i]), 3),
            vx=round(float(vx[i]), 3), vy=round(float(vy[i]), 3), ax=round(float(ax_[i]), 3), ay=round(float(ay_[i]), 3),
            yaw_rate_dps=round(float(math.degrees(yaw[i])), 3),
            fx_n=round(float(mass * ax_[i]), 1), fy_n=round(float(mass * ay_[i]), 1),
            f_long_n=round(float(mass * along[i]), 1), f_lat_n=round(float(mass * lat[i]), 1),
            cause=cause, sigma_m=round(sig, 3),
            src=(srcs[i] if used[i] or srcs[i] == "interp" else "rejected:" + srcs[i]),
        ))
    out = dict(id=tr["id"], **{kk: tr.get(kk) for kk in ("class", "paint", "paint_hex", "role")})
    out.update(crash=crash, carriageway=carriageway, length_m=round(L, 2), width_m=round(Wd, 2),
               height_m=PRIOR[k]["H"], mass_kg=round(mass, 0), f_first=f0, f_last=f1,
               event_frames=[f0 + e for e in ev_frames], heading_src=heading_src, samples=samples)
    diag = dict(Z=Z, valid=valid, used=used, xs=xs, f0=f0, k=k)
    return out, diag


def box_corners(s, L, W):
    th = math.radians(s["heading_deg"]); c, sn = math.cos(th), math.sin(th)
    pts = []
    for dl, dw in ((1, 1), (1, -1), (-1, -1), (-1, 1)):
        pts.append((s["x"] + c * dl * L / 2 - sn * dw * W / 2, s["y"] + sn * dl * L / 2 + c * dw * W / 2))
    return np.array(pts)


CLEAR = 0.3  # body ground clearance; bbox bottom = tyre contact (inset by overhang), not bumper


def project_box(s, L, W, H, oh=None):
    """Returns 12 image points: body box (Z=CLEAR..H, full L) 8 pts + tyre-contact rectangle (Z=0) 4 pts."""
    if oh is None:
        oh = min(PRIOR[cls_key(s.get("_cls"))]["oh"], L * 0.2)
    g = box_corners(s, L, W)
    gc = box_corners(s, L - 2 * oh, W * 0.95)
    X = np.concatenate([g[:, 0], g[:, 0], gc[:, 0]]); Y = np.concatenate([g[:, 1], g[:, 1], gc[:, 1]])
    Zs = np.array([CLEAR] * 4 + [H] * 4 + [0] * 4, float)
    u, v = cam.to_img(X, Y, Zs)
    return np.stack([u, v], 1)


def reproj_errors(world, px):
    pmap = {t["id"]: t for t in px["tracks"]}
    errs, per = [], {}
    for t in world["tracks"]:
        src = pmap.get(t["id"])
        if not src:
            continue
        sm = {s["f"]: s for s in t["samples"]}
        e_t = []
        for fr in src["frames"]:
            s = sm.get(int(fr["f"]))
            bb = fr.get("bbox")
            if s is None or not bb or fr.get("occluded"):
                continue
            x0, y0, x1, y1 = bb
            if y1 >= TILE_H - 2 or x0 <= 1 or x1 >= TILE_W - 2:
                continue
            uv = project_box(dict(s, _cls=t["class"]), t["length_m"], t["width_m"], t["height_m"])
            pb = [uv[:, 0].min(), uv[:, 1].min(), uv[:, 0].max(), uv[:, 1].max()]
            e = float(np.mean(np.abs(np.array(pb) - np.array(bb, float))))
            e_t.append(e)
        if e_t:
            per[t["id"]] = float(np.median(e_t)); errs += e_t
    return (float(np.median(errs)) if errs else float("nan")), per


def render_review(world, px, outdir, frames):
    import cv2
    vid = os.path.join(HERE, "..", "..", "..", "..", "..", "demo.mp4")
    cap = cv2.VideoCapture(os.path.abspath(vid))
    pmap = {t["id"]: {int(fr["f"]): fr for fr in t["frames"]} for t in px["tracks"]}
    for F in frames:
        cap.set(cv2.CAP_PROP_POS_FRAMES, F)
        ok, img = cap.read()
        if not ok:
            continue
        tile = img[304:604, 481:960].copy()
        big = cv2.resize(tile, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
        for t in world["tracks"]:
            s = next((s for s in t["samples"] if s["f"] == F), None)
            if s is None:
                continue
            fr = pmap.get(t["id"], {}).get(F)
            if fr and fr.get("bbox"):
                x0, y0, x1, y1 = [int(round(a * 3)) for a in fr["bbox"]]
                cv2.rectangle(big, (x0, y0), (x1, y1), (0, 255, 0), 1)
            uv = project_box(dict(s, _cls=t["class"]), t["length_m"], t["width_m"], t["height_m"]) * 3
            col = (0, 0, 255) if t["crash"] else (0, 200, 255)
            P = [tuple(int(round(a)) for a in p) for p in uv]
            for a, b in ((0, 1), (1, 2), (2, 3), (3, 0), (4, 5), (5, 6), (6, 7), (7, 4), (0, 4), (1, 5), (2, 6), (3, 7)):
                cv2.line(big, P[a], P[b], col, 1, cv2.LINE_AA)
            cv2.putText(big, f"{t['id']} {s['speed_mps']:.1f}m/s {s['cause'][:5]}", (P[4][0], P[4][1] - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.4, col, 1, cv2.LINE_AA)
        cv2.putText(big, f"f={F} t={F / FPS:.2f}s  green=detected bbox  orange/red=reprojected 3D box", (8, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1, cv2.LINE_AA)
        cv2.imwrite(os.path.join(outdir, f"overlay_f{F:03d}.png"), big)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", default=os.path.join(HERE, "data", "tracks_px.json"))
    ap.add_argument("--out", default=os.path.join(HERE, "data", "tracks_world.json"))
    ap.add_argument("--review", default=os.path.join(HERE, "review_world"))
    ap.add_argument("--frames", default="40,120,200,260,279,300,360")
    ap.add_argument("--no-render", action="store_true")
    a = ap.parse_args()
    px = json.load(open(a.inp))
    fps = float(px.get("fps", FPS))
    tracks = []
    for tr in px["tracks"]:
        r = process_track(tr, fps)
        if r:
            tracks.append(r[0])
    world = {"frame": "W", "fps": fps, "frames": px.get("frames", 400), "impact_frame": IMPACT_F,
             "notes": "x,y metres in W (X away from camera, Y camera-right); heading 0=+X, 90=+Y; F=m*a in W; f_long/f_lat in vehicle frame; crash tracks overridden by crash_pair.json",
             "tracks": tracks}
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    tmp = a.out + ".tmp"
    json.dump(world, open(tmp, "w"))
    os.replace(tmp, a.out)
    med, per = reproj_errors(world, px)
    os.makedirs(a.review, exist_ok=True)
    rep = {"median_reproj_px": med, "per_track_reproj_px": per, "tracks": []}
    print(f"tracks={len(tracks)} median reprojection error={med:.2f}px")
    for t in tracks:
        S = t["samples"]; sp = np.array([s["speed_mps"] for s in S]); ys = np.array([s["y"] for s in S])
        jumps = np.hypot(np.diff([s["x"] for s in S]), np.diff(ys)) * fps
        nrej = sum(s["src"].startswith("rejected") for s in S)
        flags = []
        if t["carriageway"] == "crash" and not t["crash"] and (np.median(sp) < 3 or np.median(sp) > 20):
            flags.append("speed_off_crash_cw")
        if t["carriageway"] == "right" and (np.median(sp) < 15 or np.median(sp) > 40):
            flags.append("speed_off_right_cw")
        if np.ptp(ys) > 4.5:
            flags.append(f"lateral_range_{np.ptp(ys):.1f}m")
        if nrej > 0.1 * len(S):
            flags.append(f"rejected_{nrej}")
        line = dict(id=t["id"], cls=t["class"], cw=t["carriageway"], crash=t["crash"], frames=f"{t['f_first']}-{t['f_last']}",
                    speed=f"{sp.min():.1f}-{np.median(sp):.1f}-{sp.max():.1f}", y=f"{ys.min():.1f}..{ys.max():.1f}",
                    L=t["length_m"], events=t["event_frames"], reproj=round(per.get(t["id"], float('nan')), 2),
                    sigma_med=round(float(np.median([s['sigma_m'] for s in S])), 2), flags=flags)
        rep["tracks"].append(line)
        print(line)
    json.dump(rep, open(os.path.join(a.review, "report.json"), "w"), indent=1)
    if not a.no_render:
        render_review(world, px, a.review, [int(x) for x in a.frames.split(",")])


if __name__ == "__main__":
    main()
