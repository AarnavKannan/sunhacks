"""A7 vehicle census: overlay spec cuboids (magenta, labelled) + measured px tracks (thin white) on the BR tile."""
import json, os, sys, numpy as np, cv2
ROOT = r"C:\Users\anvit\.t3\projects\sunhacks-testing"
DI = os.path.join(ROOT, r"apps\desktop\electron\demo-incident")
sys.path.insert(0, os.path.join(DI, "measure")); import cam
OUT = os.path.dirname(os.path.abspath(__file__))
FR = [0, 50, 100, 125, 150, 188, 213, 250, 270, 279, 284, 288, 291, 300, 320, 350, 399]
if len(sys.argv) > 1: FR = [int(a) for a in sys.argv[1:]]
spec = json.load(open(os.path.join(DI, "incident-spec.json")))
px = json.load(open(os.path.join(DI, r"measure\data\tracks_px_clean.json")))
X0, Y0, TW, TH = 481, 304, 479, 300
cap = cv2.VideoCapture(os.path.join(ROOT, "data", "demo.mp4"))
def pose(o, t):
    k = o["keyframes"]; ts = np.array([q["t_s"] for q in k])
    if t < o["visible_from_s"] - 1e-6 or t > o["visible_to_s"] + 1e-6 or t < ts[0] - 1e-6 or t > ts[-1] + 1e-6: return None
    i = int(np.clip(np.searchsorted(ts, t), 1, len(ts) - 1)) if len(ts) > 1 else 0
    if len(ts) == 1: q = k[0]; return q["x_m"], q["y_m"], q["heading_deg"]
    a, b = k[i - 1], k[i]; w = 0 if b["t_s"] == a["t_s"] else (t - a["t_s"]) / (b["t_s"] - a["t_s"]); w = np.clip(w, 0, 1)
    dh = (b["heading_deg"] - a["heading_deg"] + 180) % 360 - 180
    return a["x_m"] + w * (b["x_m"] - a["x_m"]), a["y_m"] + w * (b["y_m"] - a["y_m"]), a["heading_deg"] + w * dh
def corners(o, p):
    X, Y = 95.06 - p[0], p[1] - 4.803; h = np.radians(180 - p[2]); L, W = o["length_m"] / 2, o["width_m"] / 2
    c, s = np.cos(h), np.sin(h); pts = []
    for dl, dw in [(L, W), (L, -W), (-L, -W), (-L, W)]: pts.append((X + dl * c - dw * s, Y + dl * s + dw * c))
    return X, Y, pts
COL = {"van": (0, 255, 255), "truck": (0, 200, 0), "hatchback": (255, 0, 255), "sedan": (255, 0, 255)}
rows = {}
for f in FR:
    cap.set(cv2.CAP_PROP_POS_FRAMES, f); ok, img = cap.read(); tile = img[Y0:Y0 + TH, X0:X0 + TW].copy()
    S = 2; big = cv2.resize(tile, None, fx=S, fy=S, interpolation=cv2.INTER_CUBIC); raw = big.copy()
    t = round(f * 0.08, 4); vis = []
    for o in spec["objects"]:
        p = pose(o, t)
        if p is None: continue
        X, Y, pts = corners(o, p)
        if X < 1.0: continue
        bu, bv = cam.to_img([q[0] for q in pts], [q[1] for q in pts], 0.0)
        tu, tv = cam.to_img([q[0] for q in pts], [q[1] for q in pts], o["height_m"])
        cu, cv_ = cam.to_img(X, Y, 0.0)
        allu = np.r_[bu, tu]; allv = np.r_[bv, tv]
        inside = (allu.max() > 0) and (allu.min() < TW) and (allv.max() > 0) and (allv.min() < TH)
        if not inside: continue
        cin = 0 <= cu[0] < TW and 0 <= cv_[0] < TH
        vis.append(dict(id=o["id"], cat=o["category"], col=o["color_name"], X=round(X, 1), Y=round(Y, 1), u=round(float(cu[0])), v=round(float(cv_[0])), centre_in=bool(cin),
                        bbox=[round(float(allu.min())), round(float(allv.min())), round(float(allu.max())), round(float(allv.max()))]))
        col = COL.get(o["category"], (255, 0, 255))
        B = np.c_[bu, bv] * S; T = np.c_[tu, tv] * S
        for a in range(4):
            cv2.line(big, tuple(B[a].astype(int)), tuple(B[(a + 1) % 4].astype(int)), col, 1, cv2.LINE_AA)
            cv2.line(big, tuple(T[a].astype(int)), tuple(T[(a + 1) % 4].astype(int)), col, 1, cv2.LINE_AA)
            cv2.line(big, tuple(B[a].astype(int)), tuple(T[a].astype(int)), col, 1, cv2.LINE_AA)
        lp = (int(T[:, 0].min()), max(10, int(T[:, 1].min()) - 3))
        cv2.putText(big, o["id"], lp, cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 0), 3); cv2.putText(big, o["id"], lp, cv2.FONT_HERSHEY_SIMPLEX, 0.4, col, 1)
    # measured px tracks: label at bbox bottom-centre in white
    meas = []
    for tr in px["tracks"]:
        for fr in tr["frames"]:
            if fr["f"] == f:
                b = fr["bbox"]; meas.append(dict(id=tr["id"], cls=tr["class"], src=fr["src"], bbox=[round(v) for v in b]))
                cv2.rectangle(big, (int(b[0] * S), int(b[1] * S)), (int(b[2] * S), int(b[3] * S)), (255, 255, 255), 1)
                cv2.putText(big, tr["id"], (int(b[0] * S), int(b[3] * S) + 10), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (255, 255, 255), 1)
    cv2.putText(big, f"f{f} t={t:.2f}s spec(colour)=cat  meas=white", (5, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
    cv2.imwrite(os.path.join(OUT, "overlays", f"f{f:03d}_overlay.png"), big)
    cv2.imwrite(os.path.join(OUT, "overlays", f"f{f:03d}_raw2x.png"), raw)
    rows[f] = dict(spec=vis, measured=meas)
    print(f, "spec", len(vis), "meas", len(meas))
json.dump(rows, open(os.path.join(OUT, "census_auto.json"), "w"), indent=1)
