"""A6 lane-change timing audit: incident-spec.json keyframes vs measured tracks (tracks_world.json, crash_pair.json).
Run: python audit_lanes.py  -> writes lanes_report.json next to this file and prints a summary."""
import json, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
DI = os.path.join(APP, "electron", "demo-incident")
DATA = os.path.join(DI, "measure", "data")
FPS = 12.5
Y_MED = 4.803  # plan y = Y_W + 4.803

spec = json.load(open(os.path.join(DI, "incident-spec.json"), encoding="utf-8"))
tw = json.load(open(os.path.join(DATA, "tracks_world.json"), encoding="utf-8"))
cp = json.load(open(os.path.join(DATA, "crash_pair.json"), encoding="utf-8"))
LINES = np.array(spec["road"]["lane_lines_forward_m"])  # depth from median, plan y = -line


def lane_of(y_plan):
    return int(np.sum(-y_plan > LINES))  # 0 = median side of inner edge, 1..6 lanes, 7 beyond outer edge


def line_dist(y_plan):
    d = np.abs(-y_plan - LINES)
    i = int(np.argmin(d))
    return d[i], i


def changes(series):
    """series: sorted list of (f, lane). Returns [(f_first_new, from, to)] on every contiguous frame step."""
    out = []
    for (f0, a), (f1, b) in zip(series, series[1:]):
        if a != b and f1 - f0 == 1:
            out.append((f1, a, b))
        elif a != b:
            out.append((f1, a, b))
    return out


def collapse(ch, series_map, min_hold=6):
    """Net changes: drop flicker (A->B->A within min_hold frames) -> list of (f, from, to, n_flicker)."""
    res = []
    i = 0
    while i < len(ch):
        f, a, b = ch[i]
        j = i
        flick = 0
        # absorb immediate reversals
        while j + 1 < len(ch) and ch[j + 1][0] - ch[j][0] < min_hold:
            j += 1
            flick += 1
        net_from, net_to = a, ch[j][2]
        if net_from != net_to:
            res.append((f, net_from, net_to, flick))
        elif flick:
            res.append((f, a, a, flick))  # pure flicker
        i = j + 1
    return res


report = {"spec_lines": LINES.tolist(), "vehicles": {}}
meas = {t["id"]: t for t in tw["tracks"] if t.get("carriageway") == "crash"}
meas["yellow-car"] = {"id": "yellow-car", "samples": cp["vehicles"]["yellow-car"]["samples"]}
meas["white-van"] = {"id": "white-van", "samples": cp["vehicles"]["white-van"]["samples"]}

spec_ids = set()
for o in spec["objects"]:
    vid = o["id"]
    spec_ids.add(vid)
    kf = o["keyframes"]
    s_series = [(int(round(k["t_s"] * FPS)), lane_of(k["y_m"])) for k in kf]
    s_y = {int(round(k["t_s"] * FPS)): k["y_m"] for k in kf}
    s_x = {int(round(k["t_s"] * FPS)): k["x_m"] for k in kf}
    m = meas.get(vid)
    rec = {"category": o["category"], "spec_frames": [s_series[0][0], s_series[-1][0]]}
    s_ch = changes(s_series)
    rec["spec_changes_raw"] = s_ch
    rec["spec_changes"] = collapse(s_ch, None)
    # line sitting: centre within 0.35 m of a line for >= 12 consecutive frames
    sits = []
    run = None
    for f, _ in s_series:
        d, i = line_dist(s_y[f])
        if d < 0.35:
            if run and run[2] == i and run[1] == f - 1:
                run[1] = f
            else:
                if run and run[1] - run[0] + 1 >= 12:
                    sits.append(tuple(run))
                run = [f, f, i]
        else:
            if run and run[1] - run[0] + 1 >= 12:
                sits.append(tuple(run))
            run = None
    if run and run[1] - run[0] + 1 >= 12:
        sits.append(tuple(run))
    rec["line_sits"] = [(a, b, f"line {i} ({['inner edge','1|2','2|3','3|4','4|5','5|6','outer edge'][i]})",
                         round(float(np.mean([s_x[f] for f in range(a, b + 1)])), 1)) for a, b, i in sits]
    if m:
        ms = {int(s["f"]): s for s in m["samples"] if int(s["f"]) < 400}
        m_series = [(f, lane_of(ms[f]["y"] + Y_MED)) for f in sorted(ms)]
        m_field = [(f, ms[f].get("lane")) for f in sorted(ms) if ms[f].get("lane") is not None]
        rec["meas_frames"] = [m_series[0][0], m_series[-1][0]]
        rec["meas_changes"] = collapse(changes(m_series), None)
        rec["meas_field_changes"] = collapse(changes(m_field), None)
        # per-frame disagreement and lateral deviation over the measured span
        dis = [f for f, l in m_series if f in s_y and lane_of(s_y[f]) != l]
        rec["lane_mismatch_frames"] = dis
        dy = [(f, s_y[f] - (ms[f]["y"] + Y_MED)) for f in sorted(ms) if f in s_y]
        rec["max_lat_dev"] = max(((abs(d), f) for f, d in dy), default=(0, None))
        rec["field_vs_y_mismatch"] = sum(1 for f, l in m_field if lane_of(ms[f]["y"] + Y_MED) != l)
        rec["src_at"] = {f: ms[f].get("src") for f in dis[:3]}
    else:
        rec["meas_frames"] = None
    report["vehicles"][vid] = rec

report["dropped_measured_ids"] = sorted(set(meas) - spec_ids)
dropped_with_changes = {}
for vid in report["dropped_measured_ids"]:
    ms = {int(s["f"]): s for s in meas[vid]["samples"] if int(s["f"]) < 400}
    ser = [(f, lane_of(ms[f]["y"] + Y_MED)) for f in sorted(ms)]
    ch = collapse(changes(ser), None)
    if any(a != b for _, a, b, _ in ch):
        dropped_with_changes[vid] = {"frames": [ser[0][0], ser[-1][0]], "changes": ch}
report["dropped_with_changes"] = dropped_with_changes
report["yellow_lane_sequence"] = cp["lane_sequence"]["yellow-car"]


def match(mc, sc, win=25):
    mc = [c for c in mc if c[1] != c[2]]
    sc = [c for c in sc if c[1] != c[2]]
    used = set()
    pairs, missing = [], []
    for c in mc:
        best = None
        for j, d in enumerate(sc):
            if j in used or (d[1], d[2]) != (c[1], c[2]):
                continue
            if abs(d[0] - c[0]) <= win and (best is None or abs(d[0] - c[0]) < abs(sc[best][0] - c[0])):
                best = j
        if best is None:
            missing.append(c)
        else:
            used.add(best)
            pairs.append((c[0], sc[best][0], c[1], c[2]))
    invented = [d for j, d in enumerate(sc) if j not in used]
    return pairs, missing, invented


summary = []
for vid, rec in report["vehicles"].items():
    if not rec.get("meas_frames"):
        summary.append((vid, "NO MEASURED TRACK"))
        continue
    lo, hi = rec["meas_frames"]
    sc_in = [c for c in rec["spec_changes"] if lo <= c[0] <= hi]
    sc_out = [c for c in rec["spec_changes"] if not (lo <= c[0] <= hi) and c[1] != c[2]]
    pairs, missing, invented = match(rec["meas_changes"], sc_in)
    rec["matched"] = pairs
    rec["missing"] = missing
    rec["invented"] = invented
    rec["changes_outside_measured_span"] = sc_out
    shifted = [p for p in pairs if abs(p[1] - p[0]) > 1]
    rec["shifted"] = shifted
    flick_s = sum(c[3] for c in rec["spec_changes"])
    flick_m = sum(c[3] for c in rec["meas_changes"])
    rec["flicker"] = (flick_s, flick_m)
    if shifted or missing or invented or sc_out or rec["line_sits"] or len(rec["lane_mismatch_frames"]) or flick_s:
        summary.append((vid, {k: rec[k] for k in ("matched", "shifted", "missing", "invented", "changes_outside_measured_span",
                                                  "line_sits", "flicker", "max_lat_dev", "meas_frames", "spec_frames")} |
                        {"n_mismatch": len(rec["lane_mismatch_frames"]),
                         "mismatch_span": [rec["lane_mismatch_frames"][0], rec["lane_mismatch_frames"][-1]] if rec["lane_mismatch_frames"] else None}))

json.dump(report, open(os.path.join(HERE, "lanes_report.json"), "w"), indent=1, default=str)
for vid, s in summary:
    print(vid, json.dumps(s, default=str))
print("dropped measured ids:", report["dropped_measured_ids"])
print("dropped with lane changes:", json.dumps(dropped_with_changes))
print("spec mtime", os.path.getmtime(os.path.join(DI, "incident-spec.json")))
