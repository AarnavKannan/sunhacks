"""Export Python-computed collision trajectories consumed by the proxy viewer."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import numpy as np

from reconstruct.collision_physics import post_impact_samples, resolve_collision

RESTITUTION = 0.15
DRY_ASPHALT_FRICTION = 0.75
GRAVITY_MPS2 = 9.81
SAMPLE_RATE_HZ = 60.0

# These are the authored layouts' impact-time states, sampled from the incoming
# paths. The current proxy layouts do not provide measured contact geometry, so
# the collision normal is estimated opposite the closing relative velocity.
SCENARIOS: dict[str, dict[str, Any]] = {
    "roundabout": {
        "impact_time_s": 12.0,
        "duration_s": 25.0,
        "vehicles": {
            "white": {
                "mass_kg": 1950.0,
                "position_m": (4.2698672581, -1.1768422216),
                "velocity_mps": (-0.8259442654, -2.6701762245),
                "yaw_rad": -2.8415926536,
            },
            "red": {
                "mass_kg": 1500.0,
                "position_m": (7.1698672581, -0.9768422216),
                "velocity_mps": (-0.4787738484, 0.0028941354),
                "yaw_rad": -1.5668173256,
            },
        },
    },
    "apache": {
        "impact_time_s": 8.0,
        "duration_s": 16.0,
        "vehicles": {
            "silver": {
                "mass_kg": 1600.0,
                "position_m": (0.0, 0.6264),
                "velocity_mps": (3.5, 0.0),
                "yaw_rad": math.pi / 2,
            },
            "blue": {
                "mass_kg": 2000.0,
                "position_m": (0.0, -2.0264),
                "velocity_mps": (-3.5, 0.0),
                "yaw_rad": -math.pi / 2,
            },
        },
    },
}

DEFAULT_OUTPUT = (
    Path(__file__).resolve().parents[4]
    / "FrontEnd"
    / "app"
    / "src"
    / "data"
    / "impactTrajectories.json"
)


def _scene_trajectories(scenario: dict[str, Any]) -> dict[str, Any]:
    vehicles = scenario["vehicles"]
    first, second = vehicles.values()
    relative_velocity = np.asarray(second["velocity_mps"]) - np.asarray(first["velocity_mps"])
    closing_speed = float(np.linalg.norm(relative_velocity))
    if closing_speed <= 1e-9:
        raise ValueError("collision participants must have non-zero relative velocity")
    normal = -relative_velocity / closing_speed

    post_velocities = resolve_collision(
        first["mass_kg"],
        second["mass_kg"],
        tuple(first["velocity_mps"]),
        tuple(second["velocity_mps"]),
        tuple(normal),
        restitution=RESTITUTION,
    )
    result: dict[str, Any] = {
        "impact_time_s": scenario["impact_time_s"],
        "vehicles": {},
    }
    for (vehicle_id, vehicle), velocity in zip(vehicles.items(), post_velocities, strict=True):
        samples = post_impact_samples(
            tuple(vehicle["position_m"]),
            velocity,
            scenario["duration_s"] - scenario["impact_time_s"],
            friction_coefficient=DRY_ASPHALT_FRICTION,
            sample_rate_hz=SAMPLE_RATE_HZ,
            gravity_mps2=GRAVITY_MPS2,
        )
        result["vehicles"][vehicle_id] = {
            "yaw_rad": vehicle["yaw_rad"],
            "samples": np.round(samples, 6).tolist(),
        }
    return result


def build_builtin_trajectories() -> dict[str, Any]:
    return {
        "model": {
            "description": "2D point-mass impulse followed by dry-asphalt Coulomb friction",
            "restitution": RESTITUTION,
            "friction_coefficient": DRY_ASPHALT_FRICTION,
            "gravity_mps2": GRAVITY_MPS2,
            "sample_rate_hz": SAMPLE_RATE_HZ,
        },
        "scenes": {
            scene_id: _scene_trajectories(scenario)
            for scene_id, scenario in SCENARIOS.items()
        },
    }


def export_builtin_trajectories(output: Path = DEFAULT_OUTPUT) -> Path:
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(build_builtin_trajectories(), indent=2) + "\n")
    return output


def main() -> None:
    print(f"Wrote collision trajectories to {export_builtin_trajectories()}")


if __name__ == "__main__":
    main()
