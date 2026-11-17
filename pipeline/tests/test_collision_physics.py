import math

import numpy as np
import pytest

from reconstruct.collision_export import SCENARIOS, build_builtin_trajectories
from reconstruct.collision_physics import post_impact_samples, resolve_collision


def test_collision_conserves_vector_momentum_and_applies_restitution():
    mass_1, mass_2 = 1600.0, 2000.0
    velocity_1 = np.array([3.5, 0.4])
    velocity_2 = np.array([-3.5, -0.2])
    normal = np.array([1.0, 0.0])

    post_1, post_2 = resolve_collision(
        mass_1,
        mass_2,
        tuple(velocity_1),
        tuple(velocity_2),
        tuple(normal),
        restitution=0.15,
    )

    np.testing.assert_allclose(
        mass_1 * velocity_1 + mass_2 * velocity_2,
        mass_1 * np.asarray(post_1) + mass_2 * np.asarray(post_2),
        atol=1e-10,
    )
    assert post_2[0] - post_1[0] == pytest.approx(0.15 * 7.0)
    assert post_1[1] == pytest.approx(velocity_1[1])
    assert post_2[1] == pytest.approx(velocity_2[1])


def test_collision_rejects_non_closing_vehicles():
    with pytest.raises(ValueError, match="closing"):
        resolve_collision(1500, 2000, (1, 0), (2, 0), (1, 0), restitution=0.15)


def test_post_impact_motion_stops_under_dry_asphalt_friction():
    samples = post_impact_samples(
        (0.0, 0.0),
        (10.0, 0.0),
        3.0,
        friction_coefficient=0.75,
        sample_rate_hz=10,
    )
    stop_time = 10 / (0.75 * 9.81)
    stop_distance = 10**2 / (2 * 0.75 * 9.81)
    stop_index = int(np.argmin(np.abs(samples[:, 0] - stop_time)))

    assert samples[-1, 1] == pytest.approx(stop_distance)
    assert samples[-1, 2] == pytest.approx(0)
    assert samples[stop_index, 1] == pytest.approx(stop_distance, abs=0.02)
    assert math.isfinite(float(samples[-1, 0]))


def test_builtin_collision_trajectories_match_proxy_impact_states():
    trajectories = build_builtin_trajectories()
    assert set(trajectories["scenes"]) == {"roundabout", "apache"}
    for scene_id, scene in trajectories["scenes"].items():
        scenario = SCENARIOS[scene_id]
        assert scene["impact_time_s"] == scenario["impact_time_s"]
        for vehicle_id, vehicle in scene["vehicles"].items():
            samples = np.asarray(vehicle["samples"])
            initial = scenario["vehicles"][vehicle_id]
            assert samples[0, 0] == pytest.approx(0)
            np.testing.assert_allclose(samples[0, 1:], initial["position_m"], atol=1e-6)
            assert samples[-1, 0] == pytest.approx(scenario["duration_s"] - scene["impact_time_s"])
            np.testing.assert_allclose(samples[-1, 1:], samples[-2, 1:], atol=1e-6)
            assert np.all(np.diff(samples[:, 0]) > 0)
            assert np.all(np.isfinite(samples))


def test_collision_vehicles_approach_at_about_20_meters_per_second():
    for scene in SCENARIOS.values():
        for vehicle in scene["vehicles"].values():
            assert np.linalg.norm(vehicle["velocity_mps"]) == pytest.approx(20.0, abs=0.01)


def test_apache_corner_collision_recoils_and_deflects_both_vehicles():
    scenario = SCENARIOS["apache"]
    silver, blue = scenario["vehicles"].values()
    post_silver, post_blue = resolve_collision(
        silver["mass_kg"],
        blue["mass_kg"],
        silver["velocity_mps"],
        blue["velocity_mps"],
        scenario["collision_normal_1_to_2"],
        restitution=0.15,
    )

    assert post_silver[0] < 0
    assert post_blue[0] > -5
    assert post_silver[1] > 0
    assert post_blue[1] < 0
    assert silver["yaw_change_rad"] > 0
    assert blue["yaw_change_rad"] > 0

    trajectories = build_builtin_trajectories()["scenes"]["apache"]["vehicles"]
    for vehicle_id, vehicle in scenario["vehicles"].items():
        np.testing.assert_allclose(
            np.asarray(trajectories[vehicle_id]["samples"])[0, 1:],
            vehicle["position_m"],
            atol=1e-6,
        )
        assert trajectories[vehicle_id]["yaw_change_rad"] == pytest.approx(0.35)
