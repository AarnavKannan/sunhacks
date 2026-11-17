import cv2, numpy as np, json
bg = cv2.imread("br_bg.png")
hsv = cv2.cvtColor(bg, cv2.COLOR_BGR2HSV)
gray = cv2.cvtColor(bg, cv2.COLOR_BGR2GRAY).astype(np.int16)
local = cv2.blur(gray, (15, 15))
mask = ((gray - local > 18) & (hsv[..., 1] < 40)).astype(np.uint8)
mask[:40] = 0  # sky/scenery
n, lab, stats, cent = cv2.connectedComponentsWithStats(mask, 8)
out = []
vis = cv2.resize(bg, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
for i in range(1, n):
    x, y, w, h, a = stats[i]
    if a < 4 or a > 600: continue
    ys, xs = np.where(lab == i)
    # endpoints along the blob's principal axis
    pts = np.stack([xs, ys], 1).astype(float); c = pts.mean(0)
    u, s, vt = np.linalg.svd(pts - c, full_matrices=False); d = vt[0]
    proj = (pts - c) @ d
    p0 = c + d * proj.min(); p1 = c + d * proj.max()
    if p0[1] > p1[1]: p0, p1 = p1, p0   # p0 = far (top), p1 = near (bottom)
    elong = s[0] / max(s[1], 1e-6)
    if elong < 2.0: continue
    k = len(out)
    out.append({"id": k, "far": [round(p0[0], 1), round(p0[1], 1)], "near": [round(p1[0], 1), round(p1[1], 1)], "area": int(a)})
    cv2.line(vis, tuple(int(v * 2) for v in p0), tuple(int(v * 2) for v in p1), (0, 0, 255), 2)
    cv2.putText(vis, str(k), (int(c[0] * 2) + 6, int(c[1] * 2)), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 255), 1)
json.dump(out, open("dashes.json", "w"))
cv2.imwrite("dashes_vis.png", vis)
print(len(out))
