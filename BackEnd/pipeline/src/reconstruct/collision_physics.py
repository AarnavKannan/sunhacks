"""Point-mass collision response and post-impact ground-plane motion."""

from __future__ import annotations

import math

import numpy as np
import sympy as sp

_mass_1, _mass_2, _e, _u_1, _u_2, _v_1, _v_2 = sp.symbols(
    "mass_1 mass_2 restitution u_1 u_2 v_1 v_2",
    real=True,
)
_POST_NORMAL_SPEEDS = sp.solve(
    (
        _mass_1 * _u_1 + _mass_2 * _u_2 - _mass_1 * _v_1 - _mass_2 * _v_2,
        _v_2 - _v_1 + _e * (_u_2 - _u_1),
    ),
    (_v_1, _v_2),
    dict=True,
)[0]


def resolve_collision(
    mass_1_kg: float,
    mass_2_kg: float,
    velocity_1_mps: tuple[float, float],
    velocity_2_mps: tuple[float, float],
    normal_1_to_2: tuple[float, float],
    *,
    restitution: float,
) -> tuple[tuple[float, float], tuple[float, float]]:
    """Solve a frictionless 2D point-contact collision.

    The normal points from vehicle 1 to vehicle 2. Tangential velocity is
    unchanged; the normal components satisfy momentum conservation and
    Newton's coefficient-of-restitution equation.
    """
    if not math.isfinite(mass_1_kg) or mass_1_kg <= 0:
        raise ValueError("mass_1_kg must be finite and positive")
    if not math.isfinite(mass_2_kg) or mass_2_kg <= 0:
        raise ValueError("mass_2_kg must be finite and positive")
    if not math.isfinite(restitution) or not 0 <= restitution <= 1:
        raise ValueError("restitution must be between 0 and 1")

    velocity_1 = np.asarray(velocity_1_mps, dtype=float)
    velocity_2 = np.asarray(velocity_2_mps, dtype=float)
    normal = np.asarray(normal_1_to_2, dtype=float)
    if velocity_1.shape != (2,) or velocity_2.shape != (2,) or normal.shape != (2,):
        raise ValueError("velocities and collision normal must be 2D vectors")
    if not np.all(np.isfinite(velocity_1)) or not np.all(np.isfinite(velocity_2)):
        raise ValueError("velocities must be finite")
    if not np.all(np.isfinite(normal)):
        raise ValueError("collision normal must be finite")

    normal_length = float(np.linalg.norm(normal))
    if normal_length <= 1e-12:
        raise ValueError("collision normal must be non-zero")
    normal /= normal_length
    speed_1_normal = float(np.dot(velocity_1, normal))
    speed_2_normal = float(np.dot(velocity_2, normal))
    if speed_2_normal - speed_1_normal >= -1e-9:
        raise ValueError("vehicles must be closing along the collision normal")

    substitutions = {
        _mass_1: mass_1_kg,
        _mass_2: mass_2_kg,
        _e: restitution,
        _u_1: speed_1_normal,
        _u_2: speed_2_normal,
    }
    post_1_normal = float(_POST_NORMAL_SPEEDS[_v_1].subs(substitutions))
    post_2_normal = float(_POST_NORMAL_SPEEDS[_v_2].subs(substitutions))
    post_1 = velocity_1 + (post_1_normal - speed_1_normal) * normal
    post_2 = velocity_2 + (post_2_normal - speed_2_normal) * normal

    momentum_before = mass_1_kg * velocity_1 + mass_2_kg * velocity_2
    momentum_after = mass_1_kg * post_1 + mass_2_kg * post_2
    if not np.allclose(momentum_before, momentum_after, rtol=1e-10, atol=1e-10):
        raise ArithmeticError("collision response did not conserve momentum")
    normal_restitution = float(np.dot(post_2 - post_1, normal))
    if not math.isclose(
        normal_restitution,
        -restitution * (speed_2_normal - speed_1_normal),
        rel_tol=1e-10,
        abs_tol=1e-10,
    ):
        raise ArithmeticError("collision response violated the restitution equation")
    return tuple(float(value) for value in post_1), tuple(float(value) for value in post_2)


def post_impact_samples(
    position_m: tuple[float, float],
    velocity_mps: tuple[float, float],
    duration_s: float,
    *,
    friction_coefficient: float,
    sample_rate_hz: float = 60.0,
    gravity_mps2: float = 9.81,
) -> np.ndarray:
    """Sample constant-deceleration Coulomb friction until the vehicle stops.

    Each returned row is ``(seconds_since_impact, x_m, z_m)``. Once stopped,
    the vehicle remains at its stopping position.
    """
    position = np.asarray(position_m, dtype=float)
    velocity = np.asarray(velocity_mps, dtype=float)
    if position.shape != (2,) or velocity.shape != (2,):
        raise ValueError("position and velocity must be 2D vectors")
    if not np.all(np.isfinite(position)) or not np.all(np.isfinite(velocity)):
        raise ValueError("position and velocity must be finite")
    if not math.isfinite(duration_s) or duration_s < 0:
        raise ValueError("duration_s must be finite and non-negative")
    if not math.isfinite(friction_coefficient) or friction_coefficient < 0:
        raise ValueError("friction_coefficient must be finite and non-negative")
    if not math.isfinite(sample_rate_hz) or sample_rate_hz <= 0:
        raise ValueError("sample_rate_hz must be finite and positive")
    if not math.isfinite(gravity_mps2) or gravity_mps2 <= 0:
        raise ValueError("gravity_mps2 must be finite and positive")

    interval = 1.0 / sample_rate_hz
    initial_speed = float(np.linalg.norm(velocity))
    deceleration = friction_coefficient * gravity_mps2
    if initial_speed <= 1e-12:
        times = np.array([0.0, duration_s]) if duration_s > 0 else np.array([0.0])
        distances = np.zeros_like(times)
    elif deceleration == 0:
        times = np.arange(0.0, duration_s, interval)
        times = np.append(times, duration_s)
        distances = times * initial_speed
    else:
        moving_end = min(duration_s, initial_speed / deceleration)
        times = np.arange(0.0, moving_end, interval)
        times = np.append(times, moving_end)
        if moving_end < duration_s:
            times = np.append(times, duration_s)
        moving_time = np.minimum(times, initial_speed / deceleration)
        distances = initial_speed * moving_time - 0.5 * deceleration * moving_time**2

    direction = np.zeros(2) if initial_speed <= 1e-12 else velocity / initial_speed
    positions = position + distances[:, np.newaxis] * direction
    return np.column_stack((times, positions))
