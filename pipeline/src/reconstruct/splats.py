"""Small colored Gaussian blobs in the 3DGS binary PLY layout.

Gaussian rotation in the file is the 3DGS order rot_0..3 = (w, x, y, z).
Vehicle and camera poses elsewhere in the package are [x, y, z, w].
"""

from __future__ import annotations

import math
import struct
from dataclasses import dataclass
from pathlib import Path

SH_C0 = 0.28209479177387814


@dataclass(frozen=True)
class Gaussian:
    x: float
    y: float
    z: float
    rgb: tuple[float, float, float]
    opacity: float
    scale: tuple[float, float, float]


def write_ply(path: Path, gaussians: list[Gaussian]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    header = (
        "ply\n"
        "format binary_little_endian 1.0\n"
        f"element vertex {len(gaussians)}\n"
        "property float x\n"
        "property float y\n"
        "property float z\n"
        "property float nx\n"
        "property float ny\n"
        "property float nz\n"
        "property float f_dc_0\n"
        "property float f_dc_1\n"
        "property float f_dc_2\n"
        "property float opacity\n"
        "property float scale_0\n"
        "property float scale_1\n"
        "property float scale_2\n"
        "property float rot_0\n"
        "property float rot_1\n"
        "property float rot_2\n"
        "property float rot_3\n"
        "end_header\n"
    )
    body = bytearray()
    for gaussian in gaussians:
        dc = tuple((channel - 0.5) / SH_C0 for channel in gaussian.rgb)
        opacity = math.log(gaussian.opacity / (1.0 - gaussian.opacity))
        scale = tuple(math.log(axis) for axis in gaussian.scale)
        body += struct.pack(
            "<17f",
            gaussian.x,
            gaussian.y,
            gaussian.z,
            0.0,
            0.0,
            0.0,
            dc[0],
            dc[1],
            dc[2],
            opacity,
            scale[0],
            scale[1],
            scale[2],
            1.0,
            0.0,
            0.0,
            0.0,
        )
    path.write_bytes(header.encode("ascii") + body)


def highway_gaussians() -> list[Gaussian]:
    """A few hundred Gaussians for two carriageways, a snowy median, and guardrails."""
    blobs: list[Gaussian] = []
    asphalt = (0.25, 0.26, 0.28)
    snow = (0.84, 0.86, 0.88)
    rail = (0.45, 0.48, 0.50)
    for x in range(-80, 81, 8):
        for z in (3.5, 7.0, 10.5, 14.0):
            blobs.append(Gaussian(x, 0.05, z, asphalt, 0.85, (3.2, 0.08, 1.4)))
            blobs.append(Gaussian(x, 0.05, -z, asphalt, 0.85, (3.2, 0.08, 1.4)))
        for z in (-1.0, 0.0, 1.0):
            blobs.append(Gaussian(x, 0.08, z, snow, 0.8, (3.2, 0.1, 0.8)))
        for z in (16.5, 18.5):
            blobs.append(Gaussian(x, 0.12, z, snow, 0.75, (3.2, 0.12, 1.0)))
            blobs.append(Gaussian(x, 0.12, -z, snow, 0.75, (3.2, 0.12, 1.0)))
        blobs.append(Gaussian(x, 0.7, 16.0, rail, 0.9, (0.4, 0.25, 0.15)))
        blobs.append(Gaussian(x, 0.7, -16.0, rail, 0.9, (0.4, 0.25, 0.15)))
    return blobs


def vehicle_gaussians(
    length: float,
    width: float,
    height: float,
    rgb: tuple[float, float, float],
) -> list[Gaussian]:
    """A class blob in the vehicle frame: +X forward, +Y up, origin at the center."""
    blobs: list[Gaussian] = []
    nx, ny, nz = 8, 4, 3
    xs = _linspace(-length / 2, length / 2, nx)
    ys = _linspace(-height / 2, height / 2, ny)
    zs = _linspace(-width / 2, width / 2, nz)
    scale = (length / nx * 0.55, height / ny * 0.55, width / nz * 0.55)
    for iy, y in enumerate(ys):
        shade = 0.75 + 0.25 * (iy / (ny - 1))
        color = tuple(min(1.0, channel * shade) for channel in rgb)
        for x in xs:
            for z in zs:
                blobs.append(Gaussian(x, y, z, color, 0.9, scale))
    return blobs


def hex_to_rgb(value: str) -> tuple[float, float, float]:
    text = value.removeprefix("#")
    return tuple(int(text[index : index + 2], 16) / 255 for index in (0, 2, 4))  # type: ignore[return-value]


def _linspace(start: float, stop: float, count: int) -> list[float]:
    if count == 1:
        return [start]
    step = (stop - start) / (count - 1)
    return [start + index * step for index in range(count)]
