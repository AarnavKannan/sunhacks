"""Sanity-check a VGGT/COLMAP reconstruction before training a splat on it.

Prints, per camera: centre, view direction, how many 3D points came from it, and what fraction of
ALL points reproject inside its image. Saves two pictures into OUT_DIR:
  vggt_reprojection.jpg  each camera's image next to the point cloud reprojected into it
  vggt_topdown.png       top-down map of camera positions/directions and the points

A usable multi-camera scene has points coming from every camera, and each camera's reprojection
covering a large, sensible part of its image. If points come from only one camera, the cameras did
not get registered into one shared 3D scene, and a splat trained on it will be poor.

Usage: python diagnose_poses.py SCENE_DIR OUT_DIR   (SCENE_DIR contains images/ and sparse/)
"""
import sys
from pathlib import Path

import numpy as np
import pycolmap
from PIL import Image, ImageDraw


def main() -> None:
    scene, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    rec = pycolmap.Reconstruction(str(scene / "sparse"))

    ids = np.array(list(rec.points3D.keys()))
    xyz = np.array([rec.points3D[i].xyz for i in ids], dtype=float)
    rgb = np.array([rec.points3D[i].color for i in ids], dtype=np.uint8)
    from_img = {}
    for pt in rec.points3D.values():
        for el in pt.track.elements:
            from_img[el.image_id] = from_img.get(el.image_id, 0) + 1

    print(f"{len(rec.images)} images, {len(xyz)} points")
    if len(xyz):
        print("point extent min", xyz.min(0).round(3).tolist(), "max", xyz.max(0).round(3).tolist())

    panels, cams = [], []
    for img in sorted(rec.images.values(), key=lambda i: i.name):
        cam = rec.cameras[img.camera_id]
        pose = img.cam_from_world() if callable(img.cam_from_world) else img.cam_from_world
        m = np.asarray(pose.matrix())
        r, t = m[:, :3], m[:, 3]
        centre, fwd = -r.T @ t, r.T @ np.array([0.0, 0.0, 1.0])
        p = xyz @ r.T + t
        pr = [float(x) for x in cam.params]  # PINHOLE: fx fy cx cy; SIMPLE_PINHOLE: f cx cy
        fx, fy, cx, cy = pr[:4] if len(pr) >= 4 else (pr[0], pr[0], pr[1], pr[2])
        z = p[:, 2]
        ok = z > 1e-9
        u = np.where(ok, fx * p[:, 0] / np.where(ok, z, 1) + cx, -1)
        v = np.where(ok, fy * p[:, 1] / np.where(ok, z, 1) + cy, -1)
        inb = ok & (u >= 0) & (u < cam.width) & (v >= 0) & (v < cam.height)
        cover = 0.0
        if inb.any():
            grid = np.zeros((cam.height // 10 + 1, cam.width // 10 + 1), bool)
            grid[(v[inb] // 10).astype(int), (u[inb] // 10).astype(int)] = True
            cover = grid.mean()
        print(f"  {img.name:14s} centre={np.round(centre, 3).tolist()} dir={np.round(fwd, 2).tolist()} "
              f"points_from_this_image={from_img.get(img.image_id, 0):6d} "
              f"points_in_view={inb.mean() * 100 if len(xyz) else 0:5.1f}% image_area_covered={cover * 100:5.1f}%")
        if img.name.startswith("0_"):
            continue
        cams.append((img.name.rsplit(".", 1)[0], centre, fwd))
        base = np.asarray(Image.open(scene / "images" / img.name).convert("RGB"))
        ov = base.copy() // 3
        ov[v[inb].astype(int), u[inb].astype(int)] = rgb[inb]
        pan = Image.fromarray(np.hstack([base, ov]))
        ImageDraw.Draw(pan).text((6, 6), f"{img.name}: right = all points reprojected "
                                 f"({cover * 100:.0f}% of image covered)", fill=(255, 255, 0))
        panels.append(pan)

    if panels:
        sheet = Image.new("RGB", (max(p.width for p in panels), sum(p.height for p in panels)))
        y = 0
        for pan in panels:
            sheet.paste(pan, (0, y))
            y += pan.height
        sheet.save(out / "vggt_reprojection.jpg", quality=85)

    # Top-down map: x horizontal, z vertical (COLMAP world axes; VGGT's frame is arbitrary).
    size, pad = 600, 60
    xs = np.r_[xyz[:, 0] if len(xyz) else [], [c[1][0] for c in cams]]
    zs = np.r_[xyz[:, 2] if len(xyz) else [], [c[1][2] for c in cams]]
    span = max(xs.max() - xs.min(), zs.max() - zs.min(), 1e-9)

    def to_px(x, z):
        return pad + (x - xs.min()) / span * (size - 2 * pad), pad + (z - zs.min()) / span * (size - 2 * pad)

    im = Image.new("RGB", (size, size), (20, 20, 24))
    d = ImageDraw.Draw(im)
    step = max(1, len(xyz) // 5000)
    for (x, _, z), c in zip(xyz[::step], rgb[::step]):
        d.point(to_px(x, z), fill=tuple(int(k) for k in c))
    for name, c, f in cams:
        x0, z0 = to_px(c[0], c[2])
        x1, z1 = to_px(c[0] + f[0] * span * 0.15, c[2] + f[2] * span * 0.15)
        d.line((x0, z0, x1, z1), fill=(255, 90, 40), width=3)
        d.ellipse((x0 - 5, z0 - 5, x0 + 5, z0 + 5), fill=(255, 90, 40))
        d.text((x0 + 8, z0 - 6), name, fill=(255, 255, 255))
    d.text((8, 8), "Top-down (x vs z): cameras (orange, line = view direction) and points", fill=(255, 255, 0))
    im.save(out / "vggt_topdown.png")
    print("saved", out / "vggt_reprojection.jpg", "and", out / "vggt_topdown.png")


if __name__ == "__main__":
    main()
