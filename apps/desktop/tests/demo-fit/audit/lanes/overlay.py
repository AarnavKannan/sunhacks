"""Extract bottom-right tile frames and overlay spec (green +lane digit) and measured (red) centres for vehicle ids.
usage: overlay.py F id[,id..] [F id..]..."""
import json, os, subprocess, sys
import numpy as np, cv2
HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
DI = os.path.join(APP, "electron", "demo-incident")
sys.path.insert(0, os.path.join(DI, "measure"))
import cam
VIDEO = os.path.abspath(os.path.join(APP, "..", "..", "data", "demo.mp4"))
sp = json.load(open(os.path.join(DI, "incident-spec.json")))
tw = json.load(open(os.path.join(DI, "measure", "data", "tracks_world.json")))
cp = json.load(open(os.path.join(DI, "measure", "data", "crash_pair.json")))
L = np.array(sp["road"]["lane_lines_forward_m"])
K = {o["id"]: {round(k["t_s"] * 12.5): k for k in o["keyframes"]} for o in sp["objects"]}
M = {t["id"]: {s["f"]: s for s in t["samples"]} for t in tw["tracks"]}
for k in ("yellow-car", "white-van"):
    M[k] = {s["f"]: s for s in cp["vehicles"][k]["samples"]}
args = sys.argv[1:]
for F, ids in zip(args[::2], args[1::2]):
    F = int(F); out = os.path.join(HERE, "frames", f"f{F:03d}.png")
    if not os.path.exists(out):
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", VIDEO, "-vf", f"select=eq(n\,{F}),crop=479:300:481:304",
                        "-frames:v", "1", out], check=True)
    img = cv2.imread(out); img = cv2.resize(img, None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST)
    # lane lines
    for d in L:
        xs = np.linspace(56, 700, 200); u, v = cam.to_img(xs, -d - 4.803 + 0 * xs)
        for a in range(len(xs) - 1):
            cv2.line(img, (int(u[a] * 2), int(v[a] * 2)), (int(u[a + 1] * 2), int(v[a + 1] * 2)), (255, 200, 0), 1)
    for i in ids.split(","):
        k = K.get(i, {}).get(F)
        if k:
            u, v = cam.to_img(95.06 - k["x_m"], k["y_m"] - 4.803)
            ln = int(np.sum(-k["y_m"] > L))
            cv2.circle(img, (int(u[0] * 2), int(v[0] * 2)), 4, (0, 255, 0), -1)
            cv2.putText(img, f"{i} L{ln}", (int(u[0] * 2) + 6, int(v[0] * 2) - 6), 0, 0.45, (0, 255, 0), 1)
        s = M.get(i, {}).get(F)
        if s:
            u, v = cam.to_img(s["x"], s["y"])
            cv2.circle(img, (int(u[0] * 2), int(v[0] * 2)), 3, (0, 0, 255), -1)
    cv2.putText(img, f"f{F}", (8, 22), 0, 0.7, (255, 255, 255), 2)
    cv2.imwrite(os.path.join(HERE, "frames", f"ov_{F:03d}_{ids.replace(',', '_')}.png"), img)
    print("wrote", F, ids)
# optional zoom strip: ZOOM=id,F0,F1,step  -> frames/strip_<id>_<F0>_<F1>.png (crop 120x80 tile px around the spec centre, x4)
z = os.environ.get("ZOOM")
if z:
    vid, f0, f1, st = z.split(","); f0, f1, st = int(f0), int(f1), int(st)
    tiles = []
    for F in range(f0, f1 + 1, st):
        out = os.path.join(HERE, "frames", f"f{F:03d}.png")
        if not os.path.exists(out):
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", VIDEO, "-vf", f"select=eq(n\,{F}),crop=479:300:481:304",
                            "-frames:v", "1", out], check=True)
        img = cv2.imread(out)
        k = K[vid].get(F) or K[vid][min(K[vid], key=lambda g: abs(g - F))]
        u, v = cam.to_img(95.06 - k["x_m"], k["y_m"] - 4.803); cu, cv_ = int(u[0]), int(v[0])
        W, H = int(os.environ.get("ZW", 90)), int(os.environ.get("ZH", 60))
        x0, y0 = max(0, min(479 - W, cu - W // 2)), max(0, min(300 - H, cv_ - H // 2))
        big = cv2.resize(img, None, fx=4, fy=4, interpolation=cv2.INTER_CUBIC)
        for d in L:
            xs = np.linspace(56, 700, 300); uu, vv = cam.to_img(xs, -d - 4.803 + 0 * xs)
            for a in range(len(xs) - 1):
                cv2.line(big, (int(uu[a] * 4), int(vv[a] * 4)), (int(uu[a + 1] * 4), int(vv[a + 1] * 4)), (255, 200, 0), 1)
        ln = int(np.sum(-k["y_m"] > L))
        cv2.circle(big, (cu * 4, cv_ * 4), 5, (0, 255, 0), -1)
        s = M.get(vid, {}).get(F)
        if s:
            mu, mv = cam.to_img(s["x"], s["y"]); cv2.circle(big, (int(mu[0] * 4), int(mv[0] * 4)), 4, (0, 0, 255), -1)
        crop = big[y0 * 4:(y0 + H) * 4, x0 * 4:(x0 + W) * 4].copy()
        cv2.putText(crop, f"f{F} L{ln}", (5, 20), 0, 0.6, (255, 255, 255), 2)
        tiles.append(crop)
    rows = [np.hstack(tiles[i:i + 4] + [np.zeros_like(tiles[0])] * (4 - len(tiles[i:i + 4]))) for i in range(0, len(tiles), 4)]
    cv2.imwrite(os.path.join(HERE, "frames", f"strip_{vid}_{f0}_{f1}.png"), np.vstack(rows))
    print("strip", vid, f0, f1)
