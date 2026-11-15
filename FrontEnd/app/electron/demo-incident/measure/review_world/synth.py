"""Synthetic tracks_px.json with known world truth, to test world_kinematics.py."""
import json, math, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import world_kinematics as wk  # noqa: E402

rng = np.random.default_rng(1)
DT = 1 / 12.5
truth, tracks = [], []


def gen(tid, cls, role, f0, f1, x0, y0, vfun, yfun, corners=False):
    k = wk.cls_key(cls); pr = wk.PRIOR[k]
    x = x0; frames = []; tru = []
    for f in range(f0, f1 + 1):
        t = (f - f0) * DT
        v = vfun(f); y = yfun(f)
        if f > f0:
            x += v * DT
        yn = yfun(f + 1)
        hd = math.degrees(math.atan2((yn - y) / DT, v))
        s = dict(x=x, y=y, heading_deg=hd, _cls=cls)
        uv = wk.project_box(s, pr["L"], pr["W"], pr["H"])
        bb = [uv[:, 0].min(), uv[:, 1].min(), uv[:, 0].max(), uv[:, 1].max()]
        bb = [float(np.clip(b + rng.normal(0, 1.0), 0, 479 if i % 2 == 0 else 300)) for i, b in enumerate(bb)]
        if bb[1] >= 299 or bb[3] < 0 or bb[2] - bb[0] < 2:
            continue
        fr = dict(f=f, bbox=bb, bottom=None, top=None, src="synth", occluded=False)
        if corners:
            g = wk.box_corners(s, pr["L"], pr["W"])
            u, vv = wk.cam.to_img(g[:, 0], g[:, 1], np.zeros(4))
            fr["bottom"] = [[float(a + rng.normal(0, 1.0)), float(b + rng.normal(0, 1.0))] for a, b in zip(u, vv)]
        if rng.random() < 0.03:  # occasional gross mis-detection
            fr["bbox"] = [b + 25 for b in bb]
        frames.append(fr); tru.append(dict(f=f, x=x, y=y, v=v))
    tracks.append(dict(id=tid, **{"class": cls}, paint="grey", paint_hex="#888888", role=role, frames=frames))
    truth.append(dict(id=tid, samples=tru))


# crash carriageway car decelerating, hard brake at f=200
gen("c1", "car", "", 100, 330, 160, -9.4, lambda f: -12.0 if f < 200 else min(-12 + 7.0 * (f - 200) * DT, -2.0), lambda f: -9.4)
# right carriageway truck steady
gen("t1", "truck", "", 0, 250, 55, 1.9, lambda f: 24.0, lambda f: 1.9)
# right carriageway car lane change, with corners
gen("c2", "car", "", 50, 220, 58, -1.9, lambda f: 30.0, lambda f: -1.9 + 3.75 / (1 + math.exp(-(f - 120) / 6.0)), corners=True)
# crash vehicle: van with impact at 279 (velocity jump)
gen("v1", "van", "van", 200, 320, 140, -5.6, lambda f: -10.0 if f < 279 else -3.0, lambda f: -5.6)
json.dump(dict(fps=12.5, frames=400, tracks=tracks), open(os.path.join(HERE, "synth_tracks_px.json"), "w"))
json.dump(truth, open(os.path.join(HERE, "synth_truth.json"), "w"))
print({t["id"]: len(t["frames"]) for t in tracks})
