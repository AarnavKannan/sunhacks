"""
Builds incident-spec.json (the app's verified reconstruction of demo.mp4 / demo_32s.mp4, 0-32 s)
from the frame-by-frame measurements in measure/data/:

  br_camera.json    road geometry in the world frame W (lane centres, median)
  tracks_world.json every vehicle, one sample per video frame, in W
  crash_pair.json   the white van and the yellow car, per frame, plus the contact (overrides the
                    crash-flagged tracks in tracks_world.json)

World frame W (measure/README.md): X along the road AWAY from the camera, Y to the camera's RIGHT,
heading 0 = +X, 90 = +Y. The crash carriageway is at negative Y with traffic moving -X.

App plan frame (src/gemini/spec.ts): x along the road with the crash carriageway's traffic moving
+x; y to the LEFT when facing +x; heading 0 = +x, 90 = +y. A vehicle driving toward the camera
(-X) faces +x, and its left is the camera's right (+Y), so

    plan_x = -(X - X_ref)        plan_y = Y - Y_median (+ a per-carriageway lane-fit shift)
    plan direction (cos h, sin h) = (-cos hW, sin hW)  =>  h = 180 - hW
    forces/velocities: (fx, fy)_plan = (-fx, fy)_W

Usage (from anywhere):  python build-measured-spec.py [--data DIR] [--out FILE] [--check]
"""
import argparse, json, math, os, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
FPS = 12.5
DURATION = 32.0
LAST_FRAME = 399

# The road is drawn from the measured painted lines (spec.road.lane_lines_*_m, engine.ts measuredDividedRoad).

FORCE_CAUSES = {"braking", "accelerating", "steering", "impact", "sliding", "rolling_resistance", "drag", "coasting", "other"}
CATEGORY_DEFAULTS = {  # src/gemini/spec.ts
    "sedan": (4.7, 1.82, 1500), "hatchback": (4.2, 1.78, 1250), "suv": (4.8, 1.92, 1900), "pickup": (5.6, 2.0, 2300),
    "van": (5.2, 2.0, 2200), "truck": (8.5, 2.5, 9000), "bus": (12, 2.55, 12000), "motorcycle": (2.1, 0.8, 250),
    "bicycle": (1.8, 0.6, 95), "pedestrian": (0.5, 0.5, 75), "other": (4.5, 1.8, 1500),
}


def wrap(deg):
    return (deg + 180.0) % 360.0 - 180.0


def to_plan_heading(h_w):
    return wrap(180.0 - h_w)


def category_of(cls, length):
    c = (cls or "").lower()
    for key, cat in (("hatch", "hatchback"), ("suv", "suv"), ("pickup", "pickup"), ("van", "van"), ("bus", "bus"),
                     ("truck", "truck"), ("lorry", "truck"), ("semi", "truck"), ("trailer", "truck"), ("motor", "motorcycle"),
                     ("bike", "bicycle"), ("bicycle", "bicycle"), ("person", "pedestrian"), ("pedestrian", "pedestrian"),
                     ("sedan", "sedan"), ("car", "sedan")):
        if key in c:
            if cat == "sedan" and length and length < 4.3:
                return "hatchback"
            return cat
    return "other"


def fnum(v, default=None):
    try:
        v = float(v)
        return v if math.isfinite(v) else default
    except (TypeError, ValueError):
        return default


# ---------------------------------------------------------------------------
# Road geometry from A1


def road_geometry(cam):
    """Painted lines from A1 -> (Y of plan y = 0, crash-side line offsets, right-side line offsets, all lines).

    Plan y = 0 is the median barrier (or, without one, midway between the inner edge lines). Offsets
    are distances from it, inner edge line first, outer edge last."""
    lines = cam.get("lines") or {}
    if isinstance(lines, list):  # [{"name", "Y"}]
        lines = {l.get("name", str(i)): l.get("Y") for i, l in enumerate(lines)}
    lines = {k: (fnum(v.get("Y")) if isinstance(v, dict) else fnum(v)) for k, v in lines.items()}
    lines = {k: v for k, v in lines.items() if v is not None}
    barrier = next((v for k, v in lines.items() if "barrier" in k.lower()), None)
    paint = {k: v for k, v in lines.items() if "barrier" not in k.lower()}
    crash_side = sorted((v for k, v in paint.items() if k.upper().startswith("L")), reverse=True)
    right_side = sorted(v for k, v in paint.items() if k.upper().startswith("R"))
    if len(crash_side) < 2 or len(right_side) < 2:
        raise SystemExit(f"br_camera.json: need the painted lines of both carriageways (got {lines})")
    y0 = barrier if barrier is not None and right_side[0] > barrier > crash_side[0] else (crash_side[0] + right_side[0]) / 2
    return y0, [y0 - y for y in crash_side], [y - y0 for y in right_side], lines


# ---------------------------------------------------------------------------


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=os.path.join(HERE, "measure", "data"))
    ap.add_argument("--out", default=os.path.join(HERE, "incident-spec.json"))
    ap.add_argument("--check", action="store_true", help="only run the frame-mapping unit check")
    args = ap.parse_args()

    check_mapping()
    if args.check:
        return

    cam = json.load(open(os.path.join(args.data, "br_camera.json")))
    tw = json.load(open(os.path.join(args.data, "tracks_world.json")))
    cp_path = os.path.join(args.data, "crash_pair.json")
    cp = json.load(open(cp_path)) if os.path.exists(cp_path) else None

    y_med, lines_fwd, lines_bwd, raw_lines = road_geometry(cam)
    centres_fwd = [-(a + b) / 2 for a, b in zip(lines_fwd, lines_fwd[1:])]   # plan y of each drawn lane centre
    centres_bwd = [(a + b) / 2 for a, b in zip(lines_bwd, lines_bwd[1:])]
    shift_fwd = shift_bwd = 0.0

    # Crash vehicles: A4's file wins; A3's crash-flagged tracks are dropped.
    crash_src = {}
    contact = None
    if cp:
        crash_src = dict(cp.get("vehicles", {}))
        contact = cp.get("contact")
    a3_crash = [t for t in tw["tracks"] if t.get("crash")]
    if not crash_src:  # fallback: take A3's crash-flagged tracks
        for t in a3_crash:
            cat = category_of(t.get("class"), fnum(t.get("length_m")))
            crash_src["white-van" if cat == "van" else "yellow-car"] = t
    background = [t for t in tw["tracks"] if not t.get("crash")]

    t_contact = fnum(contact.get("t")) if contact else None
    if t_contact is None and contact and contact.get("frame") is not None:
        t_contact = int(contact["frame"]) / FPS
    if contact and contact.get("frame") is not None:
        t_contact = int(contact["frame"]) / FPS
    # X_ref: puts the contact at plan x = +12 (crash carriageway traffic runs +x toward it).
    if contact and contact.get("point"):
        x_contact_w = float(contact["point"][0])
    else:
        van = crash_src.get("white-van") or next(iter(crash_src.values()))
        x_contact_w = sorted(float(s["x"]) for s in van["samples"])[len(van["samples"]) // 2]
    X_REF = round(x_contact_w + 12.0, 2)

    def plan_xy(X, Y, side_shift):
        return -(X - X_REF), (Y - y_med) + side_shift

    dropped = []
    objects = []
    lateral_err = []

    def make_object(oid, t, involvement):
        samples = sorted((s for s in t.get("samples", []) if s.get("f") is not None), key=lambda s: s["f"])
        samples = [s for s in samples if 0 <= int(s["f"]) <= LAST_FRAME and fnum(s.get("x")) is not None and fnum(s.get("y")) is not None]
        # one sample per frame
        seen, uniq = set(), []
        for s in samples:
            if int(s["f"]) not in seen:
                seen.add(int(s["f"]))
                uniq.append(s)
        samples = uniq
        if len(samples) < 2:
            dropped.append((t.get("id", oid), f"{len(samples)} usable sample(s) in 0-32 s"))
            return None
        length = fnum(t.get("length_m"))
        cat = category_of(t.get("class"), length)
        dl, dw, dm = CATEGORY_DEFAULTS[cat]
        # Same bounds sanitizeSpec enforces, so the file survives it unchanged.
        # (rounded first, then clamped with the same float bounds JS computes)
        length = min(dl * 1.4, max(dl * 0.6, round(length or dl, 3)))
        width = min(dw * 1.4, max(dw * 0.6, round(fnum(t.get("width_m")) or dw, 3)))
        mass = min(dm * 2, max(dm * 0.5, round(fnum(t.get("mass_kg")) or dm, 1)))
        # Which carriageway: by where it mostly is relative to the median.
        ys = sorted(float(s["y"]) for s in samples)
        on_crash_side = ys[len(ys) // 2] < y_med or involvement == "crash"
        side_shift = shift_fwd if on_crash_side else shift_bwd
        drawn = centres_fwd if on_crash_side else centres_bwd
        kfs = []
        for s in samples:
            f = int(s["f"])
            x, y = plan_xy(float(s["x"]), float(s["y"]), side_shift)
            spd = fnum(s.get("speed_mps"))
            if spd is None:
                spd = math.hypot(fnum(s.get("vx"), 0.0), fnum(s.get("vy"), 0.0))
            hw = fnum(s.get("heading_deg"))
            if hw is None:
                hw = math.degrees(math.atan2(fnum(s.get("vy"), 0.0), fnum(s.get("vx"), 0.0)))
            kfs.append({"t_s": round(f / FPS, 4), "x_m": round(x, 3), "y_m": round(y, 3),
                        "heading_deg": round(to_plan_heading(hw), 2), "speed_mps": round(min(70.0, max(0.0, spd)), 3)})
            if involvement == "background" and drawn:
                lateral_err.append(min(abs(y - d) for d in drawn))
        paint = (t.get("paint") or "grey").strip().lower()
        hexv = t.get("paint_hex") or "#8a8f98"
        if not (isinstance(hexv, str) and len(hexv) == 7 and hexv.startswith("#")):
            hexv = "#8a8f98"
        word = {"other": "vehicle"}.get(cat, cat)
        forces, rest = [], None
        if involvement == "crash":
            for s in samples:
                fx, fy = fnum(s.get("fx_n"), 0.0), fnum(s.get("fy_n"), 0.0)
                cause = str(s.get("cause") or "other")
                forces.append({"t_s": round(int(s["f"]) / FPS, 4), "fx_n": round(max(-2e6, min(2e6, -fx)), 1),
                               "fy_n": round(max(-2e6, min(2e6, fy)), 1), "cause": cause if cause in FORCE_CAUSES else "other",
                               "note": f"measured ({s.get('src', 'video')})" + ("" if cause in FORCE_CAUSES else f"; {cause}")})
            last = kfs[-1]
            rest = {"x_m": last["x_m"], "y_m": last["y_m"], "heading_deg": last["heading_deg"]}
        return {
            "id": oid, "label": f"{paint} {word}", "category": cat, "color_name": paint, "color_hex": hexv.lower(),
            "make": None, "model": None, "involvement": involvement,
            "length_m": length, "width_m": width, "mass_kg": mass,
            "visible_from_s": kfs[0]["t_s"], "visible_to_s": kfs[-1]["t_s"],
            "keyframes": kfs, "forces": forces, "rest": rest,
            "confidence": 0.9 if involvement == "crash" else 0.75,
        }

    for oid in ("white-van", "yellow-car"):
        if oid in crash_src:
            o = make_object(oid, crash_src[oid], "crash")
            if o:
                o["label"] = {"white-van": "white van (stopped in lane 1)", "yellow-car": "yellow car"}.get(oid, o["label"])
                objects.append(o)
    n_bg = 0
    for t in sorted(background, key=lambda t: min((s["f"] for s in t.get("samples", [])), default=9999)):
        o = make_object(f"veh-{n_bg + 1:03d}", t, "background")
        if o:
            o["source_track"] = t.get("id")
            objects.append(o)
            n_bg += 1
    for o in objects:  # source_track is not part of SpecObject; keep it out of the file
        o.pop("source_track", None)

    by_id = {o["id"]: o for o in objects}
    crash = None
    if "white-van" in by_id and "yellow-car" in by_id and t_contact is not None:
        def rest_time(o):
            k = o["keyframes"]
            t_rest = k[-1]["t_s"]
            for i in range(len(k) - 1, -1, -1):
                if k[i]["t_s"] < t_contact or k[i]["speed_mps"] >= 0.3:
                    break
                t_rest = k[i]["t_s"]
            return t_rest
        end = max(t_contact + 0.08, rest_time(by_id["white-van"]), rest_time(by_id["yellow-car"]))
        px, py = plan_xy(*map(float, contact["point"]), shift_fwd) if contact.get("point") else (12.0, centres_fwd[0])
        nw = fnum(contact.get("normal_deg"))
        crash = {
            "start_s": round(t_contact, 4), "end_s": round(min(DURATION, end), 4),
            "kind": "rear-end sideswipe into stationary van",
            "description": (f"The yellow car leaves lane 2 and its front strikes the rear median-side corner of the white van stopped in lane 1 "
                            f"at {t_contact:.2f} s (frame {int(round(t_contact * FPS))}); measured impulse {fnum(contact.get('impulse_ns'), 0) / 1000:.1f} kN·s, "
                            f"peak force {fnum(contact.get('peak_force_n'), 0) / 1000:.0f} kN over {fnum(contact.get('duration_s'), 0):.2f} s. "
                            f"Both vehicles are at rest by {end:.2f} s."),
            "participants": ["yellow-car", "white-van"],
            "contacts": [{"a": "yellow-car", "b": "white-van", "t_s": round(t_contact, 4), "x_m": round(px, 3), "y_m": round(py, 3),
                          "normal_deg": round(to_plan_heading(nw), 2) if nw is not None else float("nan")}],
        }
        if not math.isfinite(crash["contacts"][0]["normal_deg"]):
            crash["contacts"][0]["normal_deg"] = 0.0

    old_path = args.out
    if os.path.exists(old_path):
        old = json.load(open(old_path))
        backup = os.path.join(os.path.dirname(old_path), "incident-spec.hand.json")
        if not str(old.get("prompt_version", "")).startswith("hand-verified-measured") and not os.path.exists(backup):
            shutil.copyfile(old_path, backup)
            print("backed up the hand-authored spec to", backup)

    lat = sorted(lateral_err)
    lat_med = lat[len(lat) // 2] if lat else float("nan")
    lat_p90 = lat[int(len(lat) * 0.9)] if lat else float("nan")
    spec = {
        "prompt_version": "hand-verified-measured-v1",
        "title": "A9 motorway: car strikes stopped van",
        "location_guess": "A9 motorway near Munich, Germany (TUM Traffic gantry cameras)",
        "summary": ("Measured frame by frame (12.5 fps) from the bottom-right gantry camera, first 32 s. A white panel van stands stopped "
                    "in lane 1 (next to the median) of the carriageway toward the camera while traffic steers around it. "
                    + (f"At {t_contact:.2f} s a yellow car swerving out of lane 2 strikes the van's rear median-side corner and both come to rest by {crash['end_s']:.2f} s. " if crash else "")
                    + f"{n_bg} other vehicles are reconstructed from their measured tracks."),
        "duration_s": DURATION,
        "views": [
            {"video_index": 1, "description": "Mosaic tile bottom-right: calibrated gantry camera looking along the road; the crash carriageway (toward the camera) is on the left of the picture, crash site in lane 1 by the median",
             "camera_kind": "fixed gantry traffic camera", "moving": False, "time_offset_s": 0, "plus_x_traffic": "toward_camera"},
            {"video_index": 1, "description": "Mosaic tile bottom-left: neighbouring gantry camera on the same A9 section (not measured)",
             "camera_kind": "fixed gantry traffic camera", "moving": False, "time_offset_s": 0, "plus_x_traffic": "not_visible"},
            {"video_index": 1, "description": "Mosaic tile top-left: neighbouring gantry camera on the same A9 section (not measured)",
             "camera_kind": "fixed gantry traffic camera", "moving": False, "time_offset_s": 0, "plus_x_traffic": "not_visible"},
            {"video_index": 1, "description": "Mosaic tile top-right: neighbouring gantry camera on the same A9 section (not measured)",
             "camera_kind": "fixed gantry traffic camera", "moving": False, "time_offset_s": 0, "plus_x_traffic": "not_visible"},
        ],
        "environment_preset": "snowy",
        "road": {"kind": "divided_highway", "region": "DE", "road_class": "motorway", "lanes_each_way": max(1, min(5, len(centres_fwd))),
                 "cross_lanes_each_way": 1, "surface": "dry", "grade_percent": 0, "speed_limit_mps": None,
                 "lane_lines_forward_m": [round(v, 3) for v in lines_fwd], "lane_lines_backward_m": [round(v, 3) for v in lines_bwd]},
        "wind": {"toward_deg": 0, "speed_mps": 0},
        "crash": crash,
        "objects": objects,
        "caveats": [
            "Positions, headings and speeds are measured per video frame (12.5 fps) from the bottom-right camera, calibrated on the lane dashes (3.75 m lanes assumed); vehicles are shown only while that camera sees them.",
            f"The road is drawn from the measured painted lines: {len(centres_fwd)} lanes toward the camera ({', '.join(f'{b - a:.2f}' for a, b in zip(lines_fwd, lines_fwd[1:]))} m wide) and {len(centres_bwd)} away ({', '.join(f'{b - a:.2f}' for a, b in zip(lines_bwd, lines_bwd[1:]))} m); lateral positions are not shifted.",
            "Forces on the crash pair are derived from the measured motion (m·a) and the momentum exchange at contact, not from instruments.",
            "Vehicle sizes are clamped to the viewer's class ranges (long trucks are drawn shorter).",
            "Pedestrians (the van's driver) and debris are not reconstructed.",
        ],
    }
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(spec, fh, separators=(",", ":"))
        fh.write("\n")

    cats = {}
    for o in objects:
        cats[o["category"]] = cats.get(o["category"], 0) + 1
    print(f"wrote {args.out} ({os.path.getsize(args.out) / 1e6:.1f} MB)")
    print(f"vehicles: {len(objects)} ({len(objects) - n_bg} crash, {n_bg} background); by class {cats}; keyframes {sum(len(o['keyframes']) for o in objects)}")
    print(f"A3 tracks: {len(tw['tracks'])} ({len(a3_crash)} crash-flagged, replaced by crash_pair)" if cp else f"A3 tracks: {len(tw['tracks'])} (no crash_pair.json: crash pair taken from A3)")
    print(f"dropped: {len(dropped)}" + "".join(f"\n  {i}: {why}" for i, why in dropped))
    print(f"X_ref {X_REF:.2f} m (contact X {x_contact_w:.2f} -> plan x {-(x_contact_w - X_REF):.2f}); Y_median {y_med:.3f}")
    print(f"road lines (m from plan y=0 at W Y={y_med:.3f}): forward {[round(v, 3) for v in lines_fwd]} backward {[round(v, 3) for v in lines_bwd]}")
    print(f"drawn lane centres plan y: fwd {[round(v, 2) for v in centres_fwd]} bwd {[round(v, 2) for v in centres_bwd]} (lines drawn exactly where measured)")
    print(f"background lateral distance to nearest drawn lane centre: median {lat_med:.2f} m, p90 {lat_p90:.2f} m")
    if crash:
        print(f"crash: start {crash['start_s']} s, end {crash['end_s']} s, contact plan ({crash['contacts'][0]['x_m']}, {crash['contacts'][0]['y_m']}), normal {crash['contacts'][0]['normal_deg']} deg")
        for oid in ("yellow-car", "white-van"):
            k = by_id[oid]["keyframes"]
            print(f"  {oid}: {len(k)} kf {k[0]['t_s']}-{k[-1]['t_s']} s, rest {by_id[oid]['rest']}")


def check_mapping():
    """Unit check of the W -> plan transform: right-hand traffic on the crash carriageway."""
    # A vehicle on the crash carriageway (Y below the median), driving toward the camera (-X, hW = 180).
    y_med = -4.8
    X, Y, hW = 50.0, y_med - 2.9, 180.0
    x_p, y_p = -(X - 40.0), Y - y_med
    h_p = to_plan_heading(hW)
    assert abs(h_p) < 1e-9, h_p                      # faces +x
    assert y_p < 0, y_p                              # right of +x: right-hand traffic
    # It moves -X; one second later it is at larger plan x.
    assert -((X - 25.0) - 40.0) > x_p
    # Heading vs. motion: plan direction from hW must equal the mapped W velocity direction.
    for hw in (0.0, 30.0, 90.0, 135.0, 180.0, -100.0):
        vx, vy = math.cos(math.radians(hw)), math.sin(math.radians(hw))
        px, py = -vx, vy
        hp = math.radians(to_plan_heading(hw))
        assert abs(math.cos(hp) - px) < 1e-9 and abs(math.sin(hp) - py) < 1e-9, hw
    # A vehicle drifting toward the camera's right (+Y, toward the median from the crash side) moves to plan +y (its left).
    assert to_plan_heading(180.0 - 10.0) > 0
    # Other carriageway: moving +X (hW = 0) at Y above the median -> plan heading 180, plan y > 0.
    assert abs(abs(to_plan_heading(0.0)) - 180.0) < 1e-9 and (y_med + 2.9) - y_med > 0
    print("frame mapping check: PASS (crash-carriageway traffic -> plan heading 0, plan y < 0)")


if __name__ == "__main__":
    main()
