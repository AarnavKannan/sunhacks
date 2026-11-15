"""Convert VGGT's COLMAP output into cameras.json for the scene package.

Usage: python export_cameras.py SPARSE_DIR OUT_JSON
"""
import json
import sys

import numpy as np
import pycolmap


def main() -> None:
    sparse_dir, out_path = sys.argv[1], sys.argv[2]
    rec = pycolmap.Reconstruction(sparse_dir)
    cams = []
    for img in sorted(rec.images.values(), key=lambda i: i.name):
        if img.name.startswith("0_holdout"):
            continue
        cam = rec.cameras[img.camera_id]
        pose = img.cam_from_world() if callable(img.cam_from_world) else img.cam_from_world
        m = np.asarray(pose.matrix())  # 3x4 [R|t], world -> camera
        r, t = m[:, :3], m[:, 3]
        model = getattr(cam, "model_name", None) or cam.model.name
        cams.append({
            "id": img.name.rsplit(".", 1)[0],
            "width": int(cam.width),
            "height": int(cam.height),
            "model": model,
            "params": [float(p) for p in cam.params],
            "R_cam_from_world": r.tolist(),
            "t_cam_from_world": t.tolist(),
            "center_world": (-r.T @ t).tolist(),
            "static": True,
        })
    out = {
        "convention": "COLMAP/OpenCV camera axes (x right, y down, z forward). World frame and "
                      "scale come from VGGT and are arbitrary: not yet metric, not yet Y-up.",
        "num_points3d": len(rec.points3D),
        "cameras": cams,
    }
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2)
    print(f"wrote {len(cams)} cameras, {len(rec.points3D)} points -> {out_path}")
    for c in cams:
        print(f"  {c['id']}: center={np.round(c['center_world'], 3).tolist()} f={c['params'][0]:.1f}")


if __name__ == "__main__":
    main()
