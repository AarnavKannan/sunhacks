"""Add a duplicate of one camera to a COLMAP model, for gsplat's evaluation holdout.

gsplat's COLMAP loader always holds out image index 0 (sorted by name) for evaluation. To keep all
real cameras in training, ingest writes `0_holdout.png` (a copy of cam1). That copy must NOT be fed
to VGGT: two identical images make VGGT confident only about that view and skew the reconstruction.
So VGGT runs on the real cameras only, and this script then adds the holdout to the model with the
same intrinsics and pose as its source camera.

Usage: python add_holdout.py SPARSE_DIR [SOURCE_IMAGE=cam1.png] [HOLDOUT_NAME=0_holdout.png]
"""
import sys

import pycolmap


def main() -> None:
    sparse = sys.argv[1]
    source = sys.argv[2] if len(sys.argv) > 2 else "cam1.png"
    holdout = sys.argv[3] if len(sys.argv) > 3 else "0_holdout.png"

    rec = pycolmap.Reconstruction(sparse)
    if any(img.name == holdout for img in rec.images.values()):
        print(f"{holdout} already in model; nothing to do")
        return
    src = next(img for img in rec.images.values() if img.name == source)
    cam = rec.cameras[src.camera_id]
    pose = src.cam_from_world() if callable(src.cam_from_world) else src.cam_from_world

    new_cam = pycolmap.Camera(model=cam.model, width=cam.width, height=cam.height,
                              params=cam.params, camera_id=max(rec.cameras) + 1)
    rec.add_camera(new_cam)
    new_id = max(rec.images) + 1
    rec.add_image(pycolmap.Image(name=holdout, camera_id=new_cam.camera_id,
                                 cam_from_world=pose, image_id=new_id))
    rec.register_image(new_id)
    rec.write(sparse)
    print(f"added {holdout} as a copy of {source}: {len(rec.images)} images, {len(rec.points3D)} points")


if __name__ == "__main__":
    main()
