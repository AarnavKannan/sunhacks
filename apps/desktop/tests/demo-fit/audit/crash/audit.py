"""A8 crash audit: overlay spec yellow-car / white-van 3-D boxes (and crash_pair.json measured boxes) on the
bottom-right tile of demo.mp4, f240..330 every frame + f340..399 every 10. Writes overlays_<tag>/, contact sheets
and metrics_<tag>.json next to this file. Read-only w.r.t. the repo except this folder.

Run: <venv python> audit.py <tag>
"""
import json, math, os, sys
import numpy as np, cv2

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, *[".."] * 6))
DI = os.path.join(ROOT, "apps", "desktop", "electron", "demo-incident")
sys.path.insert(0, os.path.join(DI, "measure"))
import cam  # noqa: E402

CROP = (481, 304, 479, 300)
FRAMES = list(range(240, 331)) + list(range(340, 400, 10)) + [399]
SIZES = {"yellow-car": (4.3, 2.1, 1.5), "white-van": (5.054, 2.257, 2.657)}  # drawn L, W (incl. mirrors), H
BODY = 0.9  # build-demo-spec BODY_WIDTH

spec = json.load(open(os.path.join(DI, "incident-spec.json"), encoding="utf-8"))
cp = json.load(open(os.path.join(DI, "measure", "data", "crash_pair.json"), encoding="utf-8"))
objs = {o["id"]: o for o in spec["objects"]}
KF = {oid: {round(k["t_s"] * 12.5): k for k in objs[oid]["keyframes"]} for oid in SIZES}
meas = {vid: {s["f"]: s for s in v["samples"]} for vid, v in cp["vehicles"].items()}


def spec_plan(oid, f):
    k = KF[oid].get(f)
    return None if k is None else (k["x_m"], k["y_m"], k["heading_deg"])


def spec_pose(oid, f):
    p = spec_plan(oid, f)
    return None if p is None else (95.06 - p[0], p[1] - 4.803, 180.0 - p[2])


def meas_pose(oid, f):
    s = meas[oid].get(f)
    return None if s is None else (s["x"], s["y"], s["heading_deg"], s["src"])


def corners2(x, y, h, L, W):
    c, s = math.cos(math.radians(h)), math.sin(math.radians(h))
    return np.array([(x + dx * c - dy * s, y + dx * s + dy * c)
                     for dx, dy in ((L / 2, W / 2), (L / 2, -W / 2), (-L / 2, -W / 2), (-L / 2, W / 2))])


def box_px(pose, size):
    L, W, H = size
    g = corners2(pose[0], pose[1], pose[2], L, W)
    X = np.r_[g[:, 0], g[:, 0]]
    Y = np.r_[g[:, 1], g[:, 1]]
    Z = np.r_[np.zeros(4), np.full(4, H)]
    u, v = cam.to_img(X, Y, Z)
    return np.stack([u, v], 1)


def P(p, s=2):
    return (int(round(p[0] * s)), int(round(p[1] * s)))


def draw_box(img, p, col, front=True):
    for a, b in [(0, 1), (1, 2), (2, 3), (3, 0), (4, 5), (5, 6), (6, 7), (7, 4), (0, 4), (1, 5), (2, 6), (3, 7)]:
        cv2.line(img, P(p[a]), P(p[b]), col, 2 if (a < 4 and b < 4) else 1, cv2.LINE_AA)
    if front:  # X on the front face (corners 0,1 at the front)
        cv2.line(img, P(p[0]), P(p[5]), col, 1, cv2.LINE_AA)
        cv2.line(img, P(p[1]), P(p[4]), col, 1, cv2.LINE_AA)


def gap(a, b):
    """Signed separation (m) between convex quads; negative = minimum penetration depth (SAT)."""
    best = -1e9
    for poly in (a, b):
        for i in range(4):
            p, q = poly[i], poly[(i + 1) % 4]
            n = np.array([q[1] - p[1], p[0] - q[0]])
            n = n / np.linalg.norm(n)
            pa, pb = a @ n, b @ n
            best = max(best, pb.min() - pa.max(), pa.min() - pb.max())
    return best


def main(tag):
    cap = cv2.VideoCapture(os.path.join(ROOT, "data", "demo.mp4"))
    od = os.path.join(HERE, f"overlays_{tag}")
    os.makedirs(od, exist_ok=True)
    x0, y0, w, h = CROP
    rows, thumbs = [], []
    want = set(FRAMES)
    f = -1
    while True:
        ok, fr = cap.read()
        f += 1
        if not ok or f > max(want):
            break
        if f not in want:
            continue
        tile = fr[y0:y0 + h, x0:x0 + w]
        img = cv2.resize(tile, (w * 2, h * 2), interpolation=cv2.INTER_CUBIC)
        row = {"f": f, "t": round(f / 12.5, 2)}
        for oid, col_s, col_m in (("white-van", (0, 0, 255), (255, 0, 255)), ("yellow-car", (0, 255, 255), (255, 128, 0))):
            sp, mp = spec_pose(oid, f), meas_pose(oid, f)
            if mp and mp[3] != "occluded-rest":
                draw_box(img, box_px(mp, SIZES[oid]), col_m, False)
            if not sp:
                continue
            draw_box(img, box_px(sp, SIZES[oid]), col_s)
            cs = cam.to_img(sp[0], sp[1], 0)
            r = {"spec_plan": spec_plan(oid, f), "spec_W": [round(v, 3) for v in sp],
                 "spec_px": [round(float(cs[0][0]), 1), round(float(cs[1][0]), 1)]}
            if mp:
                cm = cam.to_img(mp[0], mp[1], 0)
                r.update({"meas_W": [round(mp[0], 3), round(mp[1], 3), round(mp[2], 2)], "meas_src": mp[3],
                          "d_m": round(math.hypot(sp[0] - mp[0], sp[1] - mp[1]), 3),
                          "dX_m": round(sp[0] - mp[0], 3), "dY_m": round(sp[1] - mp[1], 3),
                          "dh_deg": round(((sp[2] - mp[2] + 180) % 360) - 180, 1),
                          "d_px": round(math.hypot(cs[0][0] - cm[0][0], cs[1][0] - cm[1][0]), 1)})
            row[oid] = r
        yp, vp = spec_pose("yellow-car", f), spec_pose("white-van", f)
        if yp and vp:
            row["gap_drawn_m"] = round(gap(corners2(*yp, 4.3, 2.1), corners2(*vp, 5.054, 2.257)), 3)
            row["gap_body_m"] = round(gap(corners2(*yp, 4.3, 2.1 * BODY), corners2(*vp, 5.054, 2.257 * BODY)), 3)
            c, s = math.cos(math.radians(vp[2])), math.sin(math.radians(vp[2]))
            dx, dy = yp[0] - vp[0], yp[1] - vp[1]
            # van heading ~180 W (drives toward camera). behind_m > 0: yellow centre behind van centre.
            row["rel"] = {"behind_m": round(-(dx * c + dy * s), 2), "toward_median_m": round(dy, 2)}
        mp_y = meas_pose("yellow-car", f)
        mv = meas_pose("white-van", f)
        if mp_y and mv:
            row["meas_gap_drawn_m"] = round(gap(corners2(*mp_y[:3], 4.3, 2.1), corners2(*mv[:3], 5.054, 2.257)), 3)
            row["meas_rel"] = {"behind_m": round(mp_y[0] - mv[0], 2), "toward_median_m": round(mp_y[1] - mv[1], 2)}
        cv2.rectangle(img, (0, 0), (w * 2, 44), (0, 0, 0), -1)
        cv2.putText(img, f"f{f} t={f / 12.5:.2f}s  SPEC van=red yellow=yellow(X=front) | MEAS van=magenta yellow=blue",
                    (6, 17), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
        if "gap_drawn_m" in row:
            cv2.putText(img, f"spec gap drawn {row['gap_drawn_m']:+.2f} m, body(0.9W) {row['gap_body_m']:+.2f} m",
                        (6, 37), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
        cv2.imwrite(os.path.join(od, f"f{f:03d}.jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, 88])
        thumbs.append((f, img))
        rows.append(row)

    def sheet(sel, name, cols=4):
        ims = [cv2.resize(im, (479, 300)) for ff, im in thumbs if ff in sel]
        if not ims:
            return
        while len(ims) % cols:
            ims.append(np.zeros_like(ims[0]))
        grid = np.vstack([np.hstack(ims[i:i + cols]) for i in range(0, len(ims), cols)])
        cv2.imwrite(os.path.join(HERE, name), grid, [cv2.IMWRITE_JPEG_QUALITY, 85])

    sheet(set(range(240, 284)), f"sheet_{tag}_f240-283.jpg")
    sheet(set(range(284, 300)), f"sheet_{tag}_f284-299.jpg")
    sheet(set(range(300, 331)), f"sheet_{tag}_f300-330.jpg")
    sheet(set(range(331, 400)), f"sheet_{tag}_f340-399.jpg")
    with open(os.path.join(HERE, f"metrics_{tag}.json"), "w") as fh:
        json.dump(rows, fh, indent=1)
    print("wrote", len(rows), "frames ->", od)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "run1")
