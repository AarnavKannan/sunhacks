"""Decode the mosaic once. The four views already share this clock."""

from __future__ import annotations

import subprocess
from collections.abc import Iterator
from pathlib import Path

import numpy as np


def iter_rgb_frames(path: Path, width: int, height: int) -> Iterator[tuple[int, np.ndarray]]:
    """Yield ``(index, rgb)``. The array is only valid until the next frame."""
    frame_bytes = width * height * 3
    process = subprocess.Popen(
        [
            "ffmpeg",
            "-v",
            "error",
            "-i",
            str(path),
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-",
        ],
        stdout=subprocess.PIPE,
    )
    assert process.stdout is not None
    index = 0
    try:
        while True:
            buffer = process.stdout.read(frame_bytes)
            if len(buffer) < frame_bytes:
                break
            yield index, np.frombuffer(buffer, dtype=np.uint8).reshape(height, width, 3)
            index += 1
    finally:
        process.stdout.close()
        code = process.wait()
    if code != 0:
        raise RuntimeError(f"ffmpeg exited {code} while decoding {path}")
    if index == 0:
        raise RuntimeError(f"ffmpeg produced no frames from {path}")
