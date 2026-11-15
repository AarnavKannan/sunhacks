"""A6 story checks on an IncidentSpec (plan frame: x along road, y left of +x, crash carriageway drives +x
at y < 0, median at y = 0).  Prints PASS/FAIL lines and writes review/out/story.json.

  python review/story.py [--spec path] [--t-end 31.92]
"""
import argparse, json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from reproject import interp, corners_plan, INCIDENT  # noqa: E402

HZ = 25.0
# Video ground truth (lead / A4, crash camera @ 12.5 fps); overridden by data/crash_pair.json when present.
VIDEO = {"contact_f": (285, 290), "van_static_until_f": 291}
LANE_W = 3.75


def sep(p, q):
    """SAT: >0 separation gap (approx, max over axes), <0 penetration depth (min over axes)."""
    best = -1e9
    for poly in (p, q):
        for i in range(4):
            ax, ay = poly[(i + 1) % 4][0] - poly[i][0], poly[(i + 1) % 4][1] - poly[i][1]
            n = math.hypot(ax, ay); nx, ny = -ay / n, ax / n
            pa = [nx * x + ny * y for x, y in p]; qa = [nx * x + ny * y for x, y in q]
            gap = max(min(qa) - max(pa), min(pa) - max(qa))
            best = max(best, gap)
    return best


def lane_of(y):
    """+x carriageway lanes 1..3 at y<0, -x carriageway -1..-3 at y>0."""
    k = int(abs(y) // LANE_W) + 1
    return k if y < 0 else -k


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", default=os.path.join(INCIDENT, "incident-spec.json"))
    ap.add_argument("--t-end", type=float, default=31.92)
    a = ap.parse_args()
    spec = json.load(open(a.spec, encoding="utf-8"))
    cpj = os.path.join(os.path.dirname(HERE), "data", "crash_pair.json")
    if os.path.exists(cpj):
        try:
            cp = json.load(open(cpj, encoding="utf-8"))
            for k in ("contact_f", "contact_frame", "contact_frames"):
                if k in cp:
                    v = cp[k]; VIDEO["contact_f"] = tuple(v) if isinstance(v, list) else (v, v)
            for k in ("van_static_until_f", "van_move_f", "van_first_move_f"):
                if k in cp:
                    VIDEO["van_static_until_f"] = cp[k]
        except Exception as e:  # noqa: BLE001
            print("crash_pair.json unreadable:", e)
    print("video truth:", VIDEO)
    objs = {o["id"]: o for o in spec["objects"]}
    crash = spec.get("crash", {})
    T_IMP = (crash.get("contacts") or [{}])[0].get("t_s", crash.get("start_s"))
    van, yel = objs.get("white-van"), objs.get("yellow-car")
    n = int(a.t_end * HZ) + 1
    ts = [i / HZ for i in range(n)]
    P = {oid: [interp(o, t) for t in ts] for oid, o in objs.items()}
    res = []

    def rep(name, ok, detail):
        res.append({"check": name, "pass": bool(ok), "detail": detail})
        print(("PASS " if ok else "FAIL ") + name + ": " + detail)

    # 1. van still before impact
    vp = [(t, p) for t, p in zip(ts, P["white-van"]) if p and t < min(T_IMP, VIDEO["van_static_until_f"] / 12.5) - 0.05]
    d = max(math.hypot(p[0] - vp[0][1][0], p[1] - vp[0][1][1]) for _, p in vp)
    rep("van still until impact", d < 0.2, f"max drift {d:.2f} m before t={T_IMP}s; first pose x={vp[0][1][0]:.2f} y={vp[0][1][1]:.2f}")
    vx, vy = vp[0][1][0], vp[0][1][1]

    # 2. no queue behind the van before impact
    q = []
    for oid, ps in P.items():
        if oid in ("white-van", "yellow-car"):
            continue
        for t, p in zip(ts, ps):
            if p and t < T_IMP and abs(p[1] - vy) < 1.3 and vx - 80 < p[0] < vx - 2 and p[3] < 5:
                q.append((oid, round(t, 2), round(p[0], 1), round(p[3], 1))); break
    rep("no queue behind van pre-impact", not q, f"{len(q)} slow vehicles in van lane behind it: {q[:6]}")

    # 3. yellow car swerve / contact / spin
    yp = [(t, p) for t, p in zip(ts, P["yellow-car"]) if p]
    pre = [(t, p) for t, p in yp if t < T_IMP - 3]
    y_lane = sum(p[1] for _, p in pre[-25:]) / max(1, len(pre[-25:])) if pre else yp[0][1][1]
    sw = next((t for t, p in yp if abs(p[1] - y_lane) > 0.4), None)
    cont = None
    for t, pv, py in zip(ts, P["white-van"], P["yellow-car"]):
        if pv and py:
            s = sep(corners_plan(pv[0], pv[1], pv[2], van["length_m"], van["width_m"]),
                    corners_plan(py[0], py[1], py[2], yel["length_m"], yel["width_m"]))
            if s <= 0.05:
                cont = (t, s); break
    h_imp = next((p[2] for t, p in yp if t >= T_IMP), None)
    h_end = yp[-1][1][2]
    spin = max(abs(((p[2] - h_imp + 180) % 360) - 180) for t, p in yp if t >= T_IMP) if h_imp is not None else 0
    rep("yellow swerve", sw is not None and sw < T_IMP, f"lane y={y_lane:.2f}, leaves lane (|dy|>0.4) at t={sw}")
    cf0, cf1 = VIDEO["contact_f"]
    cf = cont[0] * 12.5 if cont else None
    rep("contact frame (spec vs video)", cf is not None and cf0 - 1 <= cf <= cf1 + 1,
        f"first geometric contact t={cont[0] if cont else None} = frame {cf:.1f}; spec contact t={T_IMP} = frame {T_IMP * 12.5:.1f}; video contact f{cf0}-{cf1}" if cf else "no contact")
    vm = next((t for t, p in zip(ts, P["white-van"]) if p and math.hypot(p[0] - vx, p[1] - vy) > 0.1), None)
    rep("van starts moving at video frame", vm is not None and abs(vm * 12.5 - VIDEO["van_static_until_f"]) <= 3,
        f"spec van first moves at t={vm} = frame {vm * 12.5 if vm else None}; video f{VIDEO['van_static_until_f']}")
    rep("yellow spins after impact", spin > 15, f"max yaw change after impact {spin:.0f} deg, final heading {h_end:.0f}")
    vpost = [p for t, p in zip(ts, P["white-van"]) if p and t > T_IMP]
    sh = math.hypot(vpost[-1][0] - vx, vpost[-1][1] - vy) if vpost else 0
    rep("van shoved", sh > 0.5, f"van displaced {sh:.2f} m (to x={vpost[-1][0]:.2f}, y={vpost[-1][1]:.2f}, h={vpost[-1][2]:.1f})")

    # 4. lane 2 behind the crash brakes after impact
    br = []
    for oid, ps in P.items():
        if oid in ("white-van", "yellow-car"):
            continue
        sp_b = [p[3] for t, p in zip(ts, ps) if p and T_IMP - 3 < t < T_IMP and lane_of(p[1]) == 2 and p[0] < vx]
        sp_a = [p[3] for t, p in zip(ts, ps) if p and T_IMP < t < T_IMP + 8 and lane_of(p[1]) in (1, 2) and p[0] < vx + 10]
        if sp_b and sp_a:
            br.append((oid, round(sum(sp_b) / len(sp_b), 1), round(min(sp_a), 1)))
    nbr = sum(1 for _, b, a2 in br if a2 < 0.6 * b)
    rep("lane-2 traffic brakes after impact", nbr >= 1, f"{nbr}/{len(br)} lane-2 vehicles upstream drop below 60% speed: {br[:6]}")

    # 5. far carriageway unaffected
    far = []
    for oid, ps in P.items():
        sp = [(t, p[3]) for t, p in zip(ts, ps) if p and p[1] > 0]
        if len(sp) > 10:
            b = [s for t, s in sp if t < T_IMP]; af = [s for t, s in sp if t >= T_IMP]
            if b and af and min(af) < 0.75 * (sum(b) / len(b)):
                far.append((oid, round(sum(b) / len(b), 1), round(min(af), 1)))
    rep("far carriageway unaffected", not far, f"{len(far)} far-side vehicles slow >25% after impact: {far[:6]}")

    # 6. overlaps
    ov = {}
    ids = list(objs)
    for i, t in enumerate(ts):
        polys = []
        for oid in ids:
            p = P[oid][i]
            if p:
                polys.append((oid, corners_plan(p[0], p[1], p[2], objs[oid]["length_m"], objs[oid]["width_m"]), p))
        for x in range(len(polys)):
            for y in range(x + 1, len(polys)):
                A, B = polys[x], polys[y]
                if abs(A[2][0] - B[2][0]) > 15 or abs(A[2][1] - B[2][1]) > 4:
                    continue
                s = sep(A[1], B[1])
                if s < -0.02:
                    pair = tuple(sorted((A[0], B[0])))
                    if pair == ("white-van", "yellow-car") and abs(t - T_IMP) < 0.6:
                        continue
                    ov.setdefault(pair, []).append((round(t, 2), round(s, 2)))
    worst = sorted(((min(v, key=lambda z: z[1]), k, len(v)) for k, v in ov.items()), key=lambda z: z[0][1])
    rep("no overlaps", not ov, f"{len(ov)} overlapping pairs; worst: " + "; ".join(f"{k} t={w[0]} depth={-w[1]}m n={c}" for w, k, c in worst[:6]))

    # 7. appear/disappear in mid-road (inside the tile, not at an edge)
    try:
        from reproject import load_mapping, box_img
        import types
        m = load_mapping(types.SimpleNamespace(x0=None, ymed=None, sx=None, spec=a.spec))
        pops = []
        for oid, o in objs.items():
            k = o["keyframes"]
            for t, which in ((k[0]["t_s"], "appears"), (k[-1]["t_s"], "vanishes")):
                if t <= 0.01 or t >= a.t_end:
                    continue
                pts = box_img(m, o, interp(o, t))
                if pts is None:
                    continue
                u0, v0 = pts.min(0); u1, v1 = pts.max(0)
                if u0 > 5 and u1 < 474 and v1 < 295 and v0 > 25 and (v1 - v0) >= 20:
                    pops.append((oid, which, round(t, 2), int((u0 + u1) / 2), int((v0 + v1) / 2), int(v1 - v0)))
        rep("no pop-in/out inside the tile", not pops, f"{len(pops)} (id, event, t, u, v, box_h px): {pops[:8]}")
    except Exception as e:  # noqa: BLE001
        rep("no pop-in/out inside the tile", False, f"could not evaluate: {e}")

    os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
    json.dump({"spec_version": spec.get("prompt_version"), "t_impact": T_IMP, "checks": res,
               "overlaps": {"|".join(k): v[:20] for k, v in ov.items()}},
              open(os.path.join(HERE, "out", "story.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
