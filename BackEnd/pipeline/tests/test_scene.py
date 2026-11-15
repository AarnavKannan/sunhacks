import json
import math

import numpy as np
import pytest

from reconstruct.geometry import camera_forward, heading_forward

def test_package_is_measured_from_the_mosaic(package):
    data = _load(package)
    manifest = data["manifest"]
    assert manifest["tracks_are_schematic"] is False
    assert manifest["impact_time_s"] is not None
    # Primary crash is ~23 s on carriageway B; allow a small kinematic window.
    assert 18.0 <= manifest["impact_time_s"] <= 26.0
    assert manifest["fps"] == pytest.approx(12.5)
    assert manifest["duration_s"] == pytest.approx(59.92)
    assert manifest["frame_count"] == 749
    assert manifest["source"]["has_audio"] is False
    assert manifest["pipeline"]["command"] == "reconstruct build"
    assert "impact" in [event["type"] for event in data["events"]["events"]]
    assert data["tracks"]["tracks"]
    assert {entity["id"] for entity in data["entities"]["entities"]} == {
        track["entity_id"] for track in data["tracks"]["tracks"]
    }


def _load(package):
    return {name: json.loads((package / f"{name}.json").read_text()) for name in (
        "manifest",
        "tracks",
        "entities",
        "events",
        "cameras",
    )}


def test_tracks_follow_their_carriageway(package):
    data = _load(package)
    road = data["manifest"]["road"]
    entities = {entity["id"]: entity for entity in data["entities"]["entities"]}
    carriageways = set()
    for track in data["tracks"]["tracks"]:
        entity = entities[track["entity_id"]]
        carriageways.add(track["carriageway"])
        start = track["visibility"]["t_start"]
        end = track["visibility"]["t_end"]
        samples = track["samples"]
        assert samples[0]["t"] == pytest.approx(start)
        assert samples[-1]["t"] == pytest.approx(end)
        assert end > start
        sign = road["carriageways"][track["carriageway"]]["z_sign"]
        heading = road["carriageways"][track["carriageway"]]["heading"]
        speeds = []
        for sample in samples:
            assert road["x_min_m"] - 0.5 <= sample["pos"][0] <= road["x_max_m"] + 0.5
            assert sample["pos"][1] > 0
            assert math.copysign(1, sample["pos"][2]) == sign
            speeds.append(sample["speed_mps"])
        med_speed = float(np.median(speeds))
        # Fully moving tracks only. Braking-into-crash paths can reverse briefly.
        fully_moving = med_speed >= 5.0 and min(speeds) >= 3.0
        for sample in samples:
            if not fully_moving or sample["speed_mps"] < 3.0:
                continue
            forward = heading_forward(sample["heading_deg"])
            vel = sample["vel"]
            assert vel[0] * forward[0] + vel[2] * forward[2] == pytest.approx(
                sample["speed_mps"], abs=0.05
            )
            if heading == "-X":
                assert sample["vel"][0] < 0
            else:
                assert sample["vel"][0] > 0
        for earlier, later in zip(samples, samples[1:]):
            assert later["t"] - earlier["t"] == pytest.approx(0.08, abs=1e-6)
        assert med_speed <= 48.0
        assert med_speed >= 5.0 or (end - start) >= 1.5
        assert entity["carriageway"] == track["carriageway"]
        assert entity["make"] is None
        assert entity["model"] is None
        assert entity["label_source"] == "measured"
        assert entity["type"] in {"car", "van", "truck"}
        assert f"the {entity['label']}" in entity["aliases"]
        for sample in samples:
            for key in ("pos", "quat", "vel", "acc", "speed_mps", "heading_deg", "yaw_rate", "sigma"):
                assert key in sample
    assert carriageways == {"a", "b"}
    assert len(data["tracks"]["tracks"]) >= 66


def test_shared_class_splats_and_mosaic(package):
    entities = json.loads((package / "entities.json").read_text())["entities"]
    by_type: dict[str, set[str]] = {}
    for entity in entities:
        by_type.setdefault(entity["type"], set()).add(entity["splat"])
        assert (package / entity["splat"]).is_file()
    assert by_type["car"] == {"vehicles/car.ply"}
    assert by_type["van"] == {"vehicles/van.ply"}
    assert by_type["truck"] == {"vehicles/truck.ply"}
    background = (package / "background.ply").read_bytes()
    assert background.startswith(b"ply\nformat binary_little_endian 1.0\n")
    assert b"element vertex" in background.split(b"end_header", 1)[0]
    vertex_line = next(
        line for line in background.split(b"end_header", 1)[0].splitlines() if line.startswith(b"element vertex")
    )
    count = int(vertex_line.split()[-1])
    assert 200 < count < 2000
    manifest = json.loads((package / "manifest.json").read_text())
    mosaic = package / "sources" / "mosaic.mp4"
    assert mosaic.is_file()
    import hashlib

    digest = hashlib.sha256(mosaic.read_bytes()).hexdigest()
    assert digest == manifest["source"]["sha256"]


def test_crops_tile_the_views_and_skip_gutters(package):
    manifest = json.loads((package / "manifest.json").read_text())
    cameras = json.loads((package / "cameras.json").read_text())["cameras"]
    mosaic = manifest["mosaic"]
    expected = {
        "cam_tl": {"x": 0, "y": 0, "width": 479, "height": 300},
        "cam_tr": {"x": 481, "y": 0, "width": 479, "height": 300},
        "cam_bl": {"x": 0, "y": 304, "width": 479, "height": 300},
        "cam_br": {"x": 481, "y": 304, "width": 479, "height": 300},
    }
    seen = {}
    covered = set()
    for camera in cameras:
        crop = camera["mosaic_crop"]
        seen[camera["id"]] = crop
        assert camera["static"] is True
        pixels = {
            (x, y)
            for y in range(crop["y"], crop["y"] + crop["height"])
            for x in range(crop["x"], crop["x"] + crop["width"])
        }
        assert pixels.isdisjoint(_gutter_pixels(mosaic))
        assert pixels.isdisjoint(covered)
        covered |= pixels
        forward = camera_forward(tuple(camera["extrinsics"]["quaternion"]))
        assert forward[1] < 0
        if camera["id"] in {"cam_tl", "cam_bl"}:
            assert forward[0] < 0
        else:
            assert forward[0] > 0
    assert seen == expected
    assert covered == _view_pixels()


def test_events_reference_visible_vehicles(package):
    data = _load(package)
    tracks = {track["entity_id"]: track for track in data["tracks"]["tracks"]}
    for event in data["events"]["events"]:
        assert event["type"] in {"impact", "lane_change", "pass", "brake", "rest"}
        for vehicle in event["vehicles"]:
            track = tracks[vehicle]
            assert track["visibility"]["t_start"] - 1e-6 <= event["t"] <= track["visibility"]["t_end"] + 1e-6
        if event["type"] == "pass":
            assert len(event["vehicles"]) == 2
            assert tracks[event["vehicles"][0]]["carriageway"] == tracks[event["vehicles"][1]]["carriageway"]
        if event["type"] == "impact":
            assert len(event["vehicles"]) == 2
            assert tracks[event["vehicles"][0]]["carriageway"] == tracks[event["vehicles"][1]]["carriageway"]


def _gutter_pixels(mosaic: dict) -> set[tuple[int, int]]:
    width = mosaic["width"]
    height = mosaic["height"]
    col0, col1 = mosaic["column_gutter_x"]
    row0, row1 = mosaic["row_gutter_y"]
    letter0, letter1 = mosaic["letterbox_y"]
    pixels = {(x, y) for x in range(col0, col1 + 1) for y in range(height)}
    pixels |= {(x, y) for y in range(row0, row1 + 1) for x in range(width)}
    pixels |= {(x, y) for y in range(letter0, letter1 + 1) for x in range(width)}
    return pixels


def _view_pixels() -> set[tuple[int, int]]:
    rects = (
        (0, 0, 479, 300),
        (481, 0, 479, 300),
        (0, 304, 479, 300),
        (481, 304, 479, 300),
    )
    return {
        (x, y)
        for left, top, width, height in rects
        for y in range(top, top + height)
        for x in range(left, left + width)
    }
