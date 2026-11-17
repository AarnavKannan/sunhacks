"""Locate the repository root from an editable checkout or the working directory."""

from __future__ import annotations

from pathlib import Path


def repo_root() -> Path:
    starts = [Path(__file__).resolve(), Path.cwd().resolve()]
    seen: set[Path] = set()
    for start in starts:
        for candidate in [start, *start.parents]:
            if candidate in seen:
                continue
            seen.add(candidate)
            if (candidate / "schema" / "manifest.schema.json").is_file() and (
                candidate / "data" / "demo.mp4"
            ).is_file():
                return candidate
    raise FileNotFoundError(
        "Could not find the repository root "
        "(expected schema/manifest.schema.json and data/demo.mp4)."
    )


def default_config() -> Path:
    return repo_root() / "pipeline" / "configs" / "incident-demo.yaml"


def schema_dir() -> Path:
    return repo_root() / "schema"
