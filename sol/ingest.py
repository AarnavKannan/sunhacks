"""Ingest the 2x2 mosaic clip.

1. Hash the source video and record its metadata.
2. Split the mosaic into one frame folder per camera.
3. Build one "empty road" plate per camera (per-pixel median over time). Moving cars and the
   drawn label boxes disappear; the static on-screen logo is patched over.
4. Lay the plates out as a COLMAP-style scene dir (scene/images/*.png) for VGGT and gsplat.

Usage: python ingest.py VIDEO WORK_DIR cam1=w:h:x:y cam2=... [--every N]
"""
import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image

LOGO = (slice(0, 22), slice(0, 24))  # "p)" watermark in each tile's top-left corner
LOGO_FILL = (slice(22, 44), slice(0, 24))  # patch just below it, used to paint over it


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def probe(path: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_frames",
         "-show_entries", "stream=width,height,r_frame_rate,nb_read_frames:format=duration",
         "-of", "json", str(path)],
        check=True, capture_output=True, text=True).stdout
    d = json.loads(out)
    s = d["streams"][0]
    num, den = map(int, s["r_frame_rate"].split("/"))
    return {"width": s["width"], "height": s["height"], "fps": num / den,
            "frames": int(s["nb_read_frames"]), "duration_s": float(d["format"]["duration"])}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("video", type=Path)
    ap.add_argument("work", type=Path)
    ap.add_argument("tiles", nargs="+", help="name=w:h:x:y")
    ap.add_argument("--every", type=int, default=5, help="use every Nth frame for the median plate")
    a = ap.parse_args()

    frames_root = a.work / "frames"
    scene_images = a.work / "scene" / "images"
    scene_images.mkdir(parents=True, exist_ok=True)

    meta = {"source": a.video.name, "sha256": sha256(a.video), **probe(a.video), "cameras": {}}
    print(json.dumps({k: v for k, v in meta.items() if k != "cameras"}, indent=2))

    for spec in a.tiles:
        name, crop = spec.split("=")
        out_dir = frames_root / name
        if out_dir.exists():
            shutil.rmtree(out_dir)
        out_dir.mkdir(parents=True)
        subprocess.run(["ffmpeg", "-v", "error", "-i", str(a.video), "-vf", f"crop={crop}",
                        "-q:v", "2", str(out_dir / "%06d.jpg")], check=True)
        files = sorted(out_dir.glob("*.jpg"))
        stack = np.stack([np.asarray(Image.open(f).convert("RGB")) for f in files[:: a.every]])
        plate = np.median(stack, axis=0).astype(np.uint8)
        plate[LOGO] = plate[LOGO_FILL]
        Image.fromarray(plate).save(scene_images / f"{name}.png")
        meta["cameras"][name] = {"crop_whxy": crop, "frames": len(files),
                                 "plate_from_frames": int(stack.shape[0])}
        print(f"{name}: {len(files)} frames, plate from {stack.shape[0]} frames")

    # gsplat's COLMAP loader always holds out image index 0 for eval. Give it a duplicate of
    # the first camera (sorts first as "0_holdout") so all real cameras are used for training.
    first = a.tiles[0].split("=")[0]
    shutil.copy(scene_images / f"{first}.png", scene_images / "0_holdout.png")

    (a.work / "ingest_meta.json").write_text(json.dumps(meta, indent=2))
    print("ingest done ->", a.work)


if __name__ == "__main__":
    main()
