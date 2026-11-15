import math

import numpy as np
import pytest

from reconstruct.errors import StepNotRun
from reconstruct.geometry import quadrant_crops
from reconstruct.models import Sample, Sigma, Track, Visibility
from reconstruct.steps.associate import associate
from reconstruct.steps.attributes import resolve_entities
from reconstruct.steps.boxes import detect_boxes
from reconstruct.steps.detect_track import link_tracks
from reconstruct.steps.kinematics import detect_impacts, incident_onset_s, kalman_rts
from reconstruct.steps.scale import scale_from_lane_width
from reconstruct.steps.segment import segment

SIGMA = Sigma(pos_m=0.5, speed_mps=0.75)


def test_smoother_keeps_constant_velocity():
    times = np.arange(40) * 0.08
    measured = 10.0 + 28.0 * times
    state = kalman_rts(times, measured)
    assert state[:, 0] == pytest.approx(measured, abs=1e-3)
    assert state[:, 1] == pytest.approx(28.0, abs=1e-2)
    assert state[:, 2] == pytest.approx(0.0, abs=1e-2)


def test_impact_detector_fires_for_a_closing_pair_and_not_for_opposing_lanes():
    # Stay close after contact (crash / locked together), not a clearing overtake.
    closing = detect_impacts(
        [
            _track("a", "b", [(0.0, 0.0), (0.5, 4.0), (1.0, 8.0), (1.5, 9.0), (2.0, 9.2), (2.5, 9.3)]),
            _track(
                "b",
                "b",
                [(0.0, 14.0), (0.5, 11.0), (1.0, 9.2), (1.5, 9.0), (2.0, 8.9), (2.5, 8.8)],
                speeds=[10, 8, 4, 1.5, 0.8, 0.4],
            ),
        ],
        separation_m=2.5,
        min_closing_mps=0.3,
    )
    assert len(closing) == 1
    assert closing[0].vehicles == ("a", "b")
    assert closing[0].t == pytest.approx(1.0)

    opposing = detect_impacts(
        [
            _track("a", "a", [(0.0, 0.0), (0.5, 5.0), (1.0, 10.0)], z=3.5),
            _track("b", "b", [(0.0, 0.0), (0.5, 5.0), (1.0, 10.0)], z=-3.5),
        ],
        separation_m=2.5,
        min_closing_mps=0.3,
    )
    assert opposing == []


def test_impact_detector_ignores_a_clearing_overtake():
    overtake = detect_impacts(
        [
            _track("a", "b", [(0.0, 0.0), (0.5, 5.0), (1.0, 10.0), (1.5, 15.0), (2.0, 20.0)]),
            _track("b", "b", [(0.0, 12.0), (0.5, 10.0), (1.0, 9.0), (1.5, 12.0), (2.0, 16.0)]),
        ],
        separation_m=2.5,
        min_closing_mps=0.3,
    )
    assert overtake == []


def test_demo_package_detects_the_accident(package):
    import json

    from reconstruct.models import TracksFile

    manifest = json.loads((package / "manifest.json").read_text())
    tracks = TracksFile.model_validate(json.loads((package / "tracks.json").read_text()))
    events = json.loads((package / "events.json").read_text())["events"]
    impacts = [event for event in events if event["type"] == "impact"]
    assert impacts
    assert manifest["impact_time_s"] == pytest.approx(min(event["t"] for event in impacts))
    assert 18.0 <= manifest["impact_time_s"] <= 26.0
    onset = incident_onset_s(tracks.tracks)
    assert onset is not None
    assert 18.0 <= onset <= 26.0
    assert detect_impacts(tracks.tracks, separation_m=2.5, min_closing_mps=0.3)
    assert any(event["type"] in {"brake", "rest"} for event in events)


def test_overrides_replace_model_labels():
    entities = resolve_entities(
        [
            {
                "id": "v1",
                "type": "car",
                "label": "red car",
                "color": "red",
                "color_hex": "#C62828",
                "carriageway": "b",
                "confidence": 0.4,
                "label_source": "vlm",
                "make": "Toyota",
                "model": "Camry",
                "score": 0.99,
            }
        ],
        {
            "v1": {
                "label": "white van",
                "color": "white",
                "color_hex": "#F4F4F4",
                "type": "van",
                "make": None,
                "model": None,
                "label_source": "manual",
            }
        },
        {"van": {"length": 5.3, "width": 2.0, "height": 2.2}},
    )
    entity = entities[0]
    assert entity.type == "van"
    assert entity.color == "white"
    assert entity.make is None
    assert entity.model is None
    assert entity.label_source == "manual"
    assert entity.splat == "vehicles/van.ply"
    assert entity.confidence == pytest.approx(0.4)


def test_type_must_be_car_van_or_truck():
    with pytest.raises(ValueError, match="car, van, or truck"):
        resolve_entities(
            [{"id": "v9", "type": "bus", "label": "bus", "color": "red", "color_hex": "#FF0000"}],
            {},
            {},
        )


def test_scale_uses_lane_width():
    metric = scale_from_lane_width(3.5)
    assert metric.meters_per_unit == 1.0
    assert metric.lane_width_m == 3.5
    measured = scale_from_lane_width(3.5, lane_width_px=70)
    assert measured.meters_per_pixel == pytest.approx(0.05)


def test_a_cyan_wireframe_is_a_car_box():
    image = np.zeros((80, 120, 3), dtype=np.uint8)
    image[20:56, 30:78] = (0, 229, 255)
    image[23:53, 33:75] = (180, 30, 30)
    boxes = detect_boxes(image)
    cars = [box for box in boxes if box.type == "car"]
    assert len(cars) == 1
    assert cars[0].paint_rgb[0] > cars[0].paint_rgb[2]
    tracks = link_tracks("cam_br", [(0.0, cars), (0.08, cars)])
    assert len(tracks) == 1
    assert tracks[0].type == "car"


def test_associate_empty_is_empty():
    assert associate([], carriageway="a") == []


def test_sam_is_not_run_on_the_burned_in_mosaic():
    with pytest.raises(StepNotRun):
        segment([], [])


def test_quadrant_crops_skip_the_gutters():
    crops = quadrant_crops(960, 610, (479, 480), (300, 303), (604, 609))
    assert crops["cam_tl"].model_dump() == {"x": 0, "y": 0, "width": 479, "height": 300}
    assert crops["cam_tr"].x == 481
    assert crops["cam_bl"].y == 304
    assert crops["cam_br"].x == 481 and crops["cam_br"].y == 304
    for crop in crops.values():
        assert crop.x + crop.width - 1 < 479 or crop.x > 480
        assert crop.y + crop.height - 1 < 300 or crop.y > 303
        assert crop.y + crop.height - 1 < 604


def _track(
    entity_id: str,
    carriageway: str,
    points: list[tuple[float, float]],
    z: float = -3.5,
    speeds: list[float] | None = None,
) -> Track:
    samples = []
    for index, (t, x) in enumerate(points):
        if index == 0:
            vx = (points[1][1] - x) / (points[1][0] - t)
        else:
            prev_t, prev_x = points[index - 1]
            vx = (x - prev_x) / (t - prev_t)
        speed = abs(vx) if speeds is None else float(speeds[index])
        samples.append(
            Sample(
                t=t,
                pos=(x, 1.0, z),
                quat=(0.0, 0.0, 0.0, 1.0),
                vel=(vx, 0.0, 0.0),
                acc=(0.0, 0.0, 0.0),
                speed_mps=speed,
                heading_deg=0.0 if vx >= 0 else 180.0,
                yaw_rate=0.0,
                sigma=SIGMA,
            )
        )
    return Track(
        entity_id=entity_id,
        carriageway=carriageway,  # type: ignore[arg-type]
        visibility=Visibility(t_start=points[0][0], t_end=points[-1][0]),
        samples=samples,
    )


def _minimum_separation(tracks: list[Track]) -> float:
    best = math.inf
    for index, left in enumerate(tracks):
        left_at = {sample.t: sample.pos for sample in left.samples}
        for right in tracks[index + 1 :]:
            for sample in right.samples:
                if sample.t in left_at:
                    best = min(best, math.dist(left_at[sample.t], sample.pos))
    return best
