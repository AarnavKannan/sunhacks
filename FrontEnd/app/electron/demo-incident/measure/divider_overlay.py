"""Reprojects every calibrated painted line and the median objects of data/divider.json onto the crash tile.

Run from measure/:  python divider_overlay.py   -> review_calib/divider_overlay_bg.png, divider_overlay_f<N>.png (3x)
Lines are drawn only over the X range where calibration saw them (solid) and dotted beyond; divider footprints
are drawn at Z=0 (foot) and at their height (top) so raised objects can be compared with the picture.
"""
import json, os, subprocess, sys
import numpy as np, cv2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cam  # noqa: E402

DATA = os.path.join(HERE, "data")
OUT = os.path.join(HERE, "review_calib")
VIDEO = os.path.normpath(os.path.join(HERE, "..", "..", "..", "..", "..", "demo_32s.mp4"))
S = 3  # upscale

cal = json.load(open(os.path.join(DATA, "br_camera.json")))
div = json.load(open(os.path.join(DATA, "divider.json")))
lines = cal["lines_Y"]
seen = cal["residuals"]["line_X_seen"]


def poly(img, X, Y, Z, color, thick=1, dotted=False):
    u, v = cam.to_img(np.asarray(X, float), np.asarray(Y, float), np.asarray(Z, float) + 0 * np.asarray(X, float))
    pts = np.stack([u, v], 1) * S
    ok = (pts[:, 0] > -50 * S) & (pts[:, 0] < 530 * S) & (pts[:, 1] > -50 * S) & (pts[:, 1] < 350 * S)
    pts = pts[ok]
    for i in range(len(pts) - 1):
        if dotted and i % 2:
            continue
        cv2.line(img, tuple(int(round(c)) for c in pts[i]), tuple(int(round(c)) for c in pts[i + 1]), color, thick, cv2.LINE_AA)


def draw(img):
    for name, Y in lines.items():
        x0, x1 = seen.get(name, (56, 330))
        col = (0, 0, 255) if name.startswith("L") else (255, 128, 0)
        Xs = np.linspace(x0, x1, 120)
        poly(img, Xs, np.full_like(Xs, Y), 0, col, 1)
        for a, b in ((52, x0), (x1, 340)):
            if b > a:
                Xd = np.linspace(a, b, 40)
                poly(img, Xd, np.full_like(Xd, Y), 0, col, 1, dotted=True)
        u, v = cam.to_img(x0, Y)
        cv2.putText(img, name, (int(u[0] * S) + 4, int(v[0] * S)), cv2.FONT_HERSHEY_SIMPLEX, 0.4, col, 1, cv2.LINE_AA)
    colors = {"median-divider": (0, 255, 0), "median-barrier": (0, 255, 255), "median-hedge-far": (255, 0, 255)}
    for o in [div] + div.get("related_objects", []):
        fp = o["footprint_W"] + o["footprint_W"][:1]
        col = colors.get(o["id"], (255, 255, 255))
        for a, b in zip(fp, fp[1:]):
            Xs = np.linspace(a[0], b[0], 80)
            Ys = np.linspace(a[1], b[1], 80)
            poly(img, Xs, Ys, 0, col, 1)
            if o["height_m"] > 0.2:
                poly(img, Xs, Ys, o["height_m"], col, 1, dotted=True)
    # verge snow/grass boundary
    if div.get("snow_band_Y"):
        Xs = np.linspace(*div["x_range"], 80)
        poly(img, Xs, np.full_like(Xs, div["snow_band_Y"][1]), 0, (200, 200, 200), 1, dotted=True)
    # X ticks along the crash-side edge line
    for X in range(60, 321, 20):
        u, v = cam.to_img(X, lines["L_edge_inner"] - 0.6)
        if 0 <= v[0] < 300:
            cv2.putText(img, str(X), (int(u[0] * S) - 30, int(v[0] * S)), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 200, 255), 1, cv2.LINE_AA)
    return img


def frame(n):
    path = os.path.join(OUT, f"_f{n}.png")
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", VIDEO, "-vf", f"select=eq(n\\,{n}),crop=479:300:481:304",
                    "-vframes", "1", path], check=True)
    im = cv2.imread(path)
    os.remove(path)
    return im


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    bg = cv2.imread(os.path.join(DATA, "br_bg.png"))
    big = cv2.resize(bg, None, fx=S, fy=S, interpolation=cv2.INTER_CUBIC)
    cv2.imwrite(os.path.join(OUT, "divider_overlay_bg.png"), draw(big))
    # crop of the median near the crash site, 3x
    cv2.imwrite(os.path.join(OUT, "divider_overlay_bg_crash.png"), draw(cv2.resize(bg, None, fx=S, fy=S, interpolation=cv2.INTER_CUBIC))[60 * S:300 * S, 0:330 * S])
    for n in [int(a) for a in sys.argv[1:]] or [0, 296, 360]:
        im = frame(n)
        cv2.imwrite(os.path.join(OUT, f"divider_overlay_f{n}.png"), draw(cv2.resize(im, None, fx=S, fy=S, interpolation=cv2.INTER_CUBIC)))
    print("wrote", OUT)
