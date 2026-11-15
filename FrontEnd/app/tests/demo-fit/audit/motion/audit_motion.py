"""A10 motion + continuity audit of electron/demo-incident/incident-spec.json (frames 0..399).

Run:  python audit_motion.py            -> writes results.json (+ prints a summary)
Read-only on everything outside this folder.
"""
import json, math, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
DI = os.path.join(APP, "electron", "demo-incident")
sys.path.insert(0, os.path.join(DI, "measure"))
import cam  # noqa: E402

FPS, DT, N = 12.5, 0.08, 400
X_REF, Y_MED = 95.06, -4.803
TW, TH = 479, 300
MODELS = {"sedan": (4.89, 2.18), "hatchback": (4.38, 2.14), "suv": (5.14, 2.32), "van": (5.284, 2.36), "truck": (12.5, 3.06)}
DEFAULT_LEN = {"sedan": 4.7, "hatchback": 4.2, "suv": 4.8, "van": 5.2, "truck": 8.5}
MAX_LEN = {"truck": 16.6}
BODY_W = 0.9
CRASH_F0 = 280  # crash window for the crash pair (verge f283, contact f291)


def drawn(cat, length):
    lo, hi = DEFAULT_LEN[cat] * 0.6, MAX_LEN.get(cat, DEFAULT_LEN[cat] * 1.4)
    length = min(hi, max(lo, length))
    ml, mw = MODELS[cat]
    s = min(1.35, max(0.75, length / ml))
    return ml * s, mw * s * BODY_W


def wrap(a):
    return (a + 180.0) % 360.0 - 180.0


def corners(x, y, h, L, W):
    c, s = math.cos(math.radians(h)), math.sin(math.radians(h))
    return np.array([(x + dx * c - dy * s, y + dx * s + dy * c) for dx, dy in ((L / 2, W / 2), (L / 2, -W / 2), (-L / 2, -W / 2), (-L / 2, W / 2))])


def penetration(a, b):
    """SAT minimum penetration depth (m); 0 if separated."""
    best = 1e9
    for poly in (a, b):
        for i in range(4):
            e = poly[(i + 1) % 4] - poly[i]
            n = np.array([e[1], -e[0]]) / (np.hypot(*e) + 1e-12)
            pa, pb = a @ n, b @ n
            o = min(pa.max(), pb.max()) - max(pa.min(), pb.min())
            if o <= 0:
                return 0.0
            best = min(best, o)
    return best


def proj(x, y):
    u, v = cam.to_img(X_REF - x, y + Y_MED)
    return float(u[0]), float(v[0])


def main():
    spec_path = os.path.join(DI, "incident-spec.json")
    spec = json.load(open(spec_path, encoding="utf-8"))
    tw = json.load(open(os.path.join(DI, "measure", "data", "tracks_world.json"), encoding="utf-8"))
    cp = json.load(open(os.path.join(DI, "measure", "data", "crash_pair.json"), encoding="utf-8"))
    meas = {}
    for t in tw["tracks"]:
        meas[t["id"]] = {s["f"]: s for s in t["samples"] if s["f"] < N}
    for vid, v in cp["vehicles"].items():
        meas[vid] = {s["f"]: s for s in v["samples"] if s["f"] < N}
    mtrack = {t["id"]: t for t in tw["tracks"]}

    objs = spec["objects"]
    R = {"spec_mtime": os.path.getmtime(spec_path), "n_objects": len(objs), "timing": {}, "kin": [], "overlaps": [],
         "pops": [], "moved": [], "fragments": []}

    # ---- (5) timing / density
    bad_t, gaps, dens = [], [], []
    poses = {}  # id -> {frame: (x, y, h)}
    for o in objs:
        k = o["keyframes"]
        fr = []
        for kf in k:
            f = kf["t_s"] * FPS
            fi = round(f)
            if abs(f - fi) > 1e-6 or abs(kf["t_s"] - round(fi / FPS, 3)) > 1e-9:
                bad_t.append((o["id"], kf["t_s"]))
            fr.append(fi)
        d = np.diff(fr)
        if len(d) and d.max() > 1:
            gaps.append((o["id"], int(d.max()), int((d > 1).sum())))
        if len(d) and d.min() < 1:
            gaps.append((o["id"], "non-increasing", int(d.min())))
        dens.append(len(k))
        poses[o["id"]] = {fi: (kf["x_m"], kf["y_m"], kf["heading_deg"], kf["speed_mps"]) for fi, kf in zip(fr, k)}
        if abs(o["visible_from_s"] - k[0]["t_s"]) > 1e-9 or abs(o["visible_to_s"] - k[-1]["t_s"]) > 1e-9:
            bad_t.append((o["id"], "visible_from/to != first/last keyframe"))
    R["timing"] = {"bad": bad_t[:50], "n_bad": len(bad_t), "gaps": gaps, "kf_total": int(sum(dens)),
                   "kf_min": int(min(dens)), "kf_median": float(np.median(dens)), "kf_max": int(max(dens)),
                   "duration_s": spec["duration_s"]}

    # ---- (1) kinematics
    for o in objs:
        p = poses[o["id"]]
        fs = sorted(p)
        if len(fs) < 3:
            continue
        A = np.array([p[f] for f in fs])
        x, y, h, sp = A[:, 0], A[:, 1], A[:, 2], A[:, 3]
        vx, vy = np.diff(x) / DT, np.diff(y) / DT
        v = np.hypot(vx, vy)
        acc = np.diff(v) / DT
        dh = np.array([wrap(b - a) for a, b in zip(h[:-1], h[1:])])
        crash = o["involvement"] == "crash"
        issues = []
        fm = np.array(fs)
        near = lambda i: -150 <= x[i] <= 60
        # teleports: step > 5 m in one frame (62 m/s) or step > 3x the neighbouring step
        for i in range(len(v)):
            prev = v[i - 1] if i else v[i + 1] if i + 1 < len(v) else v[i]
            nxt = v[i + 1] if i + 1 < len(v) else prev
            if v[i] * DT > 2.0 and v[i] > 2.5 * max(prev, nxt, 1.0):
                issues.append(("teleport", int(fm[i + 1]), round(float(v[i] * DT), 2), round(float(x[i + 1]), 1)))
        # implausible acceleration (>8 m/s^2) outside crash window
        big = [i for i in range(len(acc)) if abs(acc[i]) > 8 and not (crash and fm[i + 1] >= CRASH_F0)]
        # yaw-rate / heading flips
        flips = [i for i in range(len(dh)) if abs(dh[i]) > 45]
        yawr = [i for i in range(len(dh)) if abs(dh[i]) / DT > 30 and abs(dh[i]) <= 45 and not (crash and fm[i + 1] >= CRASH_F0)]
        # crab: heading vs velocity direction, speed > 3 m/s
        crab = []
        for i in range(len(v)):
            if v[i] > 3:
                hv = math.degrees(math.atan2(vy[i], vx[i]))
                hm = h[i + 1]
                e = abs(wrap(hv - hm))
                if e > 10 and not (crash and fm[i + 1] >= CRASH_F0):
                    crab.append((int(fm[i + 1]), round(e, 1)))
        # jitter: rms of second difference of y (lateral) & x, and accel sign flips
        d2y = np.diff(y, 2) / DT ** 2
        jit_lat = float(np.sqrt(np.mean(d2y ** 2))) if len(d2y) else 0.0
        flipsign = int(np.sum((acc[:-1] * acc[1:] < 0) & (np.abs(acc[:-1]) > 3) & (np.abs(acc[1:]) > 3)))
        # speed field vs implied
        sp_err = float(np.median(np.abs(sp[1:] - v))) if len(v) else 0
        # extrapolation boundary heading jump (extend_exit sets heading 0)
        seg = {"id": o["id"], "cat": o["category"], "crash": crash, "frames": [int(fs[0]), int(fs[-1])],
               "x_range": [round(float(x.min()), 1), round(float(x.max()), 1)],
               "v_med": round(float(np.median(v)), 1), "v_max": round(float(v.max()), 1),
               "teleports": issues, "n_bigacc": len(big),
               "bigacc": [(int(fm[i + 1]), round(float(acc[i]), 1), round(float(x[i + 1]), 1)) for i in big][:12],
               "bigacc_near": [(int(fm[i + 1]), round(float(acc[i]), 1), round(float(x[i + 1]), 1)) for i in big if near(i + 1)][:12],
               "n_bigacc_near": sum(1 for i in big if near(i + 1)),
               "flips": [(int(fm[i + 1]), round(float(dh[i]), 1), round(float(x[i + 1]), 1)) for i in flips],
               "yawrate": [(int(fm[i + 1]), round(float(dh[i] / DT), 0), round(float(x[i + 1]), 1)) for i in yawr][:10],
               "n_yawrate": len(yawr),
               "crab_n": len(crab), "crab_max": max([c[1] for c in crab], default=0), "crab": crab[:8],
               "jit_lat_rms": round(jit_lat, 2), "acc_signflips": flipsign, "speed_field_err": round(sp_err, 2)}
        R["kin"].append(seg)

    # ---- (2) overlaps
    size = {o["id"]: drawn(o["category"], o["length_m"]) for o in objs}
    ids = [o["id"] for o in objs]
    inv = {o["id"]: o["involvement"] for o in objs}
    ov = {}
    for f in range(N):
        pres = [i for i in ids if f in poses[i]]
        for a in range(len(pres)):
            for b in range(a + 1, len(pres)):
                A, B = poses[pres[a]][f], poses[pres[b]][f]
                if abs(A[0] - B[0]) > 20 or abs(A[1] - B[1]) > 6:
                    continue
                d = penetration(corners(A[0], A[1], A[2], *size[pres[a]]), corners(B[0], B[1], B[2], *size[pres[b]]))
                if d > 0.005:
                    ov.setdefault((pres[a], pres[b]), []).append((f, d, A[0]))
    for (a, b), L in ov.items():
        fr = [l[0] for l in L]
        R["overlaps"].append({"a": a, "b": b, "frames": [min(fr), max(fr)], "n": len(fr),
                              "max_depth": round(max(l[1] for l in L), 2),
                              "x_at_max": round(max(L, key=lambda l: l[1])[2], 1),
                              "crash_pair": inv[a] == "crash" and inv[b] == "crash"})
    R["overlaps"].sort(key=lambda r: -r["max_depth"] * r["n"])

    # ---- (3) pop-in / pop-out
    for o in objs:
        p = poses[o["id"]]
        fs = sorted(p)
        for kind, f in (("in", fs[0]), ("out", fs[-1])):
            if (kind == "in" and f == 0) or (kind == "out" and f == N - 1):
                continue
            x, y, h, _ = p[f]
            u, v = proj(x, y)
            # footprint extent in image (both ends of the body)
            L = size[o["id"]][0]
            us, vs = zip(*[proj(x + dx, y) for dx in (-L / 2, L / 2)])
            inside = 0 <= u < TW and 0 <= v < TH
            margin = min(min(us), TW - max(us), TH - max(vs)) if inside else -1
            xw = X_REF - x
            mid = inside and v > 30 and margin > 8
            m = meas.get(o["id"], {})
            src = m.get(f, {}).get("src")
            R["pops"].append({"id": o["id"], "kind": kind, "frame": f, "x": round(x, 1), "y": round(y, 1), "X_W": round(xw, 1),
                              "u": round(u), "v": round(v), "inside": inside, "margin_px": round(margin, 1), "mid_picture": mid,
                              "src": src, "cat": o["category"]})
    # fragmentation: a track that ends mid-picture and another that starts within 1.0 s / plausible distance
    ends = [r for r in R["pops"] if r["kind"] == "out" and r["mid_picture"]]
    starts = [r for r in R["pops"] if r["kind"] == "in" and r["mid_picture"]]
    for e in ends:
        pe = poses[e["id"]]
        ve = pe[e["frame"]][3]
        for s in starts:
            df = s["frame"] - e["frame"]
            if not (-3 <= df <= 15) or s["id"] == e["id"]:
                continue
            pred = e["x"] + ve * df * DT
            if abs(s["x"] - pred) < 8 + 0.5 * abs(df) and abs(s["y"] - e["y"]) < 3.0:
                R["fragments"].append({"ends": e["id"], "f_end": e["frame"], "starts": s["id"], "f_start": s["frame"],
                                       "dx_vs_pred": round(s["x"] - pred, 1), "dy": round(s["y"] - e["y"], 1),
                                       "x": e["x"]})

    # ---- (4) spec vs measured
    for o in objs:
        m = meas.get(o["id"])
        if not m:
            R["moved"].append({"id": o["id"], "note": "no measured track"})
            continue
        p = poses[o["id"]]
        rows = []
        for f, s in m.items():
            if f not in p:
                continue
            mx, my = X_REF - s["x"], s["y"] - Y_MED
            sx, sy = p[f][0], p[f][1]
            rows.append((f, sx - mx, sy - my, mx))
        nearrows = [r for r in rows if -150 <= r[3] <= 60]
        big = [r for r in nearrows if math.hypot(r[1], r[2]) > 0.5]
        missing = sorted(set(m) - set(p))
        extra = sorted(set(p) - set(m))
        if big or (missing and o["id"] in meas):
            if not big and not missing:
                continue
            worst = max(big, key=lambda r: math.hypot(r[1], r[2])) if big else None
            R["moved"].append({"id": o["id"], "n_near_gt05": len(big),
                               "frames": [big[0][0], big[-1][0]] if big else None,
                               "worst": {"f": worst[0], "dx": round(worst[1], 2), "dy": round(worst[2], 2), "x": round(worst[3], 1)} if worst else None,
                               "axis": ("x" if worst and abs(worst[1]) > abs(worst[2]) else "y") if worst else None,
                               "missing_measured_frames": [missing[0], missing[-1], len(missing)] if missing else None,
                               "extra_frames": [extra[0], extra[-1], len(extra)] if extra else None})
    # dropped tracks (measured but absent from spec)
    R["dropped"] = sorted(set(mtrack) - set(ids))
    out = os.path.join(HERE, "results.json")
    json.dump(R, open(out, "w"), indent=1, default=float)
    print("wrote", out)


if __name__ == "__main__":
    main()
