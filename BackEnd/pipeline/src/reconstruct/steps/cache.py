"""JSON cache files for pipeline steps."""

from __future__ import annotations

import json
from pathlib import Path


def write_step_cache(cache_dir: Path, step: str, payload: dict) -> Path:
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"{step}.json"
    path.write_text(json.dumps(payload, indent=2) + "\n")
    return path
