"""Wireframe-colour residual: burned-in wireframe pixels on the crash carriageway not covered by any spec box (missing),
and spec boxes with ~no wireframe pixels inside (ghost candidates). Writes overlays/fNNN_resid.png and residual.json."""
import json, os, sys, numpy as np, cv2
ROOT = r"C:\Users\anvit\.t3\projects\sunhacks-testing"; DI = os.path.join(ROOT, r"apps\desktop\electron\demo-incident")
sys.path.insert(0, os.path.join(DI, "measure")); import cam
OUT = os.path.dirname(os.path.abspath(__file__))
auto = json.load(open(os.path.join(OUT, "census_auto.json")))
px = json.load(open(os.path.join(DI, r"measure\data\tracks_px_clean.json")))
cap = cv2.VideoCapture(os.path.join(ROOT, "data", "demo.mp4"))
TW, TH = 479, 300
uu, vv = np.meshgrid(np.arange(TW), np.arange(TH))
gx, gy = cam.to_ground(uu.ravel() + 0.5, vv.ravel() + 0.5)
d = np.stack([(uu.ravel() + .5 - cam.CX) / cam.f, (vv.ravel() + .5 - cam.CY) / cam.f, np.ones(uu.size)], 1) @ cam.R
below = d[:, 2] < 0
crash = ((gy < -8.3) & below) | (~below & (uu.ravel() < 290))  # above horizon: left part
crash = crash.reshape(TH, TW)
res = {}
for fs, row in auto.items():
    f = int(fs); cap.set(cv2.CAP_PROP_POS_FRAMES, f); ok, img = cap.read(); tile = img[304:604, 481:960]
    hsv = cv2.cvtColor(tile, cv2.COLOR_BGR2HSV); H, S, V = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    wf = (S > 110) & (V > 110) & (((H >= 80) & (H <= 100)) | ((H >= 22) & (H <= 34)) | ((H >= 45) & (H <= 75)))
    wf &= crash
    cover = np.zeros((TH, TW), bool)
    for s in row["spec"]:
        b = s["bbox"]; cover[max(0, b[1] - 4):max(0, b[3] + 5), max(0, b[0] - 4):max(0, b[2] + 5)] = True
    r = wf & ~cover
    n, lab, st, cen = cv2.connectedComponentsWithStats(cv2.dilate(r.astype(np.uint8), np.ones((5, 5), np.uint8)))
    miss = []
    for i in range(1, n):
        x, y, w, h, a = st[i]
        cnt = int(r[y:y + h, x:x + w].sum())
        if cnt < 25: continue
        # nearest measured track (bbox centre distance) in this frame
        best = None
        for tr in px["tracks"]:
            fr = [q for q in tr["frames"] if abs(q["f"] - f) <= 0]
            if fr:
                bb = fr[0]["bbox"]; dd = np.hypot((bb[0] + bb[2]) / 2 - (x + w / 2), (bb[1] + bb[3]) / 2 - (y + h / 2))
                if best is None or dd < best[1]: best = (tr["id"], round(float(dd)))
        miss.append(dict(bbox=[int(x), int(y), int(x + w), int(y + h)], px=cnt, nearest_meas=best))
    ghosts = []
    for s in row["spec"]:
        b = s["bbox"]; sub = wf[max(0, b[1]):max(0, b[3]), max(0, b[0]):max(0, b[2])]
        if sub.size and sub.sum() < 8: ghosts.append(dict(id=s["id"], bbox=b, wf_px=int(sub.sum())))
    vis = cv2.resize(tile, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    for m in miss: b = m["bbox"]; cv2.rectangle(vis, (b[0] * 2, b[1] * 2), (b[2] * 2, b[3] * 2), (0, 0, 255), 2)
    for g in ghosts: b = g["bbox"]; cv2.rectangle(vis, (b[0] * 2, b[1] * 2), (b[2] * 2, b[3] * 2), (255, 0, 255), 2); cv2.putText(vis, g["id"], (b[0] * 2, b[1] * 2 - 2), 0, .4, (255, 0, 255), 1)
    cv2.imwrite(os.path.join(OUT, "overlays", f"f{f:03d}_resid.png"), vis)
    res[f] = dict(missing=miss, ghost_candidates=ghosts)
    print(f, "missing:", [(m["bbox"], m["px"], m["nearest_meas"]) for m in miss], "ghost:", [(g["id"], g["bbox"], g["wf_px"]) for g in ghosts])
json.dump(res, open(os.path.join(OUT, "residual.json"), "w"), indent=1)
