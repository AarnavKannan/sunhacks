"""Bottom-right (crash) camera. Pinhole, principal point at tile centre (239.5, 150).
World W: X along road away from camera, Y to camera's right (Y=0 = right-carriageway line A), Z up; camera at (0, cy0, h).
Params from data/calib_joint.json (calib.py: joint fit of dash ends + all painted lines + van 3D box with W=2.05 m)."""
import json, os, numpy as np
CX, CY = 239.5, 150.0
_J = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "calib_joint.json")))
P = _J["params"]
def rot(yaw, pitch, roll):
    cy, sy, cp, sp, cr, sr = np.cos(yaw), np.sin(yaw), np.cos(pitch), np.sin(pitch), np.cos(roll), np.sin(roll)
    Ry = np.array([[cy, -sy, 0], [sy, cy, 0], [0, 0, 1]])
    base = np.array([[0, 1, 0], [0, 0, -1], [1, 0, 0]])
    Rx = np.array([[1, 0, 0], [0, cp, -sp], [0, sp, cp]])
    Rz = np.array([[cr, -sr, 0], [sr, cr, 0], [0, 0, 1]])
    return Rz @ Rx @ base @ Ry
f, h, yaw, pitch, roll, cy0, phase = P
R = rot(yaw, pitch, roll)
LINES = _J["lines"]          # painted-line Y positions (m), see data/br_camera.json for the full road description
def to_img(X, Y, Z=0.0):
    X = np.atleast_1d(np.asarray(X, dtype=float))
    W = np.stack([X, np.atleast_1d(Y) - cy0 + 0 * X, np.atleast_1d(Z) - h + 0 * X], 1)
    C = W @ R.T
    return f * C[:, 0] / C[:, 2] + CX, f * C[:, 1] / C[:, 2] + CY
def to_ground(u, v, Z=0.0):
    """Pixel -> point on the horizontal plane at height Z (default road surface)."""
    u = np.atleast_1d(np.asarray(u, dtype=float))
    d = np.stack([(u - CX) / f, (np.atleast_1d(v) - CY) / f + 0 * u, np.ones_like(u)], 1)
    w = d @ R   # camera ray in world (R orthonormal: world = R^T cam)
    t = (h - Z) / -w[:, 2]
    return w[:, 0] * t, w[:, 1] * t + cy0
