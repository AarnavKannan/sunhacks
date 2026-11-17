"""Gallery of measured tracks absent from the spec: track box red, spec boxes (projected 3D bbox) magenta, at 3x zoom."""
import json, os, sys, numpy as np, cv2
ROOT = r"C:\Users\anvit\.t3\projects\sunhacks-testing"; DI = os.path.join(ROOT, r"apps\desktop\electron\demo-incident")
OUT = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, OUT)
px = {t["id"]: t for t in json.load(open(os.path.join(DI, r"measure\data\tracks_px_clean.json")))["tracks"]}
spec = json.load(open(os.path.join(DI, "incident-spec.json")))
from census import pose, corners  # noqa
import cam
ids = sys.argv[1:] or [k for k in px if k not in {o["id"] for o in spec["objects"]}]
cap = cv2.VideoCapture(os.path.join(ROOT, "data", "demo.mp4")); tiles = []
for k in ids:
    t = px[k]; meas = [q for q in t["frames"] if q["src"] == "measured"] or t["frames"]
    q = meas[len(meas) // 2]; f = q["f"]
    cap.set(cv2.CAP_PROP_POS_FRAMES, f); ok, img = cap.read(); tile = img[304:604, 481:960].copy()
    b = q["bbox"]; cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2; half = max(40, (b[2] - b[0]), (b[3] - b[1]))
    x0, y0 = int(max(0, cx - half)), int(max(0, cy - half)); x1, y1 = int(min(479, cx + half)), int(min(300, cy + half))
    Z = 3; big = cv2.resize(tile[y0:y1, x0:x1], None, fx=Z, fy=Z, interpolation=cv2.INTER_CUBIC)
    for o in spec["objects"]:
        p = pose(o, round(f * 0.08, 4))
        if p is None: continue
        X, Y, pts = corners(o, p)
        if X < 1: continue
        u = np.r_[cam.to_img([a[0] for a in pts], [a[1] for a in pts], 0)[0], cam.to_img([a[0] for a in pts], [a[1] for a in pts], o["height_m"])[0]]
        v = np.r_[cam.to_img([a[0] for a in pts], [a[1] for a in pts], 0)[1], cam.to_img([a[0] for a in pts], [a[1] for a in pts], o["height_m"])[1]]
        cv2.rectangle(big, (int((u.min() - x0) * Z), int((v.min() - y0) * Z)), (int((u.max() - x0) * Z), int((v.max() - y0) * Z)), (255, 0, 255), 1)
        cv2.putText(big, o["id"], (int((u.min() - x0) * Z), int((v.max() - y0) * Z) + 10), 0, .35, (255, 0, 255), 1)
    cv2.rectangle(big, (int((b[0] - x0) * Z), int((b[1] - y0) * Z)), (int((b[2] - x0) * Z), int((b[3] - y0) * Z)), (0, 0, 255), 2)
    cv2.putText(big, f"{k} f{f} {t['class']} {t.get('paint')}", (3, 14), 0, .45, (0, 0, 255), 2)
    big = cv2.copyMakeBorder(big, 0, max(0, 300 - big.shape[0]), 0, max(0, 300 - big.shape[1]), cv2.BORDER_CONSTANT)[:300, :300]
    tiles.append(big)
while len(tiles) % 4: tiles.append(np.zeros_like(tiles[0]))
g = np.vstack([np.hstack(tiles[i:i + 4]) for i in range(0, len(tiles), 4)])
cv2.imwrite(os.path.join(OUT, "overlays", "dropped_tracks.png"), g)
