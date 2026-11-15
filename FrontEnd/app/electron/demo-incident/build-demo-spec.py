"""Builds incident-spec.json for the demo clip (first 32 s, frames 0..399) from the measured tracks.

Same idea as build-spec.py (a generator writes every vehicle's keyframes; the app's engine only
replays them), but positions now come from the per-frame measurements of the bottom-right camera
instead of hand estimates and simulated traffic:

  measure/data/tracks_world.json  every crash-side vehicle, one sample per video frame (12.5 fps):
                                  position, heading, speed and lane. Lane changes therefore happen on
                                  the exact frame they happen in the video.
  measure/data/crash_pair.json    the yellow car and the white van (authoritative for those two).
  measure/data/divider.json       the median verge, barrier and far hedge: fixed collision objects.
  measure/data/br_camera.json     measured painted lane lines.

Views are weighted: the bottom-right camera (clearest view of the crash) sets every position; the
other three tiles only fill blanks (context), at lower weight.

What the generator changes, and why (all logged in the spec's caveats):
  - Vehicles that leave the bottom of the camera keep driving past it (out of the source view), so
    they do not vanish mid-road in the 3-D view.
  - Overlapping vehicles (tracking noise, drawn bodies with mirrors) are separated by the smallest
    longitudinal shift, blended over ~1 s; true duplicates are dropped.
  - The yellow car: measured up to first contact with the van (frame 291). Afterwards it stays pressed
    against the van's median-side rear quarter and is carried forward with it, as the video shows
    (frames 292-316), instead of passing through the van.
  - Opposing traffic is not reconstructed.

Run: python build-demo-spec.py            (writes incident-spec.json next to this file)
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "measure", "data")
OUT = os.path.join(HERE, "incident-spec.json")
sys.path.insert(0, os.path.join(HERE, "measure"))
import cam  # noqa: E402  calibrated bottom-right camera (measure/cam.py)

FPS = 12.5
DT = 1 / FPS
N_FRAMES = 400                     # frames 0..399 = 0..31.92 s
DURATION = 32.0
# Plan frame (the app's): x = X_REF - X_W (traffic toward the camera drives +x), y = Y_W - Y_MEDIAN
# (median barrier at y = 0, crash carriageway at y < 0), heading = 180 - heading_W.
X_REF = 95.06
Y_MEDIAN = -4.803
VAN_ID, YELLOW_ID = "white-van", "yellow-car"
CONTACT_F = 291                    # first yellow/van contact (crash_pair.json)
VERGE_F = 283                      # yellow car first crosses onto the median verge
GLUE_F = 300                       # from here on the yellow car rides with the van (relative pose of f300)
EXIT_X_W = 75.0                    # a track that ends nearer than this left through the bottom of the frame
RUNOUT_X = 400.0                   # extrapolate exits to this plan x (well past the camera)

# Drawn model sizes (engine.ts modelSize, measured from cars.ts) and the loader's length limits.
MODELS = {"sedan": (4.89, 2.18), "hatchback": (4.38, 2.14), "suv": (5.14, 2.32), "van": (5.284, 2.36), "truck": (12.5, 3.06)}
DEFAULT_LEN = {"sedan": 4.7, "hatchback": 4.2, "suv": 4.8, "van": 5.2, "truck": 8.5}
MAX_LEN = {"truck": 16.6}          # spec.ts allows long articulated trucks (see sanitizeSpec)
BODY_WIDTH = 0.9                   # mirrors stick out ~5 % each side; bodies are what collide
GAP_M = 0.25                       # clearance kept between background vehicles


def wrap(a):
    return (a + 180.0) % 360.0 - 180.0


def r3(v):
    return round(float(v), 3)


def to_plan(x_w, y_w):
    return X_REF - x_w, y_w - Y_MEDIAN


def plan_heading(h_w):
    return wrap(180.0 - h_w)


def category_of(cls, length):
    if cls == "truck":
        return "truck"
    if cls == "van":
        return "van"
    return "hatchback" if length < 4.45 else "sedan" if length < 4.95 else "suv"


def drawn_size(category, length):
    """Length/width the engine will draw (spec.ts clamps length, engine.ts scales the model)."""
    lo, hi = DEFAULT_LEN[category] * 0.6, MAX_LEN.get(category, DEFAULT_LEN[category] * 1.4)
    length = min(hi, max(lo, length))
    ml, mw = MODELS[category]
    scale = min(1.35, max(0.75, length / ml))
    return ml * scale, mw * scale


# ---------------------------------------------------------------- oriented boxes (separating axes)

def corners(x, y, h, length, width):
    c, s = math.cos(math.radians(h)), math.sin(math.radians(h))
    hl, hw = length / 2, width / 2
    return [(x + dx * c - dy * s, y + dx * s + dy * c) for dx, dy in ((hl, hw), (hl, -hw), (-hl, -hw), (-hl, hw))]


def overlap(a, b):
    for poly in (a, b):
        for i in range(4):
            p, q = poly[i], poly[(i + 1) % 4]
            nx, ny = q[1] - p[1], p[0] - q[0]
            pa = [nx * u + ny * v for u, v in a]
            pb = [nx * u + ny * v for u, v in b]
            if max(pa) < min(pb) or max(pb) < min(pa):
                return False
    return True


def gap_ok(pa, pb, da, db, clearance):
    """True if two bodies (pose (x, y, h), drawn size (L, W)) are at least `clearance` apart."""
    a = corners(pa[0], pa[1], pa[2], da[0] + 2 * clearance, da[1] * BODY_WIDTH + 2 * clearance)
    b = corners(pb[0], pb[1], pb[2], db[0], db[1] * BODY_WIDTH)
    return not overlap(a, b)


# ---------------------------------------------------------------- inputs

def load(name):
    with open(os.path.join(DATA, name), encoding="utf-8") as fh:
        return json.load(fh)


def vehicle(track_id, cls, paint, hex_color, length, width, height, mass, samples, involvement):
    category = category_of(cls, length)
    label = f"{paint.capitalize()} {category}" if paint else category.capitalize()
    return {
        "id": track_id, "label": label, "category": category, "color_name": paint or "grey",
        "color_hex": hex_color or "#808080", "make": None, "model": None, "involvement": involvement,
        "length_m": r3(length), "width_m": r3(width), "height_m": r3(height), "mass_kg": round(mass),
        "frames": samples, "drawn": drawn_size(category, length),
        "measured_fraction": sum(1 for s in samples.values() if s[4] == "measured") / max(1, len(samples)),
    }


def frames_from(samples):
    """Measured samples (W) -> {frame: [x, y, heading, speed, src, sigma, lane]} in the plan frame."""
    out = {}
    for s in samples:
        f = int(s["f"])
        if f >= N_FRAMES:
            continue
        x, y = to_plan(s["x"], s["y"])
        out[f] = [x, y, plan_heading(s["heading_deg"]), max(0.0, s["speed_mps"]), s.get("src", "measured"),
                  s.get("sigma_m"), s.get("lane")]
    return out


# ---------------------------------------------------------------- crash pair

def build_crash(cp, notes):
    yv, vv = cp["vehicles"][YELLOW_ID], cp["vehicles"][VAN_ID]
    van = vehicle(VAN_ID, "van", "white", "#F2F2F2", vv["length_m"], vv["width_m"], vv.get("height_m", 2.3),
                  vv["mass_kg"], frames_from(vv["samples"]), "crash")
    van["label"] = "White van"
    yellow = vehicle(YELLOW_ID, "car", "yellow", "#E8C21A", yv["length_m"], yv["width_m"], yv.get("height_m", 1.5),
                     yv["mass_kg"], frames_from(yv["samples"]), "crash")
    yellow["label"] = "Yellow car"
    yellow["category"] = "hatchback"
    yellow["drawn"] = drawn_size("hatchback", yv["length_m"])

    vf, yf = van["frames"], yellow["frames"]
    dv, dy = van["drawn"], yellow["drawn"]

    def rel_pose(f):
        vx, vy, vh = vf[f][:3]
        x, y, h = yf[f][:3]
        c, s = math.cos(math.radians(vh)), math.sin(math.radians(vh))
        dx, dyy = x - vx, y - vy
        return (dx * c + dyy * s, -dx * s + dyy * c, wrap(h - vh))

    def world_from(f, rel):
        vx, vy, vh = vf[f][:3]
        c, s = math.cos(math.radians(vh)), math.sin(math.radians(vh))
        return (vx + rel[0] * c - rel[1] * s, vy + rel[0] * s + rel[1] * c, wrap(vh + rel[2]))

    def push_clear(f, pose, clearance=0.02):
        """Move the yellow car sideways, away from the van (toward the median), until bodies just touch."""
        x, y, h = pose
        step = 0.0
        while step < 3.0 and not gap_ok((x, y + step, h), vf[f][:3], dy, dv, clearance):
            step += 0.02
        return (x, y + step, h), step

    # 1. Before contact the measured paths must not interpenetrate.
    moved = 0
    for f in range(min(yf), CONTACT_F):
        if f in yf and f in vf and not gap_ok(yf[f][:3], vf[f][:3], dy, dv, 0.0):
            (x, y, h), step = push_clear(f, tuple(yf[f][:3]))
            yf[f][:3] = [x, y, h]
            moved = max(moved, step)
    if moved:
        notes.append(f"Yellow car moved up to {moved:.2f} m toward the median before first contact so it touches the van at frame {CONTACT_F}, not earlier.")

    # 2. After contact: glued to the van's median-side rear quarter (relative pose of GLUE_F, cleared).
    glue = rel_pose(GLUE_F)
    gx, gy, gh = world_from(GLUE_F, glue)
    (gx, gy, gh), _ = push_clear(GLUE_F, (gx, gy, gh))
    glue = None
    vx, vy, vh = vf[GLUE_F][:3]
    c, s = math.cos(math.radians(vh)), math.sin(math.radians(vh))
    glue = ((gx - vx) * c + (gy - vy) * s, -(gx - vx) * s + (gy - vy) * c, wrap(gh - vh))
    contact_pose = tuple(yf[CONTACT_F][:3])
    contact_rel = rel_pose(CONTACT_F)
    for f in range(CONTACT_F, N_FRAMES):
        if f <= GLUE_F:
            u = (f - CONTACT_F) / (GLUE_F - CONTACT_F)
            u = u * u * (3 - 2 * u)
            rel = (contact_rel[0] + (glue[0] - contact_rel[0]) * u, contact_rel[1] + (glue[1] - contact_rel[1]) * u,
                   contact_rel[2] + wrap(glue[2] - contact_rel[2]) * u)
        else:
            rel = glue
        pose = world_from(f, rel)
        pose, _ = push_clear(f, pose)
        src = yf.get(f, [None] * 7)[4] if f <= 316 else "occluded"
        speed = vf[f][3]
        yf[f] = [pose[0], pose[1], pose[2], speed, "measured" if src == "measured" else "inferred-with-van", 0.6, 1]
    notes.append(f"Yellow car after first contact (frame {CONTACT_F}, {CONTACT_F * DT:.2f} s): pressed against the van's "
                 "median-side rear quarter and carried forward with it, as in the video (it is last visible at frame 316); "
                 f"the pose relative to the van is the measured one at frame {GLUE_F}.")

    # Rest poses: where both end (the clip ends with the van stopped).
    for v in (van, yellow):
        last = v["frames"][max(v["frames"])]
        v["rest"] = {"x_m": r3(last[0]), "y_m": r3(last[1]), "heading_deg": r3(last[2])} if last[3] < 0.5 else None
    return yellow, van, contact_pose


# ---------------------------------------------------------------- background

def extend_exit(v):
    """A vehicle that left through the bottom of the camera keeps driving along its lane past it."""
    fr = v["frames"]
    last_f = max(fr)
    x, y, h, speed = fr[last_f][:4]
    if last_f >= N_FRAMES - 1 or speed < 1.0:
        return 0
    # Leaving the picture: the next frame's position projects outside the tile (calibrated camera).
    x_w, y_w = X_REF - (x + speed * DT * 2), y + Y_MEDIAN
    u, v_px = cam.to_img(x_w, y_w)
    inside = 0 <= u[0] < 479 and 0 <= v_px[0] < 300
    if inside and X_REF - x > EXIT_X_W:
        return 0
    added = 0
    for f in range(last_f + 1, N_FRAMES):
        x += speed * DT
        if x > RUNOUT_X:
            break
        fr[f] = [x, y, 0.0, speed, "out-of-view-extrapolated", None, fr[last_f][6]]
        added += 1
    return added


def separate(vehicles, crash_ids, notes, rounds=8):
    """Removes overlaps: true duplicates are dropped, the rest get the smallest longitudinal shift."""
    by_id = {v["id"]: v for v in vehicles}
    dropped = []
    shifted = {}
    for _ in range(rounds):
        conflicts = {}
        ids = [v["id"] for v in vehicles if v["id"] not in dropped]
        for f in range(N_FRAMES):
            present = [i for i in ids if f in by_id[i]["frames"]]
            for a_i in range(len(present)):
                for b_i in range(a_i + 1, len(present)):
                    A, B = by_id[present[a_i]], by_id[present[b_i]]
                    pa, pb = A["frames"][f], B["frames"][f]
                    if abs(pa[0] - pb[0]) > 20 or abs(pa[1] - pb[1]) > 5:
                        continue
                    clearance = 0.0 if (A["id"] in crash_ids and B["id"] in crash_ids) else GAP_M
                    if not gap_ok(pa[:3], pb[:3], A["drawn"], B["drawn"], clearance):
                        conflicts.setdefault((A["id"], B["id"]), []).append(f)
        if not conflicts:
            break
        for (a, b), frames in conflicts.items():
            if a in dropped or b in dropped:
                continue
            A, B = by_id[a], by_id[b]
            if A["id"] in crash_ids and B["id"] in crash_ids:
                continue
            # Duplicate: the overlap covers most of the shorter track.
            short, long_ = (A, B) if len(A["frames"]) <= len(B["frames"]) else (B, A)
            if short["id"] not in crash_ids and len(frames) >= 0.6 * len(short["frames"]):
                dropped.append(short["id"])
                continue
            # A weakly tracked vehicle on top of a crash vehicle is a ghost of its wireframe.
            crash_side = A if A["id"] in crash_ids else B if B["id"] in crash_ids else None
            if crash_side is not None:
                other_side = B if crash_side is A else A
                if other_side["measured_fraction"] < 0.4:
                    dropped.append(other_side["id"])
                    continue
            # Otherwise move the non-crash vehicle: sideways if a small nudge does it (adjacent lanes),
            # else the follower (smaller x: behind, traffic drives +x) drops back.
            f_mid = frames[len(frames) // 2]
            mover, other = (A, B) if A["frames"][f_mid][0] < B["frames"][f_mid][0] else (B, A)
            if mover["id"] in crash_ids:
                mover, other = other, mover

            def needed(axis, sign, limit, clearance):
                worst = 0.0
                for f in frames:
                    p, q = mover["frames"][f], other["frames"][f]
                    d = 0.0
                    while d <= limit:
                        moved = (p[0] + sign * d, p[1], p[2]) if axis == 0 else (p[0], p[1] + sign * d, p[2])
                        if gap_ok(moved, q[:3], mover["drawn"], other["drawn"], clearance):
                            break
                        d += 0.02
                    worst = max(worst, d)
                return worst

            lat_sign = 1.0 if mover["frames"][f_mid][1] > other["frames"][f_mid][1] else -1.0
            lateral = needed(1, lat_sign, 0.62, 0.05)
            if lateral <= 0.6:
                axis, sign, need = 1, lat_sign, lateral
            else:
                sign = 1.0 if mover["frames"][f_mid][0] > other["frames"][f_mid][0] else -1.0
                axis, need = 0, needed(0, sign, 15, GAP_M)
            if need > 15:
                dropped.append(mover["id"])
                continue
            f0, f1 = frames[0], frames[-1]
            ramp = 12  # ~1 s blend in and out
            for f in list(mover["frames"]):
                if f < f0 - ramp or f > f1 + ramp:
                    continue
                if f < f0:
                    w = (f - (f0 - ramp)) / ramp
                elif f > f1:
                    w = ((f1 + ramp) - f) / ramp
                else:
                    w = 1.0
                w = w * w * (3 - 2 * w)
                mover["frames"][f][axis] += sign * need * w
            key = mover["id"] + (" (sideways)" if axis == 1 else "")
            shifted[key] = max(shifted.get(key, 0.0), need)
    vehicles[:] = [v for v in vehicles if v["id"] not in dropped]
    if dropped:
        notes.append(f"Dropped {len(dropped)} duplicate/clutter track(s) that coincided with another vehicle: {', '.join(sorted(dropped))}.")
    if shifted:
        worst = max(shifted.values())
        notes.append(f"Separated {len(shifted)} vehicle(s) whose drawn bodies overlapped (tracking noise): longitudinal shifts up to {worst:.2f} m, blended over ~1 s.")
    return dropped, shifted


# ---------------------------------------------------------------- static objects (median)

def static_objects(dv):
    """Plan-frame median objects. The measured verge covers the camera's view; beyond it is inferred."""
    def plan_rect(x_w0, x_w1, y_w0, y_w1):
        (xa, ya), (xb, yb) = to_plan(x_w0, y_w0), to_plan(x_w1, y_w1)
        x0, x1 = sorted((xa, xb))
        y0, y1 = sorted((ya, yb))
        return [[r3(x1), r3(y1)], [r3(x0), r3(y1)], [r3(x0), r3(y0)], [r3(x1), r3(y0)]]

    verge = dv
    rel = {o["id"]: o for o in dv.get("related_objects", [])}
    barrier, hedge = rel.get("median-barrier"), rel.get("median-hedge-far")
    common = lambda o: {"friction": o["friction"], "restitution": o["restitution"], "stiffness_n_per_m": o["stiffness_n_per_m"],
                        "immovable": True, "sigma_m": o.get("sigma_m", 0.1)}
    v_y = (verge["face_Y_crash_side"], verge["face_Y_far_side"])
    out = [{
        "id": "median-divider", "kind": "median_divider", "label": "Median verge (snow-covered grass)",
        # Measured over the camera's view (X_W 55.5..158.9 m); continued past the camera (inferred).
        "footprint_m": plan_rect(X_REF - RUNOUT_X, verge["x_range"][1], v_y[0], v_y[1]),
        "height_m": verge["height_m"], "material": verge["material"], **common(verge), "source": "measured",
        "note": "Snow-covered grass verge between the crash carriageway's inner edge line and the median barrier. "
                "Measured where the camera sees it (x -63.8..39.6 m); continued past the camera as inferred. "
                "Immovable; the yellow car runs onto it at 22.64 s before striking the van. " + verge.get("contact_params_source", ""),
    }]
    if barrier:
        b_y = (barrier["face_Y_crash_side"], barrier["face_Y_far_side"])
        out.append({
            "id": "median-barrier", "kind": "barrier", "label": "Median barrier",
            "footprint_m": plan_rect(X_REF - RUNOUT_X, X_REF + 850, b_y[0], b_y[1]),
            "height_m": barrier["height_m"], "material": barrier["material"], **common(barrier), "source": "measured",
            "note": "Concrete barrier on the far side of the verge (measured over the camera's view, continued along the road). "
                    + barrier.get("contact_params_source", ""),
        })
    if hedge:
        h_y = (hedge["face_Y_crash_side"], hedge["face_Y_far_side"])
        out.append({
            "id": "median-hedge-far", "kind": "other", "label": "Median hedge (far section)",
            "footprint_m": plan_rect(verge["x_range"][1], X_REF + 850, h_y[0], h_y[1]),
            "height_m": hedge["height_m"], "material": "hedge", **common(hedge), "source": "inferred",
            "note": hedge.get("note", "")[:400],
        })
    return out


# ---------------------------------------------------------------- main

def main():
    tw, cp, dv, cam = load("tracks_world.json"), load("crash_pair.json"), load("divider.json"), load("br_camera.json")
    notes = []
    yellow, van, _ = build_crash(cp, notes)

    background = []
    for t in tw["tracks"]:
        if t["crash"] or t.get("carriageway") != "crash":
            continue
        background.append(vehicle(t["id"], t["class"], t.get("paint"), t.get("paint_hex"), t["length_m"], t["width_m"],
                                  t.get("height_m", 1.6), t["mass_kg"], frames_from(t["samples"]), "background"))
    exits = sum(1 for v in background if extend_exit(v))
    notes.append(f"{exits} vehicles that leave through the bottom of the camera keep driving past it (out of the source view).")

    vehicles = [van, yellow] + background
    separate(vehicles, {VAN_ID, YELLOW_ID}, notes)

    lines = cam["lines_Y"]
    forward = [r3(Y_MEDIAN - lines[k]) for k in ("L_edge_inner", "L_1_2", "L_2_3", "L_3_4", "L_4_5", "L_5_6", "L_edge_outer")]
    backward = [r3(lines[k] - Y_MEDIAN) for k in ("R_edge_left", "R_A", "R_B", "R_C")]
    backward[0] = r3(abs(backward[0]))

    objects = []
    for v in vehicles:
        frames = sorted(v["frames"])
        keyframes = []
        for f in frames:
            x, y, h, speed, src, sigma, _lane = v["frames"][f]
            k = {"t_s": r3(f * DT), "x_m": r3(x), "y_m": r3(y), "heading_deg": r3(h), "speed_mps": r3(speed)}
            keyframes.append(k)
        obj = {k: v[k] for k in ("id", "label", "category", "color_name", "color_hex", "make", "model", "involvement",
                                 "length_m", "width_m", "height_m", "mass_kg")}
        obj.update({"visible_from_s": keyframes[0]["t_s"], "visible_to_s": keyframes[-1]["t_s"], "keyframes": keyframes,
                    "forces": [], "rest": v.get("rest"), "confidence": 0.95 if v["involvement"] == "crash" else 0.85})
        objects.append(obj)

    contact = cp["contact"]
    cx, cy = to_plan(*contact["point"])
    verge_contact = next((c for c in cp.get("contacts", []) if "divider" in str(c.get("b", "")) or c.get("kind") == "vehicle-static"), None)
    contacts = []
    if verge_contact:
        vx_, vy_ = to_plan(*verge_contact["point"]) if "point" in verge_contact else (yellow["frames"][VERGE_F][0], yellow["frames"][VERGE_F][1])
        contacts.append({"a": YELLOW_ID, "b": "median-divider", "t_s": r3(VERGE_F * DT), "x_m": r3(vx_), "y_m": r3(vy_),
                         "normal_deg": 90.0, "kind": "vehicle-static", "frame": VERGE_F, "source": "measured",
                         "note": "Yellow car's footprint first crosses onto the median verge (immovable)."})
    contacts.append({"a": YELLOW_ID, "b": VAN_ID, "t_s": r3(CONTACT_F * DT), "x_m": r3(cx), "y_m": r3(cy),
                     "normal_deg": 0.0, "kind": "vehicle-vehicle", "frame": CONTACT_F,
                     "impulse_ns": r3(contact.get("impulse_ns", 0)), "source": contact.get("source", "inferred"),
                     "note": "Yellow car's front strikes the stopped van's median-side rear corner; the van is shoved forward."})

    views = [
        {"video_index": 1, "weight": 1.0, "description": "PRIMARY (weight 1.0). Bottom-right tile: crash camera looking along the +x carriageway; the clearest view of the crash. Sets every position, lane change, speed and contact.",
         "camera_kind": "fixed gantry traffic camera", "moving": False, "time_offset_s": 0, "plus_x_traffic": "toward_camera"},
        {"video_index": 1, "weight": 0.25, "description": "Context (weight 0.25). Bottom-left tile: neighbouring gantry camera; fills blanks about surrounding vehicles only.",
         "camera_kind": "fixed gantry traffic camera", "moving": False, "time_offset_s": 0, "plus_x_traffic": "not_visible"},
        {"video_index": 1, "weight": 0.25, "description": "Context (weight 0.25). Top-left tile: neighbouring gantry camera; fills blanks about surrounding vehicles only.",
         "camera_kind": "fixed gantry traffic camera", "moving": False, "time_offset_s": 0, "plus_x_traffic": "not_visible"},
        {"video_index": 1, "weight": 0.25, "description": "Context (weight 0.25). Top-right tile: neighbouring gantry camera; fills blanks about surrounding vehicles only.",
         "camera_kind": "fixed gantry traffic camera", "moving": False, "time_offset_s": 0, "plus_x_traffic": "not_visible"},
    ]

    spec = {
        "prompt_version": "hand-verified-a9-v2-measured",
        "title": "A9 motorway: car strikes stopped van",
        "location_guess": "A9 motorway near Munich, Germany (TUM Traffic gantry cameras)",
        "summary": ("A white panel van stands stopped in lane 1 (next to the median) of a busy six-lane carriageway; traffic flows "
                    "around it. The yellow car comes down lane 1, moves out to lane 2 at 20.4 s to overtake, cuts back toward lane 1 "
                    "at 22.4 s, runs onto the median verge at 22.64 s and strikes the van's median-side rear corner at 23.28 s. "
                    "The van is shoved forward with the yellow car pressed against its side."),
        "duration_s": DURATION,
        "views": views,
        "environment_preset": "snowy",
        "road": {"kind": "divided_highway", "region": "DE", "road_class": "motorway", "lanes_each_way": 6,
                 "cross_lanes_each_way": 1, "surface": "dry", "grade_percent": 0, "speed_limit_mps": None,
                 "lane_lines_forward_m": forward, "lane_lines_backward_m": backward},
        "wind": {"toward_deg": 0, "speed_mps": 0},
        "crash": {"start_s": r3(CONTACT_F * DT), "end_s": DURATION - DT, "kind": "car strikes stopped van at the median verge",
                  "description": ("Yellow car (lane 1 -> lane 2 -> lane 1) runs onto the snow-covered median verge, its front strikes the "
                                  "stopped white van's median-side rear corner and stays pressed against the van as it is shoved forward."),
                  "participants": [YELLOW_ID, VAN_ID], "contacts": contacts},
        "objects": objects,
        "static_objects": static_objects(dv),
        "caveats": [
            "Measured frame by frame from the bottom-right (crash) camera at 12.5 fps; the other tiles are context only.",
            "Opposing traffic is not reconstructed.",
            "Speeds far from the camera (hundreds of metres) come from few pixels and are less certain than near the crash.",
            "Vehicles appear when the camera first sees them at the horizon; tracks the camera lost at the horizon end there.",
            "Contact forces/impulses are derived from the measured motion and assumed masses, not measured directly.",
        ] + notes,
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(spec, fh, indent=1)
    print(f"wrote {OUT}: {len(objects)} vehicles, {sum(len(o['keyframes']) for o in objects)} keyframes, "
          f"{len(spec['static_objects'])} static objects, {len(contacts)} contacts")
    for n in notes:
        print(" -", n)


if __name__ == "__main__":
    main()
