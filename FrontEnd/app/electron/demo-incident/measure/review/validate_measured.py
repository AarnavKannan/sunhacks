"""Audit the real 32-second data and assembled spec without manufacturing acceptance.

Usage: .venv/bin/python FrontEnd/app/electron/demo-incident/measure/review/validate_measured.py
Numerical integrity and data-to-playback fidelity are checked here. Image coverage, identities,
occlusion estimates and collision interpretation still require the saved visual/manual review.
"""
import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path

MEASURE = Path(__file__).resolve().parent.parent
INCIDENT = MEASURE.parent
FPS = 12.5
LAST = 399
SOURCES = {"measured", "interpolated", "occluded-rest", "out-of-view-extrapolated", "edge-extrapolated"}


def read(path):
    with open(path, encoding="utf-8") as stream:
        return json.load(stream)


def wrap(angle):
    return (angle + 180) % 360 - 180


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=MEASURE / "data")
    parser.add_argument("--spec", type=Path, default=INCIDENT / "incident-spec.json")
    parser.add_argument("--out", type=Path, default=Path(__file__).resolve().parent / "final" / "integrity.json")
    args = parser.parse_args()
    errors, warnings, checks = [], [], []

    def check(name, okay, detail=None):
        checks.append({"check": name, "pass": bool(okay), "detail": detail})
        if not okay:
            errors.append(name)

    required = [args.data / "tracks_world.json", args.data / "crash_pair.json", args.data / "divider.json", args.spec,
                Path(str(args.spec) + ".build.json")]
    for path in required:
        check(f"present: {path.name}", path.is_file(), str(path))
    if errors:
        report = {"passed": False, "checks": checks, "errors": errors}
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report, indent=2))
        return 1

    world, pair, divider, spec, build = [read(path) for path in required]
    check("real inputs, not synthetic fixtures", not any(value.get("synthetic") for value in (world, pair, build)))
    check("build metadata matches output bytes", build.get("output", {}).get("sha256") ==
          hashlib.sha256(args.spec.read_bytes()).hexdigest())
    for key, name in (("tracks_world", "tracks_world.json"), ("crash_pair", "crash_pair.json"),
                      ("divider", "divider.json"), ("br_camera", "br_camera.json")):
        source = args.data / name
        check(f"build used current source: {name}", source.exists() and
              build.get("sources", {}).get(key, {}).get("sha256") == hashlib.sha256(source.read_bytes()).hexdigest())
    check("build used current builder", build.get("builder", {}).get("sha256") ==
          hashlib.sha256((INCIDENT / "build-measured-spec.py").read_bytes()).hexdigest())
    upstream = [args.data / name for name in ("tracks_px_clean.json", "calib_joint.json")]
    for name in ("tracks_px_clean", "calib_joint", "crash_pair"):
        source = args.data / (name + ".json")
        check(f"world used current upstream: {name}", source.exists() and
              world.get("source_sha256", {}).get(name) == hashlib.sha256(source.read_bytes()).hexdigest())
    review_path = args.data.parent / "review_tracks" / "REVIEW-COMPLETE.md"
    check("build preserves current frozen tracking review", review_path.exists() and
          build.get("sources", {}).get("tracking_review", {}).get("sha256") == hashlib.sha256(review_path.read_bytes()).hexdigest())
    check("32-second measured production spec", spec.get("duration_s") == 32 and
          str(spec.get("prompt_version", "")).startswith("measured"), spec.get("prompt_version"))
    tracks = world.get("tracks", [])
    vehicles = pair.get("vehicles", {})
    ids = [str(track.get("id")) for track in tracks]
    check("unique world track identities", len(ids) == len(set(ids)), len(ids))
    objects = spec.get("objects", [])
    check("production does not add unsupported road-end traffic", build.get("background_edge_extrapolation") is False and
          not any(k.get("src") == "edge-extrapolated" for obj in objects for k in obj.get("keyframes", [])))
    spec_ids = [obj["id"] for obj in objects]
    check("unique spec object identities", len(spec_ids) == len(set(spec_ids)), len(spec_ids))
    by_id = {obj["id"]: obj for obj in objects}
    static = {obj["id"]: obj for obj in spec.get("static_objects", [])}
    check("fixed measured divider included", "median-divider" in static, list(static))
    for oid, obj in static.items():
        check(f"immovable static geometry: {oid}", obj.get("immovable") is True and
              len(obj.get("footprint_m", [])) >= 3 and obj.get("height_m", -1) >= 0)

    summaries = []
    source_counts = Counter()
    for oid, authoritative in vehicles.items():
        copies = [track for track in tracks if track.get("id") == oid]
        check(f"world preserves authoritative crash samples: {oid}", len(copies) == 1 and
              copies[0].get("samples") == authoritative.get("samples"))
    # Crash-pair samples also occur in tracks_world; validate/count each effective source once.
    effective_tracks = [track for track in tracks if not track.get("crash")]
    effective_tracks += [dict(track, id=oid) for oid, track in vehicles.items()]
    for track in effective_tracks:
        oid = str(track.get("id"))
        samples = track.get("samples", [])
        frames = [sample.get("f") for sample in samples]
        check(f"ordered unique source frames: {oid}", bool(frames) and
              all(isinstance(frame, int) and 0 <= frame <= LAST for frame in frames) and
              frames == sorted(set(frames)))
        invalid, force_error, provenance = [], 0.0, Counter()
        mass = track.get("mass_kg")
        for sample in samples:
            frame = sample.get("f", -1)
            if not isinstance(frame, int):
                continue
            if abs(sample.get("t", frame / FPS) - frame / FPS) > 1e-6:
                invalid.append([frame, "time grid"])
            for key in ("x", "y", "heading_deg", "speed_mps", "vx", "vy", "ax", "ay", "fx_n", "fy_n", "sigma_m"):
                value = sample.get(key)
                if not isinstance(value, (int, float)) or not math.isfinite(value):
                    invalid.append([frame, key])
            src = sample.get("src")
            if src not in SOURCES or sample.get("sigma_m", -1) < 0:
                invalid.append([frame, "provenance"])
            provenance[src] += 1
            if mass and all(isinstance(sample.get(key), (int, float)) for key in ("ax", "ay", "fx_n", "fy_n")):
                force_error = max(force_error, abs(sample["fx_n"] - mass * sample["ax"]),
                                  abs(sample["fy_n"] - mass * sample["ay"]))
        check(f"finite frame-grid samples and provenance: {oid}", not invalid, invalid[:8])
        # Stored acceleration is rounded to .001 m/s² and force to .1 N by world_kinematics.py.
        force_tolerance = (mass or 0) * .00051 + .1
        check(f"source force equals mass times acceleration: {oid}", force_error <= force_tolerance,
              {"error_n": force_error, "rounding_tolerance_n": force_tolerance})
        gaps = sum(max(0, b - a - 1) for a, b in zip(frames, frames[1:]) if isinstance(a, int) and isinstance(b, int))
        if gaps:
            warnings.append(f"{oid}: {gaps} internal missing source frames; playback interpolates across them")
        acceleration = sorted(math.hypot(s.get("ax", 0), s.get("ay", 0)) for s in samples
                              if all(isinstance(s.get(key), (int, float)) for key in ("ax", "ay")))
        summaries.append({"id": oid, "samples": len(samples), "first_frame": frames[0] if frames else None,
                          "last_frame": frames[-1] if frames else None, "internal_missing_frames": gaps,
                          "provenance": dict(provenance), "force_error_n": force_error,
                          "acceleration_median_mps2": acceleration[len(acceleration) // 2] if acceleration else None,
                          "acceleration_p95_mps2": acceleration[min(len(acceleration) - 1, int(len(acceleration) * .95))] if acceleration else None})
        source_counts.update(provenance)

    contacts = (spec.get("crash") or {}).get("contacts", [])
    primary = pair.get("contact") or next((c for c in pair.get("contacts", []) if c.get("kind") == "vehicle-vehicle"), None)
    plan_contact = next((c for c in contacts if primary and c["a"] == primary.get("a") and c["b"] == primary.get("b")), None)
    check("primary measured collision included", bool(primary and plan_contact))
    mapping = None
    if primary and plan_contact:
        mapping = {"X_ref": primary["point"][0] + plan_contact["x_m"],
                   "Y_median": primary["point"][1] - plan_contact["y_m"]}
        check("contact transform agrees with build metadata", abs(mapping["X_ref"] - build.get("X_REF", math.inf)) < .003 and
              abs(mapping["Y_median"] - build.get("Y_median", math.inf)) < .003)
        # Use the unrounded transform for fidelity checks; contacts in the spec are rounded.
        mapping = {"X_ref": build["X_REF"], "Y_median": build["Y_median"]}
        expected_time = primary.get("frame", round(primary.get("t", 0) * FPS)) / FPS
        check("contact uses source frame time", abs(plan_contact["t_s"] - expected_time) <= 1e-6,
              {"frame": primary.get("frame"), "time": plan_contact["t_s"]})
        for oid, track in vehicles.items():
            obj = by_id.get(oid)
            check(f"crash participant assembled: {oid}", obj is not None)
            if not obj:
                continue
            keyframes = {round(k["t_s"] * FPS): k for k in obj["keyframes"]}
            position_error, heading_error, absent, provenance_errors = 0.0, 0.0, [], []
            for sample in track["samples"]:
                keyframe = keyframes.get(sample["f"])
                if keyframe is None:
                    absent.append(sample["f"])
                    continue
                position_error = max(position_error, math.hypot(
                    keyframe["x_m"] - (mapping["X_ref"] - sample["x"]),
                    keyframe["y_m"] - (sample["y"] - mapping["Y_median"])))
                heading_error = max(heading_error, abs(wrap(keyframe["heading_deg"] - (180 - sample["heading_deg"]))))
                if keyframe.get("src") != sample.get("src") or abs(keyframe.get("sigma_m", -1) - sample.get("sigma_m", 0)) > .001:
                    provenance_errors.append(sample["f"])
            check(f"measured crash trajectory preserved: {oid}", not absent and position_error <= .003 and heading_error <= .011,
                  {"max_position_error_m": position_error, "max_heading_error_deg": heading_error, "missing": absent[:8]})
            check(f"crash provenance preserved: {oid}", not provenance_errors, provenance_errors[:8])
        yellow = vehicles.get("yellow-car", {}).get("samples", [])
        check("yellow wreck retained through last frame", bool(yellow) and yellow[-1]["f"] == LAST)
        for contact in pair.get("contacts", [primary]):
            matches = [c for c in contacts if c["a"] == contact.get("a") and c["b"] == contact.get("b") and
                       abs(c["t_s"] - contact.get("frame", round(contact.get("t", 0) * FPS)) / FPS) < 1e-6]
            check(f"contact retained: {contact.get('a')} to {contact.get('b')} f{contact.get('frame')}", bool(matches))
            if matches and contact.get("normal_W"):
                nx, ny = contact["normal_W"]
                expected = math.degrees(math.atan2(ny, -nx))
                check(f"normal transformed: {contact.get('a')} to {contact.get('b')}",
                      abs(wrap(matches[0]["normal_deg"] - expected)) <= .011,
                      {"expected_deg": expected, "actual_deg": matches[0]["normal_deg"]})

        id_map = build.get("source_track_to_spec_id", {})
        for track in tracks:
            if track.get("crash"):
                continue
            samples = track.get("samples", [])
            oid = id_map.get(str(track.get("id")))
            obj = by_id.get(oid)
            opposing = samples and sorted(s["y"] for s in samples)[len(samples) // 2] > mapping["Y_median"]
            if opposing and build.get("omit_opposing"):
                continue
            check(f"background identity assembled: {track.get('id')}", obj is not None, oid)
            if not obj:
                continue
            frames = {round(k["t_s"] * FPS): k for k in obj["keyframes"]}
            absent, changed = [], []
            error_m = 0.0
            for sample in samples:
                keyframe = frames.get(sample["f"])
                if keyframe is None:
                    absent.append(sample["f"])
                    continue
                error_m = max(error_m, math.hypot(keyframe["x_m"] - (mapping["X_ref"] - sample["x"]),
                                                keyframe["y_m"] - (sample["y"] - mapping["Y_median"])))
                if keyframe.get("src") != sample.get("src") or abs(keyframe.get("sigma_m", -1) - sample.get("sigma_m", 0)) > .001:
                    changed.append(sample["f"])
            check(f"background source samples preserved: {track.get('id')}", not absent and not changed and error_m <= .003,
                  {"max_position_error_m": error_m, "missing": absent[:8], "changed_provenance": changed[:8]})

        for obj in [divider] + divider.get("related_objects", []):
            fixed = static.get(obj.get("id"))
            check(f"source static geometry assembled: {obj.get('id')}", fixed is not None)
            if not fixed:
                continue
            actual = fixed["footprint_m"]
            expected = [(mapping["X_ref"] - x, y - mapping["Y_median"]) for x, y in obj["footprint_W"]]
            residual = max(min(math.hypot(x - a, y - b) for a, b in actual) for x, y in expected)
            check(f"fixed footprint transformed: {obj.get('id')}", len(actual) == len(expected) and residual <= .003, residual)

    spec_sources = Counter()
    for obj in objects:
        kfs = obj.get("keyframes", [])
        times = [k["t_s"] for k in kfs]
        check(f"ordered unique playback keyframes: {obj['id']}", bool(times) and times == sorted(set(times)))
        check(f"visibility covers playback trajectory: {obj['id']}", bool(times) and
              obj.get("visible_from_s", math.inf) <= times[0] + 1e-6 and
              obj.get("visible_to_s", -math.inf) >= times[-1] - 1e-6)
        check(f"playback provenance: {obj['id']}", all(k.get("src") in SOURCES and
              isinstance(k.get("sigma_m"), (int, float)) and math.isfinite(k["sigma_m"]) and k["sigma_m"] >= 0 for k in kfs))
        spec_sources.update(k.get("src") for k in kfs)

    coverage = []
    for frame in (0, 100, 125, 188, 212, 213, 250, 300, 350, 399):
        time = frame / FPS
        active = [obj["id"] for obj in objects if obj["keyframes"] and
                  obj["keyframes"][0]["t_s"] - 1e-6 <= time <= obj["keyframes"][-1]["t_s"] + 1e-6]
        lanes = Counter()
        for track in tracks:
            if track.get("crash"):
                continue
            sample = next((s for s in track.get("samples", []) if s["f"] == frame), None)
            if sample:
                lanes[str(sample.get("lane", "unknown"))] += 1
        coverage.append({"frame": frame, "time_s": time, "spec_visible_count": len(active),
                         "spec_visible_ids": active, "background_source_samples_by_lane": dict(lanes)})

    report = {"passed": not errors, "spec_version": spec.get("prompt_version"), "mapping": mapping,
              "input_sha256": {str(path.relative_to(INCIDENT)) if path.is_relative_to(INCIDENT) else str(path):
                               hashlib.sha256(path.read_bytes()).hexdigest() for path in required + upstream if path.exists()},
              "world_track_count": len(tracks), "spec_vehicle_count": len(objects),
              "static_ids": list(static), "source_provenance": dict(source_counts),
              "spec_provenance": dict(spec_sources), "contact_count": len(contacts),
              "checks": checks, "errors": errors, "warnings": warnings, "tracks": summaries, "checkpoints": coverage,
              "visual_acceptance": "Requires source overlays, manual lane-count audit, real viewer playback and user testing; this report checks data integrity only."}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2) + "\n")
    print(f"{'PASS' if not errors else 'FAIL'}: {len(checks)} integrity checks, {len(errors)} failures, {len(warnings)} warnings")
    for error in errors[:30]:
        print("  FAIL", error)
    print(f"Report: {args.out}")
    return int(bool(errors))


if __name__ == "__main__":
    raise SystemExit(main())
