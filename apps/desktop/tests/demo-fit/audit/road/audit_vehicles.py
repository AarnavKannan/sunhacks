"""A9: do spec vehicles sit inside lanes? Plan frame (x along road, y left). Crash side is plan y<0."""
import json, os
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DI = os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", "electron", "demo-incident"))
spec = json.load(open(os.path.join(DI, "incident-spec.json")))
fwd = [-v for v in spec["road"]["lane_lines_forward_m"]]  # plan y of crash-side lines (0 = inner edge)
bwd = list(spec["road"]["lane_lines_backward_m"])
st = {o["id"]: o for o in spec.get("static_objects", [])}
verge = st.get("median-divider")
vy = [p[1] for p in verge["footprint_m"]] if verge else [-3.834, -0.222]
vx = [p[0] for p in verge["footprint_m"]] if verge else [-1e9, 1e9]
VERGE_Y0, VERGE_Y1, VERGE_X0, VERGE_X1 = min(vy), max(vy), min(vx), max(vx)
inner_edge, outer_edge = fwd[0], fwd[-1]
inner_lines = fwd[1:-1]
DT = 0.08
out = {"on_line": [], "on_verge": [], "beyond_outer": [], "wrong_side": [], "over_inner_edge": [], "summary": {}}


def runs(mask, t, min_s):
    res, start = [], None
    for i, m in enumerate(list(mask) + [False]):
        if m and start is None:
            start = i
        if not m and start is not None:
            if t[i - 1] - t[start] + DT >= min_s:
                res.append((round(float(t[start]), 2), round(float(t[i - 1]), 2)))
            start = None
    return res


n_ok = 0
for o in spec["objects"]:
    kf = o["keyframes"]
    if len(kf) < 2:
        continue
    t = np.arange(kf[0]["t_s"], kf[-1]["t_s"] + 1e-6, DT)
    kt = np.array([k["t_s"] for k in kf])
    x = np.interp(t, kt, [k["x_m"] for k in kf])
    y = np.interp(t, kt, [k["y_m"] for k in kf])
    h = np.radians(np.interp(t, kt, [k["heading_deg"] for k in kf]))
    L, W = o["length_m"], o["width_m"]
    half_lat = 0.5 * (np.abs(np.sin(h)) * L + np.abs(np.cos(h)) * W)
    d_line = np.min(np.abs(y[:, None] - np.array(inner_lines)[None, :]), 1) if inner_lines else np.full_like(y, 9)
    bad = False
    r = runs(d_line < 0.35, t, 1.5)
    if r:
        out["on_line"].append({"id": o["id"], "runs": r, "min_d": round(float(d_line.min()), 3)}); bad = True
    in_vx = (x >= VERGE_X0) & (x <= VERGE_X1)
    on_verge = in_vx & (y + half_lat > VERGE_Y0 + 0.05)
    r = runs(on_verge, t, 0.08)
    if r:
        out["on_verge"].append({"id": o["id"], "runs": r, "max_intrusion_m": round(float(np.max((y + half_lat - VERGE_Y0)[on_verge])), 3)}); bad = True
    over_edge = (y + half_lat > inner_edge + 0.05) & ~on_verge
    r = runs(over_edge, t, 0.5)
    if r:
        out["over_inner_edge"].append({"id": o["id"], "runs": r[:4], "max_m": round(float(np.max(y + half_lat - inner_edge)), 3)})
    beyond = y - half_lat < outer_edge - 0.3
    r = runs(beyond, t, 0.08)
    if r:
        out["beyond_outer"].append({"id": o["id"], "runs": r[:4], "min_y": round(float(np.min(y - half_lat)), 2)}); bad = True
    if np.any(y > 0):
        out["wrong_side"].append({"id": o["id"], "max_y": round(float(y.max()), 2)}); bad = True
    n_ok += not bad
out["summary"] = {"vehicles": len(spec["objects"]), "clean": n_ok, "on_line": len(out["on_line"]), "on_verge": len(out["on_verge"]),
                  "beyond_outer": len(out["beyond_outer"]), "wrong_side": len(out["wrong_side"]), "over_inner_edge_no_verge": len(out["over_inner_edge"])}
json.dump(out, open(os.path.join(HERE, "vehicles.json"), "w"), indent=1)
print(json.dumps(out["summary"]))
for k in ("on_verge", "wrong_side", "beyond_outer", "over_inner_edge", "on_line"):
    print("--", k)
    for e in out[k][:40]:
        print("  ", e)
