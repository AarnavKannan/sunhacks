"""Joint calibration of the bottom-right (crash) camera.

Observations:
  * right-carriageway lane-line dash ends (A: Y=0, B: Y=Y_B), 6 m dash / 12 m gap  -> longitudinal metric scale
  * sub-pixel samples along every visible painted line / edge on both carriageways (Y_i + s_i*X, free)
  * the burned-in yellow 3D box of the stopped van (8 corners), width fixed to VAN_W -> lateral metric scale
Run from measure/:  python calib.py   (writes data/calib_joint.json, data/br_camera.json, review_calib/*.png)
"""
import json, os, sys
import numpy as np, cv2
from scipy.optimize import least_squares

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
CX, CY = 239.5, 150.0
VAN_W = float(os.environ.get("VAN_W", 2.05))     # Fiat Ducato / Citroen Jumper body width
D = {d["id"]: d for d in json.load(open(os.path.join(DATA, "dashes.json")))}
A = [124, 93, 69, 57, 45, 30]          # dashes of line A (Y=0), n = 0..5
B = [94, 72, 59, 46, 31, 22]           # dashes of line B, n = 1..6 (in step with A)

def rot(yaw, pitch, roll):
    cy, sy, cp, sp, cr, sr = np.cos(yaw), np.sin(yaw), np.cos(pitch), np.sin(pitch), np.cos(roll), np.sin(roll)
    Ry = np.array([[cy, -sy, 0], [sy, cy, 0], [0, 0, 1]])
    base = np.array([[0, 1, 0], [0, 0, -1], [1, 0, 0]])
    Rx = np.array([[1, 0, 0], [0, cp, -sp], [0, sp, cp]])
    Rz = np.array([[cr, -sr, 0], [sr, cr, 0], [0, 0, 1]])
    return Rz @ Rx @ base @ Ry

def project(cp, X, Y, Z=0.0):
    f, h, yaw, pitch, roll, cy0 = cp[:6]
    R = rot(yaw, pitch, roll)
    X = np.atleast_1d(X).astype(float)
    W = np.stack([X, np.atleast_1d(Y) - cy0 + 0 * X, np.atleast_1d(Z) - h + 0 * X], 1)
    C = W @ R.T
    return f * C[:, 0] / C[:, 2] + CX, f * C[:, 1] / C[:, 2] + CY

# ---- painted lines: name, carriageway, initial Y (current cam), dashed?, X range to sample
LINES = [
    ("R_edge_left",  "right", -3.85, False, (56, 330)),
    ("R_barrier",    "right", -4.92, False, (56, 300)),   # foot of median barrier/kerb, right side
    ("R_A",          "right",  0.00, True,  (56, 330)),
    ("R_B",          "right",  3.75, True,  (60, 330)),
    ("R_C",          "right",  7.78, True,  (110, 330)),
    ("L_edge_inner", "crash", -9.05, False, (56, 330)),
    ("L_1_2",        "crash", -12.7, True,  (68, 300)),
    ("L_2_3",        "crash", -16.1, True,  (95, 300)),
    ("L_3_4",        "crash", -19.6, True,  (115, 300)),
    ("L_4_5",        "crash", -23.1, True,  (130, 300)),
    ("L_5_6",        "crash", -26.3, True,  (165, 260)),
    ("L_edge_outer", "crash", -29.0, False, (175, 250)),
]
VAN_IMG = np.array([(69.0, 208.0), (121.5, 208.0), (84.5, 194.5), (134.0, 194.5),
                    (68.5, 139.5), (121.5, 139.5), (84.5, 130.5), (134.0, 130.5)])
VAN_KEYS = [(-1, -1, 0), (-1, 1, 0), (1, -1, 0), (1, 1, 0), (-1, -1, 1), (-1, 1, 1), (1, -1, 1), (1, 1, 1)]  # (front/rear, left/right, bottom/top)

def van_corners(bp, W):
    X, Y, yaw, L, H = bp
    c, s = np.cos(yaw), np.sin(yaw)
    P = []
    for fr, lr, tb in VAN_KEYS:
        dx, dy = fr * L / 2, lr * W / 2
        P.append((X + c * dx - s * dy, Y + s * dx + c * dy, tb * H))
    return np.array(P)

def sample_lines(cp, Ys, slopes, bg):
    g = cv2.cvtColor(bg, cv2.COLOR_BGR2GRAY).astype(np.float32)
    th = g - cv2.blur(g, (9, 9))
    out = []
    for i, (name, cw, _, dashed, (x0, x1)) in enumerate(LINES):
        for X in np.arange(x0, x1, 0.5):
            Y = Ys[i] + slopes[i] * X
            u, v = project(cp, [X, X + 1.0], [Y, Y + slopes[i]])
            if not (3 <= u[0] < 475 and 40 <= v[0] < 297): continue
            if 55 <= u[0] <= 140 and 122 <= v[0] <= 216: continue     # van + its box
            d = np.array([u[1] - u[0], v[1] - v[0]]); d /= np.linalg.norm(d); n = np.array([-d[1], d[0]])
            ts = np.arange(-3.0, 3.01, 0.25)
            pu, pv = u[0] + ts * n[0], v[0] + ts * n[1]
            prof = cv2.remap(th, pu.astype(np.float32)[None], pv.astype(np.float32)[None], cv2.INTER_LINEAR)[0]
            k = int(np.argmax(prof))
            if prof[k] < 5 or k in (0, len(ts) - 1): continue
            a, b, c = prof[k - 1], prof[k], prof[k + 1]
            off = ts[k] + 0.25 * 0.5 * (a - c) / max(a - 2 * b + c, -1e9) if (a - 2 * b + c) < 0 else ts[k]
            out.append((i, pu[0] + (off + 3.0) * n[0], pv[0] + (off + 3.0) * n[1], prof[k]))
    return np.array(out)

def line_res(cp, Ys, slopes, S):
    """Perpendicular image distance of samples S=(line, u, v) to their projected line."""
    R = rot(*cp[2:5]); f, h, cy0 = cp[0], cp[1], cp[5]
    li = S[:, 0].astype(int); u, v = S[:, 1], S[:, 2]
    d = np.stack([(u - CX) / f, (v - CY) / f, np.ones_like(u)], 1) @ R
    t = h / -d[:, 2]; X = d[:, 0] * t
    Y = Ys[li] + slopes[li] * X
    pu, pv = project(cp, X, Y); qu, qv = project(cp, X + 1.0, Y + slopes[li])
    dx, dy = qu - pu, qv - pv; nrm = np.hypot(dx, dy)
    return ((u - pu) * -dy + (v - pv) * dx) / nrm

def dash_obs(phase, YB):
    pts = []
    for k, i in enumerate(A):
        if i != 124: pts.append((phase + 18 * k, 0.0, *D[i]["near"]))   # 124 near end is clipped by the tile edge
        pts.append((phase + 18 * k + 6, 0.0, *D[i]["far"]))
    for k, i in enumerate(B):
        pts += [(phase + 18 * (k + 1), YB, *D[i]["near"]), (phase + 18 * (k + 1) + 6, YB, *D[i]["far"])]
    return np.array(pts)

NL = len(LINES)
FIXED_SLOPE = {"right"}           # right-carriageway lines define the X axis -> slope 0
def unpack(p):
    cp = p[:6]; phase = p[6]
    Ys = p[7:7 + NL].copy(); Ys[2] = 0.0            # R_A defines Y=0
    s_crash = p[7 + NL]
    slopes = np.array([0.0 if L[1] in FIXED_SLOPE else s_crash for L in LINES])
    bp = p[8 + NL:13 + NL]
    return cp, phase, Ys, slopes, bp

def residuals(p, S, w_van=1.0, van_w=VAN_W, use_van=True):
    cp, phase, Ys, slopes, bp = unpack(p)
    P = dash_obs(phase, Ys[3])
    u, v = project(cp, P[:, 0], P[:, 1])
    r = [u - P[:, 2], v - P[:, 3], line_res(cp, Ys, slopes, S) * 0.5]   # many line samples -> down-weight
    if use_van:
        C = van_corners(bp, van_w)
        u, v = project(cp, C[:, 0], C[:, 1], C[:, 2])
        r += [w_van * 3 * (u - VAN_IMG[:, 0]), w_van * 3 * (v - VAN_IMG[:, 1])]  # 8 corners, ~0.5 px label/peak accuracy
    return np.concatenate(r)

def fit(p0, S, **kw):
    xs = np.r_[[100, 1, 0.01, 0.01, 0.01, 0.5, 1], np.ones(NL) * 0.3, [1e-3], [1, 0.5, 0.02, 0.5, 0.2]]
    return least_squares(residuals, p0, x_scale=xs, loss="soft_l1", f_scale=1.5, args=(S,), kwargs=kw)

def main():
    bg = cv2.imread(os.path.join(DATA, "br_bg.png"))
    old = json.load(open(os.path.join(DATA, "calib_3.75.json")))["params"]
    p = np.r_[old[:6], old[6], [L[2] for L in LINES], 0.0, [81.7, -10.5, 0.01, 5.0, 2.7]]
    # iterate: sample lines with current model, refit
    for it in range(3):
        cp, phase, Ys, slopes, bp = unpack(p)
        S = sample_lines(cp, Ys, slopes, bg)
        r = fit(p, S[:, :3])
        p = r.x
        print(f"iter {it}: {len(S)} line samples, cost {r.cost:.1f}")
    cp, phase, Ys, slopes, bp = unpack(p)
    S = sample_lines(cp, Ys, slopes, bg)
    r = fit(p, S[:, :3]); p = r.x
    cp, phase, Ys, slopes, bp = unpack(p)
    # residual report
    P = dash_obs(phase, Ys[3]); u, v = project(cp, P[:, 0], P[:, 1])
    dres = np.hypot(u - P[:, 2], v - P[:, 3])
    lres = line_res(cp, Ys, slopes, S[:, :3])
    C = van_corners(bp, VAN_W); vu, vv = project(cp, C[:, 0], C[:, 1], C[:, 2])
    vres = np.hypot(vu - VAN_IMG[:, 0], vv - VAN_IMG[:, 1])
    rep = {"dash_rms_px": float(np.sqrt(np.mean(dres ** 2))), "van_rms_px": float(np.sqrt(np.mean(vres ** 2))),
           "lines": {}}
    for i, L in enumerate(LINES):
        m = S[:, 0] == i
        if not m.any(): continue
        rr = lres[m]
        Xs = []
        Rm = rot(*cp[2:5]); dd = np.stack([(S[m, 1] - CX) / cp[0], (S[m, 2] - CY) / cp[0], np.ones(m.sum())], 1) @ Rm
        Xs = dd[:, 0] * cp[1] / -dd[:, 2]
        rep["lines"][L[0]] = {"Y": round(float(Ys[i]), 3), "n": int(m.sum()), "rms_px": round(float(np.sqrt(np.median(rr ** 2))), 2),
                              "X_seen": [round(float(np.percentile(Xs, 2)), 1), round(float(np.percentile(Xs, 98)), 1)]}
    print(json.dumps(rep, indent=1))
    print("cam f h yaw pitch roll cy0:", np.round(cp, 4), "yaw/pitch/roll deg", np.round(np.degrees(cp[2:5]), 3), "phase", round(phase, 2))
    print("crash slope", slopes[5], "van X Y yaw L H", np.round(bp, 3))
    json.dump({"lane_w": float(Ys[3]), "van_w": VAN_W, "params": [*map(float, cp), float(phase)],
               "lines": {L[0]: float(Ys[i]) for i, L in enumerate(LINES)}, "crash_slope": float(slopes[5]),
               "van": [*map(float, bp)], "report": rep}, open(os.path.join(DATA, "calib_joint.json"), "w"), indent=1)
    np.save(os.path.join(HERE, "review_calib", "line_samples.npy"), S)
    return p, S

# ---------------------------------------------------------------- outputs
def describe():
    """Write data/br_camera.json + review_calib/ figures from data/calib_joint.json (run after main())."""
    import importlib, cam
    importlib.reload(cam)
    J = json.load(open(os.path.join(DATA, "calib_joint.json")))
    Ln = J["lines"]; rep = J["report"]
    bg = cv2.imread(os.path.join(DATA, "br_bg.png"))
    g = cv2.cvtColor(bg, cv2.COLOR_BGR2GRAY).astype(np.float32); th = g - cv2.blur(g, (9, 9))
    bands = [(60, 100), (100, 140), (140, 180), (180, 220), (220, 260), (260, 300)]
    S = np.load(os.path.join(HERE, "review_calib", "line_samples.npy"))
    Xs, Ys = cam.to_ground(S[:, 1], S[:, 2])
    drift = {}
    for i, L in enumerate(LINES):
        row = {}
        for a, b in bands:
            m = (S[:, 0] == i) & (Xs >= a) & (Xs < b)
            if m.sum() >= 4: row[f"{a}-{b}"] = round(float(np.median(Ys[m])), 2)
        drift[L[0]] = row
    def vis_range(Y):
        Xg = np.arange(30, 400, 0.5); u, v = cam.to_img(Xg, np.full_like(Xg, Y))
        ok = (u >= 0) & (u <= 478) & (v >= 38) & (v <= 299)      # v<38: scenery band at the top of the tile
        return [round(float(Xg[ok].min()), 1), round(float(Xg[ok].max()), 1)] if ok.any() else None
    cr = ["L_edge_inner", "L_1_2", "L_2_3", "L_3_4", "L_4_5", "L_5_6", "L_edge_outer"]
    rt = ["R_edge_left", "R_A", "R_B", "R_C"]
    crash_lanes = [{"lane": k + 1, "Y_line_median_side": round(Ln[cr[k]], 3), "Y_line_outer_side": round(Ln[cr[k + 1]], 3),
                    "Y_centre": round((Ln[cr[k]] + Ln[cr[k + 1]]) / 2, 3), "width": round(Ln[cr[k]] - Ln[cr[k + 1]], 3),
                    "X_visible": vis_range((Ln[cr[k]] + Ln[cr[k + 1]]) / 2)} for k in range(6)]
    right_lanes = [{"lane": k + 1, "Y_line_median_side": round(Ln[rt[k]], 3), "Y_line_outer_side": round(Ln[rt[k + 1]], 3),
                    "Y_centre": round((Ln[rt[k]] + Ln[rt[k + 1]]) / 2, 3), "width": round(Ln[rt[k + 1]] - Ln[rt[k]], 3),
                    "X_visible": vis_range((Ln[rt[k]] + Ln[rt[k + 1]]) / 2)} for k in range(3)]
    acc = []
    for X in (60, 80, 100, 130, 160, 200, 250, 300):
        for name, Y in (("crash_lane1", crash_lanes[0]["Y_centre"]), ("crash_lane2", crash_lanes[1]["Y_centre"]), ("right_lane1", right_lanes[0]["Y_centre"])):
            u, v = cam.to_img(X, Y)
            if not (0 <= u[0] <= 478 and 38 <= v[0] <= 299): continue
            x1, y1 = cam.to_ground(u + 1, v); x2, y2 = cam.to_ground(u, v + 1)
            acc.append({"X": X, "where": name, "u": round(float(u[0]), 1), "v": round(float(v[0]), 1),
                        "dXdY_per_px_u": [round(float(x1[0] - X), 3), round(float(y1[0] - Y), 3)],
                        "dXdY_per_px_v": [round(float(x2[0] - X), 3), round(float(y2[0] - Y), 3)]})
    out = {
        "camera": {"model": "pinhole, no distortion, tile pixels (479x300 crop x=481 y=304 of demo.mp4)",
                   "cx": CX, "cy": CY, "f_px": J["params"][0], "h_m": J["params"][1], "cam_Y_m": J["params"][5],
                   "yaw_deg": float(np.degrees(J["params"][2])), "pitch_deg_down": float(np.degrees(J["params"][3])),
                   "roll_deg": float(np.degrees(J["params"][4])), "dash_phase_m": J["params"][6],
                   "R_world_to_cam": cam.R.tolist(),
                   "usage": "cam.py: to_ground(u,v[,Z]) -> (X,Y) on plane z=Z; to_img(X,Y,Z=0) -> (u,v)"},
        "world_frame": "X along road away from camera; Y to camera's right; Z up; Y=0 = right-carriageway dashed line A (between right lanes 1 and 2); camera at (0, cam_Y, h)",
        "scale_anchors": {"longitudinal": "right-cwy lane-line dashes, 6 m dash + 12 m gap; the short-dash line R_C comes out on a 12.0 m period, consistent",
                          "lateral": f"burned-in 3D box of the stopped van, width fixed {J['van_w']} m (Ducato/Jumper body); without it lateral scale is unidentifiable (flat cost valley)",
                          "van_box_fit": {"X": J["van"][0], "Y": J["van"][1], "yaw_deg": float(np.degrees(J["van"][2])), "L": J["van"][3], "W": J["van_w"], "H": J["van"][4]},
                          "lateral_scale_sensitivity": "all lateral distances scale with the van width: W=1.95 -> right lane 2 = 3.49 m, W=2.05 -> 3.67, W=2.10 -> 3.76"},
        "lines_Y": {k: round(v, 3) for k, v in Ln.items()},
        "lines_Y_by_X_band": drift,
        "crash_carriageway": {"traffic": "toward camera (decreasing X)", "lanes_from_median": crash_lanes,
                              "median_edge_line_Y": round(Ln["L_edge_inner"], 3), "outer_edge_line_Y": round(Ln["L_edge_outer"], 3),
                              "note": "6 dash-separated lanes visible; lanes 5-6 only seen at X>165 m. Lane 1 partly occluded by the stopped van (X~78-83, Y~-11.4..-9.3)."},
        "right_carriageway": {"traffic": "away from camera (increasing X)", "lanes_from_median": right_lanes,
                              "line_R_C_note": "R_C has short dashes on a 12 m period (auxiliary/exit-lane boundary); a further lane lies beyond it (faint line ~Y=+11.6)"},
        "median": {"crash_side_edge_line_Y": round(Ln["L_edge_inner"], 3), "right_side_barrier_foot_Y": round(Ln["R_barrier"], 3),
                   "right_edge_line_Y": round(Ln["R_edge_left"], 3),
                   "description": "snow-covered grass strip about Y=-8.8..-5.3 for X<~150, barrier foot at Y~-4.8; further away the strip narrows to a paved median with barrier"},
        "road_geometry": {"heading": "both carriageways straight and parallel to X in the measured range (crash-cwy fitted slope %.5f rad = %.3f deg)" % (J["crash_slope"], np.degrees(J["crash_slope"])),
                          "curvature": "none detectable for X<300 m on crash lanes 1-4 (see lines_Y_by_X_band); only the outer guard-rail/verge at Y<-30 bends left beyond X~250 m",
                          "flat_ground": "single plane Z=0 fits all lines; roll 0.18 deg absorbs any crossfall"},
        "residuals": {"dash_end_rms_px": rep["dash_rms_px"], "van_corner_rms_px": rep["van_rms_px"],
                      "line_median_abs_px": {k: v["rms_px"] for k, v in rep["lines"].items()},
                      "line_X_seen": {k: v["X_seen"] for k, v in rep["lines"].items()}},
        "accuracy": {"per_pixel": acc, "summary": "filled below"},
    }
    def near(X, w):
        a = [r for r in acc if r["X"] == X and r["where"] == w]
        return a[0] if a else None
    summ = []
    for X in (60, 100, 160, 250):
        r = near(X, "crash_lane1") or near(X, "right_lane1")
        if r: summ.append(f"X={X}: 1px(u) -> {abs(r['dXdY_per_px_u'][1]):.3f} m lateral, 1px(v) -> {abs(r['dXdY_per_px_v'][0]):.2f} m along-road")
    out["accuracy"]["summary"] = "; ".join(summ) + ". Systematic: lateral scale +-2.5% (van width +-0.05 m); longitudinal +-1% (dash standard); line Ys +-0.05 m relative to each other."
    json.dump(out, open(os.path.join(DATA, "br_camera.json"), "w"), indent=1)
    big = cv2.resize(bg, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    Xg = np.arange(40, 400, 0.5)
    for k, Y in Ln.items():
        u, v = cam.to_img(Xg, np.full_like(Xg, Y)); m = (v > 36) & (v < 300) & (u > -5) & (u < 485)
        pts = np.stack([u[m] * 2, v[m] * 2], 1).astype(np.int32)
        cv2.polylines(big, [pts], False, (0, 0, 255) if k.startswith("L") else (255, 0, 255), 1, cv2.LINE_AA)
    for X in range(60, 320, 20):
        u, v = cam.to_img(np.full(2, float(X)), np.array([Ln["L_edge_outer"], Ln["R_C"]]))
        cv2.line(big, (int(u[0] * 2), int(v[0] * 2)), (int(u[1] * 2), int(v[1] * 2)), (0, 200, 255), 1, cv2.LINE_AA)
        uu, vv = cam.to_img(X, Ln["R_C"] + 0.5)
        if vv[0] > 36: cv2.putText(big, f"X{X}", (int(uu[0] * 2) + 3, int(vv[0] * 2)), 0, 0.35, (0, 200, 255), 1)
    Cv = van_corners(J["van"], J["van_w"]); u, v = project(J["params"][:6], Cv[:, 0], Cv[:, 1], Cv[:, 2])
    for a, b in [(0, 1), (2, 3), (0, 2), (1, 3), (4, 5), (6, 7), (4, 6), (5, 7), (0, 4), (1, 5), (2, 6), (3, 7)]:
        cv2.line(big, (int(u[a] * 2), int(v[a] * 2)), (int(u[b] * 2), int(v[b] * 2)), (255, 255, 0), 1, cv2.LINE_AA)
    cv2.imwrite(os.path.join(HERE, "review_calib", "grid_on_bg_2x.png"), big)
    Xb = np.arange(55, 320, 0.4); Yb = np.arange(-32, 10, 0.04)
    XX, YY = np.meshgrid(Xb, Yb, indexing="ij"); u, v = cam.to_img(XX.ravel(), YY.ravel())
    m = cv2.remap(np.clip(th * 8 + 128, 0, 255).astype(np.uint8), u.reshape(XX.shape).astype(np.float32), v.reshape(XX.shape).astype(np.float32), cv2.INTER_LINEAR)
    m = cv2.cvtColor(np.ascontiguousarray(m[::-1]), cv2.COLOR_GRAY2BGR)
    for k, Y in Ln.items():
        j = int((Y + 32) / 0.04); cv2.line(m, (j, 0), (j, 12), (0, 0, 255), 2)
    for y in range(-30, 10, 5):
        j = int((y + 32) / 0.04); cv2.putText(m, str(y), (j, 26), 0, 0.4, (0, 255, 255), 1)
    for x in range(60, 320, 20):
        i = len(Xb) - 1 - int((x - 55) / 0.4); cv2.putText(m, str(x), (2, i), 0, 0.35, (0, 255, 255), 1)
    cv2.imwrite(os.path.join(HERE, "review_calib", "birdseye.png"), m)
    print(json.dumps(drift))
    for L in crash_lanes + right_lanes: print(L)
    print(out["accuracy"]["summary"])

if __name__ == "__main__":
    os.makedirs(os.path.join(HERE, "review_calib"), exist_ok=True)
    if "--describe-only" not in sys.argv: main()
    describe()
