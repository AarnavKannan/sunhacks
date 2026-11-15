#!/usr/bin/env python3
"""Hand-authored IncidentSpec for demo.mp4 (TUM Traffic A9 gantry mosaic, r05_s03).

Writes incident-spec.json next to this file. Stdlib only. Run:  python build-spec.py

Plan frame (spec.ts): x along the road, y to the LEFT of +x, heading 0 = +x, 90 = +y.
The crash carriageway drives +x on lanes y = -2.925 (lane 1, median side), -6.675, -10.425.
The median barrier is at y = 0. The engine linearly interpolates keyframes at 30 Hz and hides a
vehicle before its first / after its last keyframe, so the keyframes below are exactly what renders.

Crash vehicles (white van, yellow car) are built here. Background traffic comes from traffic.py
(background_objects), owned separately; this script merges it, then checks the combined scene.
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

# ---- Shared constants (traffic.py hardcodes the same values) --------------------------------
VAN_ID = "white-van"
YELLOW_ID = "yellow-car"
VAN_X = 15.0
VAN_Y = -2.925
VAN_LENGTH = 5.4
VAN_WIDTH = 2.05
IMPACT_T = 22.3
CRASH_END_T = 24.0
# --------------------------------------------------------------------------------------------

DURATION = 59.92
SEED = 7
LANE2_Y = -6.675
BARRIER_FACE_Y = -0.15  # nothing on the +x carriageway may reach past this (barrier base ~0.3 m wide)
PAVED_HALF = 14.8

VAN_MASS = 2500.0
YEL_LENGTH, YEL_WIDTH, YEL_MASS = 4.2, 1.78, 1300.0

SWERVE_T = 20.6          # yellow starts drifting out of lane 2 (clearly leaving it by ~21.0 s)
YEL_V_CRUISE = 13.0      # m/s in lane 2
YEL_VX_CONTACT = 12.4    # slight lift-off during the swerve
YEL_HEAD_CONTACT = 18.0  # deg, crossing angle at contact
WIGGLE_A, WIGGLE_P = 0.12, 0.95  # m, s: unsteady steering superimposed on the swerve
IMPULSE_S = 0.10         # duration of the main crash pulse
J_VAN = (12000.0, 500.0)  # N*s impulse yellow -> van (plan frame)
OMEGA_YEL = -0.90        # rad/s yaw right after impact (front-right corner hit -> clockwise)
OMEGA_VAN = -0.17
YEL_REST_T = 23.5
VAN_REST_T = CRASH_END_T

DT = 1.0 / 600.0


def r3(v):
    return round(v + 0.0, 3)


def wrap(deg):
    return (deg + 180.0) % 360.0 - 180.0


def corners(x, y, hdeg, L, W):
    h = math.radians(hdeg)
    c, s = math.cos(h), math.sin(h)
    out = []
    for a, b in ((L / 2, W / 2), (L / 2, -W / 2), (-L / 2, -W / 2), (-L / 2, W / 2)):
        out.append((x + a * c - b * s, y + a * s + b * c))
    return out


# ---------------------------------------------------------------------------------------------
# Yellow car, approach and swerve (analytic, so it is smooth)

h_c = math.radians(YEL_HEAD_CONTACT)
VY_CONTACT = YEL_VX_CONTACT * math.tan(h_c)
# Contact: the yellow car's front-right corner touches the van's rear face 0.2 m in from its
# median-side (left) corner.
VAN_REAR_X = VAN_X - VAN_LENGTH / 2
CONTACT_PT = (VAN_REAR_X, VAN_Y + VAN_WIDTH / 2 - 0.2)
_dir = (math.cos(h_c), math.sin(h_c))
_left = (-math.sin(h_c), math.cos(h_c))
YEL_CX = CONTACT_PT[0] - YEL_LENGTH / 2 * _dir[0] + YEL_WIDTH / 2 * _left[0]
YEL_CY = CONTACT_PT[1] - YEL_LENGTH / 2 * _dir[1] + YEL_WIDTH / 2 * _left[1]
SW = IMPACT_T - SWERVE_T
X_SWERVE = YEL_CX - SW * (YEL_V_CRUISE + YEL_VX_CONTACT) / 2


def yellow_pre(t):
    """Position (x, y) of the yellow car for t <= IMPACT_T."""
    if t <= SWERVE_T:
        return X_SWERVE - YEL_V_CRUISE * (SWERVE_T - t), LANE2_Y
    tau = t - SWERVE_T
    acc = (YEL_VX_CONTACT - YEL_V_CRUISE) / SW
    x = X_SWERVE + YEL_V_CRUISE * tau + 0.5 * acc * tau * tau
    s = tau / SW
    h00 = 2 * s ** 3 - 3 * s ** 2 + 1
    h01 = -2 * s ** 3 + 3 * s ** 2
    h11 = s ** 3 - s ** 2
    y = h00 * LANE2_Y + h01 * YEL_CY + h11 * SW * VY_CONTACT
    y += WIGGLE_A * math.sin(2 * math.pi * tau / WIGGLE_P) * math.sin(math.pi * s) ** 2
    return x, y


def yellow_pre_heading(t):
    e = 1e-4
    x0, y0 = yellow_pre(t - e)
    x1, y1 = yellow_pre(min(t + e, IMPACT_T))
    if t + e > IMPACT_T:
        x1, y1 = yellow_pre(IMPACT_T)
        x0, y0 = yellow_pre(IMPACT_T - 2 * e)
    return math.degrees(math.atan2(y1 - y0, x1 - x0))


# ---------------------------------------------------------------------------------------------
# Crash and slide to rest (integrated at 600 Hz)

BARRIER_J = [0.0]  # N*s, -y impulse from the median barrier on the yellow car during the crash pulse
YEL_VY_POST = 0.25  # m/s lateral velocity left after the pulse
BARRIER_HIT = [None]  # time the yellow car first reaches the median barrier (secondary impact)


def simulate_crash():
    """Returns dense samples {t: (x, y, h_deg)} for yellow and van from IMPACT_T to rest."""
    yx, yy = yellow_pre(IMPACT_T)
    yh = yellow_pre_heading(IMPACT_T)
    e = 1e-4
    xa, ya = yellow_pre(IMPACT_T - e)
    yv_pre = ((yx - xa) / e, (yy - ya) / e)
    # The yellow car's front-left corner meets the median barrier in the same pulse (it is
    # already within ~0.3 m of it at contact); the barrier takes the rest of its lateral momentum.
    vy_after_van = yv_pre[1] - J_VAN[1] / YEL_MASS
    BARRIER_J[0] = (vy_after_van - YEL_VY_POST) * YEL_MASS
    yv_post = (yv_pre[0] - J_VAN[0] / YEL_MASS, YEL_VY_POST)
    vv_post = (J_VAN[0] / VAN_MASS, J_VAN[1] / VAN_MASS)
    vx_, vy_, vh = VAN_X, VAN_Y, 0.0
    t1 = IMPACT_T + IMPULSE_S
    ys, vs = [], []
    n = int(round((max(YEL_REST_T, VAN_REST_T) + 0.2 - IMPACT_T) / DT))
    for i in range(n + 1):
        t = IMPACT_T + i * DT
        ys.append((t, yx, yy, yh))
        vs.append((t, vx_, vy_, vh))
        tm = t + DT / 2  # midpoint rule

        def vel(v_pre, v_post, w_pre, w_post, t_rest):
            if tm < t1:
                s = (tm - IMPACT_T) / IMPULSE_S
                return (v_pre[0] + (v_post[0] - v_pre[0]) * s, v_pre[1] + (v_post[1] - v_pre[1]) * s, w_pre + (w_post - w_pre) * s)
            if tm >= t_rest:
                return 0.0, 0.0, 0.0
            u = 1 - (tm - t1) / (t_rest - t1)
            return v_post[0] * u, v_post[1] * u, w_post * u

        a, b, w = vel(yv_pre, yv_post, 0.0, OMEGA_YEL, YEL_REST_T)
        yx += a * DT
        yy += b * DT
        yh += math.degrees(w) * DT
        # Median barrier: the yellow car is pressed against it and slides along it.
        top = max(c[1] for c in corners(yx, yy, yh, YEL_LENGTH, YEL_WIDTH))
        if top > BARRIER_FACE_Y:
            yy -= top - BARRIER_FACE_Y
            if BARRIER_HIT[0] is None:
                BARRIER_HIT[0] = t
        a, b, w = vel((0.0, 0.0), vv_post, 0.0, OMEGA_VAN, VAN_REST_T)
        vx_ += a * DT
        vy_ += b * DT
        vh += math.degrees(w) * DT
    return ys, vs, yv_pre, yv_post, vv_post


def dense_lookup(samples, t):
    i = min(len(samples) - 1, max(0, int(round((t - samples[0][0]) / DT))))
    return samples[i]


def kf(t, x, y, h, speed):
    return {"t_s": r3(t), "x_m": r3(x), "y_m": r3(y), "heading_deg": r3(wrap(h)), "speed_mps": r3(max(0.0, speed))}


def build_crash_objects():
    ys, vs, yv_pre, yv_post, vv_post = simulate_crash()

    def post_pose(samples, t):
        s = dense_lookup(samples, t)
        return s[1], s[2], s[3]

    def post_speed(samples, t):
        a = dense_lookup(samples, t - 0.01)
        b = dense_lookup(samples, t + 0.01)
        dt = b[0] - a[0]
        return math.hypot(b[1] - a[1], b[2] - a[2]) / dt if dt > 0 else 0.0

    # ---- yellow keyframes
    t_enter = SWERVE_T - (X_SWERVE + 140.0) / YEL_V_CRUISE
    yk = []
    t = t_enter
    while t < SWERVE_T - 0.4:
        x, y = yellow_pre(t)
        yk.append(kf(t, x, y, 0.0, YEL_V_CRUISE))
        t += 1.0
    t = SWERVE_T - 0.4
    while t < IMPACT_T - 1e-9:
        x, y = yellow_pre(t)
        x2, y2 = yellow_pre(min(IMPACT_T, t + 0.005))
        x1, y1 = yellow_pre(t - 0.005)
        sp = math.hypot(x2 - x1, y2 - y1) / (min(IMPACT_T, t + 0.005) - t + 0.005)
        yk.append(kf(t, x, y, yellow_pre_heading(t), sp))
        t = round(t + 0.05, 6)
    t = IMPACT_T
    while t <= YEL_REST_T + 0.15:
        x, y, h = post_pose(ys, t)
        yk.append(kf(t, x, y, h, post_speed(ys, t) if t > IMPACT_T else math.hypot(*yv_pre)))
        t = round(t + 0.05, 6)
    yrest = post_pose(ys, YEL_REST_T + 0.2)
    yk.append(kf(DURATION, yrest[0], yrest[1], yrest[2], 0.0))

    # ---- van keyframes (stopped from the start)
    vk = [kf(0.0, VAN_X, VAN_Y, 0.0, 0.0)]
    for tt in (5.0, 10.0, 15.0, 20.0, 22.0):
        vk.append(kf(tt, VAN_X, VAN_Y, 0.0, 0.0))
    t = IMPACT_T
    while t <= VAN_REST_T + 0.15:
        x, y, h = post_pose(vs, t)
        vk.append(kf(t, x, y, h, post_speed(vs, t) if t > IMPACT_T else 0.0))
        t = round(t + 0.05, 6)
    vrest = post_pose(vs, VAN_REST_T + 0.2)
    vk.append(kf(DURATION, vrest[0], vrest[1], vrest[2], 0.0))

    # ---- forces, F = m * a from the trajectory itself (so they agree with the motion)
    def accel_pre(t):
        e = 0.02
        p0, p1, p2 = yellow_pre(t - e), yellow_pre(t), yellow_pre(min(IMPACT_T, t + e))
        return ((p2[0] - 2 * p1[0] + p0[0]) / e / e, (p2[1] - 2 * p1[1] + p0[1]) / e / e)

    def accel_post(samples, t, w=0.05):
        a, b, c = dense_lookup(samples, t - w), dense_lookup(samples, t), dense_lookup(samples, t + w)
        return ((c[1] - 2 * b[1] + a[1]) / w / w, (c[2] - 2 * b[2] + a[2]) / w / w)

    def force(t, a, m, cause, note):
        return {"t_s": r3(t), "fx_n": round(a[0] * m), "fy_n": round(a[1] * m), "cause": cause, "note": note}

    jy = (-J_VAN[0] / IMPULSE_S, -J_VAN[1] / IMPULSE_S)
    jv = (J_VAN[0] / IMPULSE_S, J_VAN[1] / IMPULSE_S)
    yf = [force(20.8, (0.0, 0.0), YEL_MASS, "coasting", "steady in lane 2 at ~13 m/s")]
    t = SWERVE_T + 0.1
    while t < IMPACT_T - 0.05:
        yf.append(force(t, accel_pre(t), YEL_MASS, "steering", "unsteady swerve from lane 2 toward lane 1 behind the stopped van"))
        t = round(t + 0.1, 6)
    yf.append({"t_s": r3(IMPACT_T), "fx_n": round(jy[0]), "fy_n": round(jy[1]), "cause": "impact",
               "note": f"front-right corner strikes van's rear median-side corner; impulse {J_VAN[0]:.0f} N*s over {IMPULSE_S:.2f} s"})
    yf.append({"t_s": r3(IMPACT_T + IMPULSE_S / 2), "fx_n": round(jy[0]), "fy_n": round(jy[1] - BARRIER_J[0] / IMPULSE_S), "cause": "impact",
               "note": f"crash pulse continues; front-left corner glances off the median barrier ({BARRIER_J[0]:.0f} N*s toward -y)"})
    t = IMPACT_T + 0.2
    while t <= YEL_REST_T + 1e-9:
        a = accel_post(ys, t)
        tb = BARRIER_HIT[0]
        if True:
            yf.append(force(t, a, YEL_MASS, "sliding", "spinning clockwise, tyres sliding; pressed against the median barrier"))
        t = round(t + 0.15, 6)
    vf = [{"t_s": r3(IMPACT_T), "fx_n": round(jv[0]), "fy_n": round(jv[1]), "cause": "impact", "note": "struck at rear median-side corner by the yellow car"},
          {"t_s": r3(IMPACT_T + IMPULSE_S / 2), "fx_n": round(jv[0]), "fy_n": round(jv[1]), "cause": "impact", "note": "crash pulse (cont.)"}]
    t = IMPACT_T + 0.2
    while t <= VAN_REST_T + 1e-9:
        vf.append(force(t, accel_post(vs, t), VAN_MASS, "sliding", "shoved forward with a slight clockwise yaw, braked wheels sliding to rest"))
        t = round(t + 0.2, 6)

    yellow = {
        "id": YELLOW_ID, "label": "Yellow car", "category": "hatchback", "color_name": "yellow", "color_hex": "#E8C21E",
        "make": None, "model": None, "involvement": "crash",
        "length_m": YEL_LENGTH, "width_m": YEL_WIDTH, "mass_kg": YEL_MASS,
        "visible_from_s": yk[0]["t_s"], "visible_to_s": yk[-1]["t_s"],
        "keyframes": yk, "forces": yf,
        "rest": {"x_m": r3(yrest[0]), "y_m": r3(yrest[1]), "heading_deg": r3(wrap(yrest[2]))},
        "confidence": 0.85,
    }
    van = {
        "id": VAN_ID, "label": "White van (stopped in lane 1)", "category": "van", "color_name": "white", "color_hex": "#F2F2F0",
        "make": None, "model": None, "involvement": "crash",
        "length_m": VAN_LENGTH, "width_m": VAN_WIDTH, "mass_kg": VAN_MASS,
        "visible_from_s": vk[0]["t_s"], "visible_to_s": vk[-1]["t_s"],
        "keyframes": vk, "forces": vf,
        "rest": {"x_m": r3(vrest[0]), "y_m": r3(vrest[1]), "heading_deg": r3(wrap(vrest[2]))},
        "confidence": 0.9,
    }
    info = {"yv_pre": yv_pre, "yv_post": yv_post, "vv_post": vv_post}
    return yellow, van, info


# ---------------------------------------------------------------------------------------------
# Checker: rebuild every track exactly the way planMotion does (linear, 30 Hz, hidden outside
# the first/last keyframe) and test overlaps, gaps, accelerations and road bounds.

HZ = 30


def track(obj, n):
    k = obj["keyframes"]
    xs, ys, hs = [0.0] * n, [0.0] * n, [0.0] * n
    vis = [False] * n
    seg = 0
    for i in range(n):
        t = i / HZ
        while seg < len(k) - 2 and t > k[seg + 1]["t_s"]:
            seg += 1
        a = k[seg]
        b = k[min(seg + 1, len(k) - 1)]
        u = 0.0 if a is b else max(0.0, min(1.0, (t - a["t_s"]) / (b["t_s"] - a["t_s"])))
        xs[i] = a["x_m"] + (b["x_m"] - a["x_m"]) * u
        ys[i] = a["y_m"] + (b["y_m"] - a["y_m"]) * u
        hs[i] = a["heading_deg"] + wrap(b["heading_deg"] - a["heading_deg"]) * u
        vis[i] = k[0]["t_s"] - 1e-6 <= t <= k[-1]["t_s"] + 1e-6
    return xs, ys, hs, vis


def poly_sep(p, q):
    """Separation distance of two convex polygons (0 if they intersect)."""
    def axes(poly):
        for i in range(len(poly)):
            x1, y1 = poly[i]
            x2, y2 = poly[(i + 1) % len(poly)]
            ex, ey = x2 - x1, y2 - y1
            ln = math.hypot(ex, ey)
            yield (-ey / ln, ex / ln)
    best = -1e9
    for ax in list(axes(p)) + list(axes(q)):
        pa = [ax[0] * x + ax[1] * y for x, y in p]
        qa = [ax[0] * x + ax[1] * y for x, y in q]
        best = max(best, min(qa) - max(pa), min(pa) - max(qa))
    if best <= 0:
        return best  # negative: penetration depth along the best axis
    # SAT gives a lower bound; refine with point-segment distances for the true gap.
    def pt_seg(px, py, a, b):
        ax_, ay_ = a
        bx, by = b
        dx, dy = bx - ax_, by - ay_
        u = max(0.0, min(1.0, ((px - ax_) * dx + (py - ay_) * dy) / (dx * dx + dy * dy)))
        return math.hypot(px - ax_ - u * dx, py - ay_ - u * dy)
    d = 1e9
    for poly, other in ((p, q), (q, p)):
        for px, py in poly:
            for i in range(len(other)):
                d = min(d, pt_seg(px, py, other[i], other[(i + 1) % len(other)]))
    return d


def check(objects, verbose=True):
    n = int(math.floor(DURATION * HZ + 1e-6)) + 1
    tr = {o["id"]: track(o, n) for o in objects}
    by_id = {o["id"]: o for o in objects}
    crash = {VAN_ID, YELLOW_ID}
    ids = list(by_id)
    res = {"pairs_overlap": [], "min_gap_traffic": (1e9, None), "min_gap_to_crash": (1e9, None), "crash_contact_gap": None,
           "max_accel": (0.0, None), "max_speed": (0.0, None), "road_bounds": [], "crash_conflicts": set(), "lane1_block": []}
    diag = {i: math.hypot(by_id[i]["length_m"], by_id[i]["width_m"]) / 2 for i in ids}

    for f in range(n):
        t = f / HZ
        vis = [i for i in ids if tr[i][3][f]]
        polys = {}
        for i in vis:
            xs, ys, hs, _ = tr[i]
            polys[i] = corners(xs[f], ys[f], hs[f], by_id[i]["length_m"], by_id[i]["width_m"])
        # road bounds: own carriageway, inside the barrier
        for i in vis:
            fwd = math.cos(math.radians(tr[i][2][f])) >= 0 if i not in crash else True
            yv = [c[1] for c in polys[i]]
            bad = (max(yv) > -0.10 or min(yv) < -PAVED_HALF) if fwd else (min(yv) < 0.10 or max(yv) > PAVED_HALF)
            if bad and len(res["road_bounds"]) < 20:
                res["road_bounds"].append((i, round(t, 2), round(min(yv), 2), round(max(yv), 2)))
        # lane-1 block after impact: only the crash pair inside x 6..28 of lane 1
        if t >= IMPACT_T + 0.5:
            for i in vis:
                if i in crash:
                    continue
                xs, ys = tr[i][0], tr[i][1]
                if 6 - by_id[i]["length_m"] / 2 < xs[f] < 28 + by_id[i]["length_m"] / 2 and -4.8 < ys[f] < -1.05:
                    res["lane1_block"].append((i, round(t, 2)))
        # pairs
        vis.sort(key=lambda i: tr[i][0][f])
        for a_idx in range(len(vis)):
            i = vis[a_idx]
            xi = tr[i][0][f]
            for b_idx in range(a_idx + 1, len(vis)):
                j = vis[b_idx]
                if tr[j][0][f] - xi > diag[i] + diag[j] + 3.0:
                    break
                if math.hypot(tr[j][1][f] - tr[i][1][f], tr[j][0][f] - xi) > diag[i] + diag[j] + 3.0:
                    continue
                sep = poly_sep(polys[i], polys[j])
                pair = tuple(sorted((i, j)))
                if pair == tuple(sorted(crash)):
                    if abs(t - IMPACT_T) < 0.5 / HZ:
                        res["crash_contact_gap"] = sep
                    if t < IMPACT_T - 0.5 / HZ and sep < 0:
                        res["pairs_overlap"].append((pair, round(t, 2), round(sep, 3)))
                    if t > IMPACT_T + 0.6 and sep < 0:
                        res["pairs_overlap"].append((pair, round(t, 2), round(sep, 3)))
                    continue
                if i in crash or j in crash:
                    if sep < res["min_gap_to_crash"][0]:
                        res["min_gap_to_crash"] = (sep, (pair, round(t, 2)))
                    if sep < 1.0:
                        res["crash_conflicts"].add(j if i in crash else i)
                    continue
                if sep < res["min_gap_traffic"][0]:
                    res["min_gap_traffic"] = (sep, (pair, round(t, 2)))
                if sep < 0:
                    res["pairs_overlap"].append((pair, round(t, 2), round(sep, 3)))
                # in-lane bumper gap >= 1 m: laterally overlapping, same direction
                hi, hj = tr[i][2][f], tr[j][2][f]
                same_dir = math.cos(math.radians(hi - hj)) > 0.9
                lat = abs(tr[i][1][f] - tr[j][1][f]) < (by_id[i]["width_m"] + by_id[j]["width_m"]) / 2
                if same_dir and lat and sep < 1.0:
                    res["pairs_overlap"].append((pair, round(t, 2), round(sep, 3), "bumper<1m"))

    # accelerations from the keyframe segments (what linear interpolation actually implies)
    for o in objects:
        k = o["keyframes"]
        vel = []
        for a, b in zip(k, k[1:]):
            dt = b["t_s"] - a["t_s"]
            v = ((b["x_m"] - a["x_m"]) / dt, (b["y_m"] - a["y_m"]) / dt)
            vel.append((a["t_s"], b["t_s"], v))
            sp = math.hypot(*v)
            if sp > res["max_speed"][0]:
                res["max_speed"] = (sp, (o["id"], a["t_s"]))
        for (t0, t1, v0), (t2, t3, v1) in zip(vel, vel[1:]):
            mid = (t1 - t0) / 2 + (t3 - t2) / 2
            acc = math.hypot(v1[0] - v0[0], v1[1] - v0[1]) / mid
            if o["id"] in crash and IMPACT_T - 0.06 <= t1 <= IMPACT_T + IMPULSE_S + 0.06:
                res.setdefault("impact_accel", []).append((o["id"], t1, round(acc, 1)))
                continue
            tb = BARRIER_HIT[0]
            if o["id"] == YELLOW_ID and tb is not None and tb - 0.06 <= t1 <= tb + 0.2:
                res.setdefault("impact_accel", []).append((o["id"], t1, round(acc, 1), "barrier"))
                continue
            if acc > res["max_accel"][0]:
                res["max_accel"] = (acc, (o["id"], t1))
    if verbose:
        pass
    return res


def main():
    yellow, van, info = build_crash_objects()
    background = []
    source = "none"
    try:
        import traffic  # owned by the traffic agent
        background = traffic.background_objects(seed=SEED)
        source = "traffic.py"
    except ImportError:
        print("traffic.py not found: building crash vehicles only")

    objects = [van, yellow] + background
    ids = [o["id"] for o in objects]
    dup = {i for i in ids if ids.count(i) > 1}
    assert not dup, f"duplicate ids: {dup}"

    dropped = []
    for _ in range(5):
        res = check(objects)
        conflicts = sorted(res["crash_conflicts"])
        if not conflicts:
            break
        for cid in conflicts:
            dropped.append(cid)
        objects = [o for o in objects if o["id"] not in conflicts]

    spec = {
        "prompt_version": "hand-verified-a9-v1",
        "title": "A9 motorway: car strikes stopped van",
        "location_guess": "A9 motorway near Munich, Germany (TUM Traffic gantry cameras)",
        "summary": ("A white panel van stands stopped in lane 1 (next to the median) of a busy three-lane carriageway. "
                    "Traffic steers around it. At about 22.3 s a yellow car leaves lane 2 with an unsteady swerve, clips the van's "
                    "rear median-side corner with its front, spins clockwise and stops pressed against the median barrier behind the van, "
                    "which is shoved about 4 m forward. Lane-2 traffic behind the crash brakes hard and queues; lane 3 slows."),
        "duration_s": DURATION,
        "views": [
            {"video_index": 1, "description": "Mosaic tile bottom-right: gantry camera looking along the +x carriageway (left half of picture), crash site in lane 1 by the median",
             "camera_kind": "fixed gantry traffic camera", "moving": False, "time_offset_s": 0, "plus_x_traffic": "toward_camera"},
            {"video_index": 1, "description": "Mosaic tile bottom-left: neighbouring gantry camera on the same A9 section",
             "camera_kind": "fixed gantry traffic camera", "moving": False, "time_offset_s": 0, "plus_x_traffic": "not_visible"},
            {"video_index": 1, "description": "Mosaic tile top-left: neighbouring gantry camera on the same A9 section",
             "camera_kind": "fixed gantry traffic camera", "moving": False, "time_offset_s": 0, "plus_x_traffic": "not_visible"},
            {"video_index": 1, "description": "Mosaic tile top-right: neighbouring gantry camera on the same A9 section, dense traffic toward a sign gantry",
             "camera_kind": "fixed gantry traffic camera", "moving": False, "time_offset_s": 0, "plus_x_traffic": "not_visible"},
        ],
        "environment_preset": "snowy",
        "road": {"kind": "divided_highway", "region": "DE", "road_class": "motorway", "lanes_each_way": 3,
                 "cross_lanes_each_way": 1, "surface": "dry", "grade_percent": 0, "speed_limit_mps": None},
        "wind": {"toward_deg": 0, "speed_mps": 0},
        "crash": {
            "start_s": IMPACT_T, "end_s": CRASH_END_T, "kind": "rear-end sideswipe into stationary van",
            "description": ("Yellow car swerves from lane 2 toward the gap between the stopped white van and the median, "
                            "its front-right corner strikes the van's rear median-side corner, it spins clockwise against the barrier "
                            "and stops behind the van; the van is pushed ~4 m forward and yaws ~8 deg. Debris across lane 1."),
            "participants": [YELLOW_ID, VAN_ID],
            "contacts": [{"a": YELLOW_ID, "b": VAN_ID, "t_s": IMPACT_T, "x_m": r3(CONTACT_PT[0]), "y_m": r3(CONTACT_PT[1]), "normal_deg": 0.0}],
        },
        "objects": objects,
        "caveats": [
            "Hand-authored from frame-by-frame review of the 12.5 fps mosaic; not measured with a calibrated camera.",
            "Positions and speeds are approximate (perspective estimates, +/- a few metres and ~2 m/s).",
            "Contact at ~22.3 s is partly occluded by the van; the impulse and forces are derived from the reconstructed motion, not measured.",
            "The yellow car's spin is limited to ~30 deg here so it fits between the van and the median barrier.",
            "Background traffic is a plausible simulation matching the observed density, lanes and behaviour, not a vehicle-by-vehicle track; trucks are shortened to the viewer's maximum.",
            "The van's driver appears on foot near the van late in the clip; pedestrians are not reconstructed.",
        ],
    }
    out = os.path.join(HERE, "incident-spec.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(spec, fh, indent=1)

    # ---- report
    res = check(objects)
    yk, vk = yellow["keyframes"], van["keyframes"]
    print(f"wrote {out} ({os.path.getsize(out) / 1024:.0f} KB)")
    print(f"background source: {source}; objects: {len(objects)} (background {len(objects) - 2}); dropped for crash conflicts: {dropped}")
    print(f"yellow: visible {yk[0]['t_s']}..{yk[-1]['t_s']}, contact centre ({YEL_CX:.2f},{YEL_CY:.2f}) h={YEL_HEAD_CONTACT}, "
          f"v_pre=({info['yv_pre'][0]:.2f},{info['yv_pre'][1]:.2f}) v_post=({info['yv_post'][0]:.2f},{info['yv_post'][1]:.2f}), rest={yellow['rest']}")
    print(f"van: v_post=({info['vv_post'][0]:.2f},{info['vv_post'][1]:.2f}), rest={van['rest']} (shoved {van['rest']['x_m'] - VAN_X:.2f} m)")
    vc = corners(van["rest"]["x_m"], van["rest"]["y_m"], van["rest"]["heading_deg"], VAN_LENGTH, VAN_WIDTH)
    print(f"van rest min y (right edge) {min(c[1] for c in vc):.2f} (must be >= -4.6)")
    print(f"crash contact gap at {IMPACT_T}s: {res['crash_contact_gap']}")
    print(f"crash-pair overlaps outside the impact window: {res['pairs_overlap'][:5] if any(p[0] == tuple(sorted((VAN_ID, YELLOW_ID))) for p in res['pairs_overlap']) else 'none'}")
    other = [p for p in res["pairs_overlap"] if p[0] != tuple(sorted((VAN_ID, YELLOW_ID)))]
    print(f"background overlaps / bumper<1m: {len(other)} {other[:8]}")
    print(f"min gap between traffic: {res['min_gap_traffic'][0]:.2f} m at {res['min_gap_traffic'][1]}")
    print(f"min gap traffic-to-crash vehicles: {res['min_gap_to_crash'][0]:.2f} m at {res['min_gap_to_crash'][1]}")
    print(f"max |accel| (excl. impact pulse): {res['max_accel'][0]:.2f} m/s^2 at {res['max_accel'][1]}")
    print(f"barrier: glancing impulse {BARRIER_J[0]:.0f} N*s in the crash pulse; position clamp engaged: {BARRIER_HIT[0]}")
    print(f"impact pulse accels (exempt): {res.get('impact_accel', [])}")
    print(f"max speed: {res['max_speed'][0]:.2f} m/s at {res['max_speed'][1]}")
    print(f"road-bound violations: {res['road_bounds'][:8] or 'none'}")
    print(f"lane-1 block (x 6..28) violations after impact: {res['lane1_block'][:8] or 'none'}")
    ok = (not res["pairs_overlap"] and res["max_accel"][0] <= 9.0 and not res["road_bounds"] and not res["lane1_block"]
          and res["crash_contact_gap"] is not None and abs(res["crash_contact_gap"]) < 0.1)
    print("CHECK", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
