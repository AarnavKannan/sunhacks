"""A9 road + divider geometry audit. Projects spec lines/footprints onto the BR tile and measures
pixel offsets against what is painted/visible. Read-only on everything outside this folder.
Run: python audit_road.py   (writes overlays/*.png and results.json next to this file)"""
import json, os, sys
import numpy as np, cv2

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
ROOT = os.path.abspath(os.path.join(APP, "..", ".."))
DI = os.path.join(APP, "electron", "demo-incident")
sys.path.insert(0, os.path.join(DI, "measure"))
import cam  # noqa: E402

OUT = os.path.join(HERE, "overlays")
os.makedirs(OUT, exist_ok=True)
spec = json.load(open(os.path.join(DI, "incident-spec.json")))
divp = os.path.join(DI, "measure", "data", "divider.json")
div = json.load(open(divp)) if os.path.exists(divp) else {}
XW = lambda x: 95.06 - np.asarray(x, float)
YW = lambda y: np.asarray(y, float) - 4.803
road = spec["road"]
fwd, bwd = road["lane_lines_forward_m"], road["lane_lines_backward_m"]

lines = {}  # name -> (Y_W, kind, X range)
for i, v in enumerate(fwd):
    lines[f"F{i}({v})"] = (float(YW(-v)), "ridge", (55, 335))
for i, v in enumerate(bwd):
    lines[f"B{i}({v})"] = (float(YW(+v)), "ridge", (55, 336))

st = {o["id"]: o for o in spec.get("static_objects", [])}


def yr(o):
    ys = [p[1] for p in o["footprint_m"]]
    xs = [p[0] for p in o["footprint_m"]]
    return float(YW(min(ys))), float(YW(max(ys))), float(min(XW(xs))), float(max(XW(xs)))


feat = {}
if "median-divider" in st:
    y0, y1, x0, x1 = yr(st["median-divider"])
    feat["verge crash face"] = (y0, "edge", (max(55, x0), min(335, x1)))
    feat["verge far face"] = (y1, "none", (max(55, x0), min(335, x1)))
    feat["verge_end_X"] = x1
if "median-barrier" in st:
    y0, y1, x0, x1 = yr(st["median-barrier"])
    feat["barrier"] = ((y0 + y1) / 2, "ridge", (55, 320))
    feat["barrier_h"] = st["median-barrier"]["height_m"]
    feat["barrier_y"] = (y0, y1, x0, x1)
if "median-hedge-far" in st:
    y0, y1, x0, x1 = yr(st["median-hedge-far"])
    feat["hedge"] = ((y0 + y1) / 2, "valley", (max(162, x0), 335))
    feat["hedge_y"] = (y0, y1, x0, x1)
    feat["hedge_h"] = st["median-hedge-far"]["height_m"]
snowY = (div.get("snow_band_Y") or [None, -6.94])[1]


def proj_line(Y, xr, Z=0.0, n=400):
    X = np.linspace(xr[0], xr[1], n)
    u, v = cam.to_img(X, np.full_like(X, Y), Z)
    return X, u, v


def u_at_row(Y, v_row, Z=0.0):
    """u of the line Y at image row v_row (and the X there)."""
    X = 100.0
    for _ in range(30):
        u, v = cam.to_img(X, Y, Z)
        u1, v1 = cam.to_img(X + 0.01, Y, Z)
        dv = (v1[0] - v[0]) / 0.01
        X = float(np.clip(X - (v[0] - v_row) / dv, 5, 5000))
    u, v = cam.to_img(X, Y, Z)
    return float(u[0]), X


def m_per_px(Y, X):
    u0, _ = cam.to_img(X, Y)
    u1, _ = cam.to_img(X, Y + 0.1)
    return 0.1 / abs(u1[0] - u0[0])


def measure(gray, Y, kind, xr, win=6, sign=0):
    g = gray.astype(np.float32)
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (9, 1))
    th = None
    if kind == "ridge":
        th = cv2.morphologyEx(g, cv2.MORPH_TOPHAT, k)
    elif kind == "valley":
        th = cv2.morphologyEx(g, cv2.MORPH_BLACKHAT, k)
    gx = cv2.Sobel(cv2.GaussianBlur(g, (3, 3), 0), cv2.CV_32F, 1, 0, ksize=3)
    res = []
    vmin = int(np.ceil(cam.to_img(xr[1], Y)[1][0]))
    vmax = int(np.floor(cam.to_img(xr[0], Y)[1][0]))
    for vr in range(max(0, vmin), min(gray.shape[0], vmax + 1)):
        up, X = u_at_row(Y, vr)
        if not (3 <= up < gray.shape[1] - 3):
            continue
        lo, hi = int(max(0, round(up) - win)), int(min(gray.shape[1] - 1, round(up) + win))
        if th is not None:
            prof = th[vr, lo:hi + 1]
            j = int(np.argmax(prof))
            c = float(prof[j])
            if c < 12:
                continue
            jj = float(j)
            if 0 < j < len(prof) - 1:
                a, b, d = prof[j - 1], prof[j], prof[j + 1]
                den = a - 2 * b + d
                if den != 0:
                    jj = j + 0.5 * (a - d) / den
        else:
            prof = gx[vr, lo:hi + 1] * (sign if sign else 1)
            j = int(np.argmax(prof if sign else np.abs(prof)))
            c = float(abs(prof[j]))
            if c < 40:
                continue
            jj = float(j)
        res.append((X, vr, lo + jj - up, m_per_px(Y, X), c))
    return res


BANDS = {"near": (55, 100), "mid": (100, 180), "far": (180, 340)}


def bands(res):
    out = {}
    for name, (a, b) in BANDS.items():
        r = [x for x in res if a <= x[0] < b]
        if len(r) < 3:
            out[name] = None
            continue
        d = np.array([x[2] for x in r])
        m = np.array([x[3] for x in r])
        out[name] = {"n": len(r), "px": round(float(np.median(d)), 2), "mad": round(float(np.median(np.abs(d - np.median(d)))), 2),
                     "m": round(float(np.median(d * m)), 3)}
    return out


def overlay(img, path, S=3):
    big = cv2.resize(img, None, fx=S, fy=S, interpolation=cv2.INTER_CUBIC)

    def poly(Y, xr, col, Z=0.0):
        X, u, v = proj_line(Y, xr, Z)
        pts = np.stack([u * S, v * S], 1).astype(np.int32)
        cv2.polylines(big, [pts], False, col, 1, cv2.LINE_AA)

    for nm, (Y, k, xr) in lines.items():
        poly(Y, xr, (0, 0, 255) if nm.startswith("F") else (255, 0, 255))
    if "verge crash face" in feat:
        xr = feat["verge crash face"][2]
        poly(feat["verge crash face"][0], xr, (0, 255, 255))
        poly(feat["verge far face"][0], xr, (0, 200, 255))
        poly(snowY, xr, (255, 255, 0))
        xe = feat["verge_end_X"]
        Ys = np.linspace(feat["verge crash face"][0], feat["verge far face"][0], 30)
        u, v = cam.to_img(np.full(30, xe), Ys)
        cv2.polylines(big, [np.stack([u * S, v * S], 1).astype(np.int32)], False, (0, 255, 255), 1)
    if "barrier" in feat:
        y0, y1, _, _ = feat["barrier_y"]
        for Y in (y0, y1):
            poly(Y, (55, 335), (0, 255, 0))
        poly((y0 + y1) / 2, (55, 335), (0, 140, 0), Z=feat["barrier_h"])
    if "hedge" in feat:
        y0, y1, x0, _ = feat["hedge_y"]
        for Y in (y0, y1):
            poly(Y, (x0, 335), (0, 128, 255))
        poly(y1, (x0, 335), (0, 64, 200), Z=feat["hedge_h"])
    cv2.imwrite(path, big)


results = {"spec_lines_W": {k: v[0] for k, v in lines.items()},
           "features": {k: list(v) if isinstance(v, tuple) else v for k, v in feat.items()}, "images": {}}
imgs = {}
bgp = os.path.join(DI, "measure", "data", "br_bg.png")
if os.path.exists(bgp):
    imgs["bg"] = cv2.imread(bgp)
cap = cv2.VideoCapture(os.path.join(ROOT, "data", "demo.mp4"))
for fi in (0, 213, 291, 399):
    cap.set(cv2.CAP_PROP_POS_FRAMES, fi)
    ok, fr = cap.read()
    if ok:
        imgs[f"f{fi:03d}"] = fr[304:604, 481:960]
        cv2.imwrite(os.path.join(OUT, f"raw_f{fi:03d}.png"), fr[304:604, 481:960])

for name, img in imgs.items():
    if img.shape[:2] != (300, 479):
        img = cv2.resize(img, (479, 300))
    overlay(img, os.path.join(OUT, f"{name}.png"))
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    rr = {}
    for nm, (Y, k, xr) in lines.items():
        rr[nm] = bands(measure(g, Y, k, xr))
    if "barrier" in feat:
        rr["barrier band (ctr)"] = bands(measure(g, feat["barrier"][0], "ridge", feat["barrier"][2]))
        rr["barrier lit foot -4.725"] = bands(measure(g, feat["barrier_y"][1], "ridge", (55, 320)))
    if "verge crash face" in feat:
        xr = feat["verge crash face"][2]
        rr["verge crash face (edge)"] = bands(measure(g, feat["verge crash face"][0], "edge", xr))
        rr["snow|grass (edge)"] = bands(measure(g, snowY, "edge", xr))
        rr["verge far face (edge)"] = bands(measure(g, feat["verge far face"][0], "edge", xr))
    if "hedge" in feat:
        rr["hedge dark band ctr"] = bands(measure(g, feat["hedge"][0], "valley", feat["hedge"][2], win=8))
    results["images"][name] = rr

fw, bw = np.diff(fwd), np.diff(bwd)
results["lanes"] = {"forward_count": len(fwd) - 1, "forward_widths": [round(float(x), 3) for x in fw],
                    "backward_count": len(bwd) - 1, "backward_widths": [round(float(x), 3) for x in bw],
                    "lanes_each_way": road.get("lanes_each_way")}
json.dump(results, open(os.path.join(HERE, "results.json"), "w"), indent=1)
for name, rr in results["images"].items():
    print("==", name)
    for k, v in rr.items():
        cells = []
        for b, s in v.items():
            cells.append(f"{b}:" + ("-" if s is None else f"{s['px']:+.2f}px({s['m']:+.3f}m,n{s['n']},mad{s['mad']})"))
        print(f"  {k:26s}", "  ".join(cells))
print(results["lanes"])
print({k: v for k, v in results["features"].items()})
