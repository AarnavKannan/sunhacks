"""A6 reprojection reviewer: project every spec vehicle's 3D box into the bottom-right camera tile
and compare against the burned-in dataset boxes (cyan = car, yellow = van, green = truck).

Run with the measure venv:
  python review/reproject.py                       # default: ../incident-spec.json, mapping from build-measured-spec.py
  python review/reproject.py --x0 30 --ymed -5.6   # override the plan -> W mapping
  python review/reproject.py --no-video            # skip the 400-frame MP4

Plan frame (spec.ts): x along road, y LEFT of +x, heading 0 = +x. The crash carriageway drives +x
(toward the camera).  W frame (measure/README.md): X away from camera, Y camera-right, Z up.
Mapping: X = X0 + SX * x, Y = Y0 + SY * y  (SX = -1, SY = +1 for a +x-toward-camera plan).
Outputs land in review/out/.
"""
import argparse, hashlib, json, math, os, re, subprocess, sys
import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
MEASURE = os.path.dirname(HERE)
INCIDENT = os.path.dirname(MEASURE)
REPO = os.path.abspath(os.path.join(INCIDENT, "..", "..", "..", ".."))
sys.path.insert(0, MEASURE)
import cam  # noqa: E402

FPS = 12.5
NF = 400
CROP = (481, 304, 479, 300)
KEY_FRAMES = sorted(set([0, 100, 125, 188, 212, 213, 250, 300, 350, 399] + list(range(270, 301))))
HEIGHT = {"sedan": 1.45, "hatchback": 1.5, "suv": 1.7, "car": 1.5, "van": 2.4, "truck": 3.6, "bus": 3.2,
          "motorcycle": 1.4, "pickup": 1.8}
GT_COLOR = {"cyan": (85, 112), "yellow": (17, 36), "green": (42, 84)}  # OpenCV hue ranges
CAT_GT = {"van": "yellow", "truck": "green", "bus": "green"}  # everything else -> cyan
OUT = os.path.join(HERE, "out")
PXGT = None


# ---------------------------------------------------------------------------------------------
def load_mapping(args):
    """Plan -> W constants. Prefer A5's build-measured-spec.py, else CLI / provisional defaults."""
    m = {"X0": None, "Y0": None, "SX": -1.0, "SY": 1.0, "src": "provisional"}
    # Recover the actual build transform from matching contact observations, never by fitting
    # the rendered van to its old fallback pose. Both files use the same source frame convention.
    spec = json.load(open(args.spec, encoding="utf-8"))
    metadata_path = args.spec + ".build.json"
    if os.path.exists(metadata_path):
        metadata = json.load(open(metadata_path, encoding="utf-8"))
        actual_hash = hashlib.sha256(open(args.spec, "rb").read()).hexdigest()
        if metadata.get("output", {}).get("sha256") != actual_hash:
            raise ValueError("Build metadata does not match this spec; regenerate it before reviewing")
        camera_path = os.path.join(MEASURE, "data", "br_camera.json")
        if metadata.get("synthetic") is False:
            if metadata.get("sources", {}).get("br_camera", {}).get("sha256") != hashlib.sha256(open(camera_path, "rb").read()).hexdigest():
                raise ValueError("Calibration differs from the measured build; regenerate before reviewing")
            camera = json.load(open(camera_path, encoding="utf-8"))["camera"]
            if not np.allclose(camera["R_world_to_cam"], cam.R, atol=1e-12) or not np.allclose(
                    [camera["f_px"], camera["h_m"], camera["cam_Y_m"]], [cam.f, cam.h, cam.cy0], atol=1e-12):
                raise ValueError("cam.py/calib_joint.json disagrees with hashed br_camera.json")
        if all(isinstance(metadata.get(key), (int, float)) and math.isfinite(metadata[key]) for key in ("X_REF", "Y_median")):
            m.update(X0=metadata["X_REF"], Y0=metadata["Y_median"], src="build-metadata", synthetic=metadata.get("synthetic", False))
    cp_path = os.path.join(MEASURE, "data", "crash_pair.json")
    if m["X0"] is None and str(spec.get("prompt_version", "")).startswith("measured") and os.path.exists(cp_path):
        cp = json.load(open(cp_path, encoding="utf-8"))
        world_contact = cp.get("contact")
        if world_contact is None:
            world_contact = next((c for c in cp.get("contacts", []) if c.get("kind") == "vehicle-vehicle"), None)
        if world_contact and world_contact.get("point"):
            plan_contact = next((c for c in (spec.get("crash") or {}).get("contacts", [])
                                 if c.get("a") == world_contact.get("a") and c.get("b") == world_contact.get("b")
                                 and abs(c["t_s"] - world_contact.get("t", world_contact.get("frame", 0) / FPS)) < 1e-5), None)
            if plan_contact:
                m.update(X0=world_contact["point"][0] + plan_contact["x_m"],
                         Y0=world_contact["point"][1] - plan_contact["y_m"], src="measured-contact-transform")
    p = os.path.join(INCIDENT, "build-measured-spec.py")
    if m["X0"] is None and os.path.exists(p):
        src = open(p, encoding="utf-8").read()
        for key, names in {"X0": ["PLAN_X0_W", "W_X0", "X0_W", "PLAN_TO_W_X0", "X0"],
                           "Y0": ["PLAN_Y0_W", "W_Y0", "Y0_W", "PLAN_TO_W_Y0", "Y_MEDIAN_W", "MEDIAN_Y_W", "Y0"],
                           "SX": ["PLAN_SX", "SX"], "SY": ["PLAN_SY", "SY"]}.items():
            for n in names:
                mm = re.search(r"^%s\s*=\s*([-+0-9.eE]+)" % n, src, re.M)
                if mm:
                    m[key] = float(mm.group(1)); m["src"] = "build-measured-spec.py"; break
    if args.x0 is not None: m["X0"], m["src"] = args.x0, "cli"
    if args.ymed is not None: m["Y0"], m["src"] = args.ymed, "cli"
    if args.sx is not None: m["SX"] = args.sx
    if m["X0"] is None or m["Y0"] is None:
        if str(spec.get("prompt_version", "")).startswith("measured"):
            raise ValueError("Measured spec needs its real plan-to-world transform; pass --x0 and --ymed")
        m.update(fit_provisional(args), src="fitted-to-van-f0")
    return m


def plan_to_w(m, x, y):
    return m["X0"] + m["SX"] * np.asarray(x), m["Y0"] + m["SY"] * np.asarray(y)


def heading_to_w(m, hdeg):
    h = np.radians(hdeg)
    return np.arctan2(m["SY"] * np.sin(h), m["SX"] * np.cos(h))


# ---------------------------------------------------------------------------------------------
def interp(obj, t):
    """Linear keyframe interpolation exactly like engine planMotion; None when hidden."""
    k = obj["keyframes"]
    if not k or t < k[0]["t_s"] - 1e-6 or t > k[-1]["t_s"] + 1e-6:
        return None
    i = 0
    while i < len(k) - 2 and t > k[i + 1]["t_s"]:
        i += 1
    a, b = k[i], k[min(i + 1, len(k) - 1)]
    u = 0.0 if a is b or b["t_s"] == a["t_s"] else max(0.0, min(1.0, (t - a["t_s"]) / (b["t_s"] - a["t_s"])))
    dh = (b["heading_deg"] - a["heading_deg"] + 180) % 360 - 180
    sp = (a.get("speed_mps") or 0) + ((b.get("speed_mps") or 0) - (a.get("speed_mps") or 0)) * u
    return (a["x_m"] + (b["x_m"] - a["x_m"]) * u, a["y_m"] + (b["y_m"] - a["y_m"]) * u,
            a["heading_deg"] + dh * u, sp)


def corners_plan(x, y, hdeg, L, W):
    h = math.radians(hdeg); c, s = math.cos(h), math.sin(h)
    out = []
    for dl, dw in ((L / 2, W / 2), (L / 2, -W / 2), (-L / 2, -W / 2), (-L / 2, W / 2)):
        out.append((x + dl * c - dw * s, y + dl * s + dw * c))
    return out


def box_img(m, obj, pose):
    x, y, hd, _ = pose
    H = obj.get("height_m") or HEIGHT.get(obj.get("category"), 1.5)
    cp = corners_plan(x, y, hd, obj["length_m"], obj["width_m"])
    X, Y = plan_to_w(m, [c[0] for c in cp], [c[1] for c in cp])
    X = np.concatenate([X, X]); Y = np.concatenate([Y, Y]); Z = np.array([0.0] * 4 + [H] * 4)
    if np.any(X < 1.0):  # behind / under the camera
        return None
    u, v = cam.to_img(X, Y, Z)
    return np.stack([u, v], 1)


def to_plane(u, v, z0):
    X, Y = cam.to_ground(u, v, z0)
    if not np.isfinite(X[0]) or X[0] < 0:
        return None
    return float(X[0]), float(Y[0])


def px_gt():
    """Optional GT from the tracker (data/tracks_px.json, burned-in 'wire' boxes only): {f: [(col,x0,y0,x1,y1)]}."""
    p = os.path.join(MEASURE, "data", "tracks_px.json")
    if not os.path.exists(p):
        return None
    d = json.load(open(p, encoding="utf-8")); out = {}
    col = {"car": "cyan", "van": "yellow", "truck": "green", "bus": "green"}
    for tr in d["tracks"]:
        for fr in tr["frames"]:
            if fr.get("src") == "wire" and fr.get("bbox"):
                out.setdefault(fr["f"], []).append((col.get(tr.get("class"), "cyan"), *fr["bbox"]))
    return out


# ---------------------------------------------------------------------------------------------
def gt_boxes(tile):
    """Burned-in dataset boxes: thin coloured outlines -> list of (color, x0, y0, x1, y1)."""
    hsv = cv2.cvtColor(tile, cv2.COLOR_BGR2HSV)
    out = []
    for name, (h0, h1) in GT_COLOR.items():
        m = ((hsv[..., 0] >= h0) & (hsv[..., 0] <= h1) & (hsv[..., 1] > (50 if name == "yellow" else 70)) & (hsv[..., 2] > 110)).astype(np.uint8)
        if name == "yellow":  # remove solid yellow paint (the yellow car body); outlines are <= 3 px thick
            filled = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((6, 6), np.uint8))
            m = m & (1 - cv2.dilate(filled, np.ones((3, 3), np.uint8)))
        m = cv2.dilate(m, np.ones((3, 3), np.uint8))
        n, lab, st, _ = cv2.connectedComponentsWithStats(m, 8)
        comps = []
        for i in range(1, n):
            x, y, w, hh, a = st[i]
            if a < 10 or (w < 4 and hh < 4):
                continue
            if w > 8 and hh > 8 and a > 0.6 * w * hh:  # filled blob, not an outline
                continue
            comps.append([int(x), int(y), int(x + w), int(y + hh)])
        # re-join a cuboid outline that compression broke into edge fragments: merge a thin fragment
        # (one straight edge) into the nearest component whose box it touches within 5 px.
        changed = True
        while changed:
            changed = False
            for i, c in enumerate(comps):
                w, hh = c[2] - c[0], c[3] - c[1]
                if not (w < 0.4 * hh or hh < 0.4 * w or max(w, hh) < 10):
                    continue
                best, bd = None, 6
                for j, d in enumerate(comps):
                    if j == i:
                        continue
                    gx = max(0, max(c[0], d[0]) - min(c[2], d[2])); gy = max(0, max(c[1], d[1]) - min(c[3], d[3]))
                    if max(gx, gy) < bd:
                        best, bd = j, max(gx, gy)
                if best is not None:
                    d = comps[best]
                    comps[best] = [min(c[0], d[0]), min(c[1], d[1]), max(c[2], d[2]), max(c[3], d[3])]
                    comps.pop(i); changed = True
                    break
        for c in comps:
            if c[2] - c[0] >= 6 and c[3] - c[1] >= 6:
                out.append((name, *c))
    return out


# ---------------------------------------------------------------------------------------------
def fit_provisional(args):
    """No A5 mapping yet: put the plan van (x=15,y=-2.925) on the frame-0 burned-in yellow box nearest the
    left carriageway, and read Y0 from it.  Rough; replaced as soon as build-measured-spec.py exists."""
    spec = json.load(open(args.spec, encoding="utf-8"))
    van = next(o for o in spec["objects"] if o["id"] == "white-van")
    cap = cv2.VideoCapture(os.path.join(REPO, "demo.mp4")); ok, fr = cap.read()
    x, y, w, h = CROP; tile = fr[y:y + h, x:x + w]
    cands = [b for b in gt_boxes(tile) if b[0] == "yellow" and b[4] > 150 and b[1] < 240]
    b = max(cands, key=lambda b: (b[3] - b[1]) * (b[4] - b[2]))
    # bottom-front centre approx: centre-x of box, bottom-ish
    g = to_plane((b[1] + b[3]) / 2, (b[2] + b[4]) / 2, HEIGHT["van"] / 2)
    k0 = van["keyframes"][0]
    m0 = {"X0": float(g[0] + k0["x_m"]), "Y0": float(g[1] - k0["y_m"]), "SX": -1.0, "SY": 1.0}
    from scipy.optimize import least_squares
    tgt = np.array([(b[1] + b[3]) / 2, (b[2] + b[4]) / 2])
    pose = (k0["x_m"], k0["y_m"], k0["heading_deg"], 0)
    def res(p):
        mm = dict(m0, X0=p[0], Y0=p[1]); pts = box_img(mm, van, pose)
        return (pts.min(0) + pts.max(0)) / 2 - tgt
    r = least_squares(res, [m0["X0"], m0["Y0"]])
    return {"X0": float(r.x[0]), "Y0": float(r.x[1])}


# ---------------------------------------------------------------------------------------------
def color_for(o):
    if o["id"] == "yellow-car": return (0, 0, 255)
    if o["id"] == "white-van": return (255, 0, 255)
    return (255, 255, 255) if o.get("involvement") != "crash" else (0, 128, 255)


EDGES = [(0, 1), (1, 2), (2, 3), (3, 0), (4, 5), (5, 6), (6, 7), (7, 4), (0, 4), (1, 5), (2, 6), (3, 7)]


def draw_box(img, pts, col, s=1, thick=1):
    for a, b in EDGES:
        pa, pb = pts[a] * s, pts[b] * s
        if np.all(np.isfinite(pa)) and np.all(np.isfinite(pb)) and np.abs(pa).max() < 1e4 and np.abs(pb).max() < 1e4:
            cv2.line(img, tuple(int(round(v)) for v in pa), tuple(int(round(v)) for v in pb), col, thick, cv2.LINE_AA)


def main():
    global PXGT, OUT
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", default=os.path.join(INCIDENT, "incident-spec.json"))
    ap.add_argument("--x0", type=float); ap.add_argument("--ymed", type=float); ap.add_argument("--sx", type=float)
    ap.add_argument("--no-video", action="store_true")
    ap.add_argument("--scale", type=int, default=2)
    ap.add_argument("--out", help="Output directory; keeps final measured evidence separate from historical fallback checks")
    ap.add_argument("--gt", choices=["color", "px"], default="color",
                    help="color = own detection of the burned-in outlines (independent); px = data/tracks_px.json wire boxes")
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    spec = json.load(open(args.spec, encoding="utf-8"))
    m = load_mapping(args)
    print("spec:", os.path.basename(args.spec), spec.get("prompt_version"), "| mapping:", m)
    objs = spec["objects"]
    exact_samples = {obj["id"]: {round(k["t_s"] * FPS): k for k in obj["keyframes"]
                     if abs(k["t_s"] * FPS - round(k["t_s"] * FPS)) < 1e-5} for obj in objs}
    S = args.scale
    if args.gt == "px":
        OUT = os.path.join(HERE, "out_px"); os.makedirs(OUT, exist_ok=True)
    if args.out:
        OUT = os.path.abspath(args.out); os.makedirs(OUT, exist_ok=True)
    PXGT = px_gt() if args.gt == "px" else None
    if args.gt == "px" and PXGT is None:
        sys.exit("data/tracks_px.json missing")
    video_path = os.path.join(REPO, "demo_32s.mp4")
    cap = cv2.VideoCapture(video_path)
    cx, cyy, cw, ch = CROP
    vw = None
    if not args.no_video:
        vw = subprocess.Popen(["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s",
                               f"{cw * S * 2}x{ch * S}", "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-pix_fmt",
                               "yuv420p", "-crf", "23", os.path.join(OUT, "overlay.mp4")], stdin=subprocess.PIPE)
    rows = []          # per vehicle per frame
    unmatched_gt = []  # GT boxes with no spec vehicle near them
    for f in range(NF):
        ok, fr = cap.read()
        if not ok:
            break
        t = f / FPS
        tile = fr[cyy:cyy + ch, cx:cx + cw].copy()
        gts = (PXGT.get(f, []) if PXGT is not None else gt_boxes(tile))
        gtc = [((b[1] + b[3]) / 2, (b[2] + b[4]) / 2) for b in gts]
        used = set()
        big = cv2.resize(tile, (cw * S, ch * S), interpolation=cv2.INTER_CUBIC)
        right = (cv2.cvtColor(cv2.cvtColor(big, cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2BGR) * 0.75).astype(np.uint8)
        for o in objs:
            pose = interp(o, t)
            if pose is None:
                continue
            pts = box_img(m, o, pose)
            if pts is None:
                continue
            bx0, by0 = pts.min(0); bx1, by1 = pts.max(0)
            if bx1 < 0 or by1 < 0 or bx0 > cw or by0 > ch:
                continue
            col = color_for(o)
            draw_box(right, pts, col, S, 2 if o.get("involvement") == "crash" else 1)
            draw_box(big, pts, col, S, 1)
            c = ((bx0 + bx1) / 2, (by0 + by1) / 2)
            want = CAT_GT.get(o.get("category"), "cyan")
            inside = 0 <= c[0] < cw and 0 <= c[1] < ch
            best, bd, bcol = None, 1e9, None
            for j, (b, gc) in enumerate(zip(gts, gtc)):
                d = math.hypot(gc[0] - c[0], gc[1] - c[1])
                pen = 0 if b[0] == want else 15  # prefer the right colour
                if d + pen < bd:
                    best, bd, bcol = j, d + pen, b[0]
            sample = exact_samples[o["id"]].get(f, {})
            lines = spec.get("road", {}).get("lane_lines_forward_m", [])
            lane = int(np.searchsorted(lines, -pose[1], side="right")) if lines and pose[1] < 0 else None
            row = {"f": f, "id": o["id"], "cat": o.get("category"), "src": sample.get("src", "interpolated"),
                   "sigma_m": sample.get("sigma_m"), "lane": lane,
                   "cx": round(float(c[0]), 1), "cy": round(float(c[1]), 1),
                   "inside": bool(inside), "bw": round(float(bx1 - bx0), 1)}
            if best is not None:
                gc = gtc[best]
                dpx = math.hypot(gc[0] - c[0], gc[1] - c[1])
                z0 = (o.get("height_m") or HEIGHT.get(o.get("category"), 1.5)) / 2
                a, b2 = to_plane(c[0], c[1], z0), to_plane(gc[0], gc[1], z0)
                dm = math.hypot(a[0] - b2[0], a[1] - b2[1]) if a and b2 else None
                row.update(gt=best, gt_col=bcol, color_ok=bool(bcol == want), err_px=round(float(dpx), 1),
                           err_m=None if dm is None else round(float(dm), 2), gx=round(gc[0], 1), gy=round(gc[1], 1))
                if inside and dpx < max(25, 0.8 * (bx1 - bx0)):
                    used.add(best)
                    cv2.line(right, (int(c[0] * S), int(c[1] * S)), (int(gc[0] * S), int(gc[1] * S)), (0, 255, 255), 1)
            rows.append(row)
        for j, b in enumerate(gts):
            cc = {"cyan": (255, 255, 0), "yellow": (0, 255, 255), "green": (0, 255, 0)}[b[0]]
            cv2.rectangle(right, (int(b[1] * S), int(b[2] * S)), (int(b[3] * S), int(b[4] * S)), cc, 1)
            if j not in used:
                unmatched_gt.append({"f": f, "col": b[0], "box": [float(v) for v in b[1:]]})
                cv2.putText(right, "?", (int(b[1] * S), int(b[2] * S) + 12), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1)
        lab = f"f{f}  t={t:5.2f}s"
        for img in (big, right):
            cv2.putText(img, lab, (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 3)
            cv2.putText(img, lab, (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)
        cv2.putText(right, "spec boxes (red=yellow car, magenta=van, white=bg) | GT rects", (8, ch * S - 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)
        sheet = np.hstack([big, right])
        if f in KEY_FRAMES:
            cv2.imwrite(os.path.join(OUT, f"sheet_{f:03d}.png"), sheet)
        if vw:
            vw.stdin.write(sheet.tobytes())
    if vw:
        vw.stdin.close(); vw.wait()
    cap.release()
    if f != NF - 1 or not ok:
        raise ValueError("Source video did not provide all 400 frames")
    json.dump({"mapping": m, "spec_version": spec.get("prompt_version"), "frames_reviewed": NF,
               "spec_sha256": hashlib.sha256(open(args.spec, "rb").read()).hexdigest(),
               "video_sha256": hashlib.sha256(open(video_path, "rb").read()).hexdigest(),
               "limitations": ["Nearest annotation residuals are diagnostics, not identity or physical-accuracy proof.",
                               "Annotation detections include opposing traffic; unmatched counts are not crash-side recall.",
                               "Multiple projected boxes may match the same annotation; use lane_counts.json for the manual coverage audit."],
               "rows": rows, "unmatched_gt": unmatched_gt},
              open(os.path.join(OUT, "errors.json"), "w"))
    summarize(rows, unmatched_gt)


def summarize(rows, unmatched_gt):
    ins = [r for r in rows if r["inside"] and "err_px" in r]
    if not ins:
        print("no in-tile rows"); return
    by = {}
    for r in ins:
        by.setdefault(r["id"], []).append(r)
    lines = []
    for vid, rs in by.items():
        e = np.array([r["err_px"] for r in rs]); em = np.array([r["err_m"] for r in rs if r["err_m"] is not None] or [0])
        w = max(rs, key=lambda r: r["err_px"])
        lines.append((float(np.median(e)), vid, len(rs), float(np.median(e)), float(e.max()), w["f"],
                      float(np.median(em)), sum(not r["color_ok"] for r in rs)))
    lines.sort(reverse=True)
    txt = ["vehicle  n_in_tile  median_px  max_px@frame  median_m  wrong_colour_frames"]
    for _, vid, n, med, mx, wf, mm, wc in lines:
        txt.append(f"{vid:12s} {n:4d} {med:8.1f} {mx:8.1f}@{wf:<4d} {mm:7.2f} {wc:4d}")
    crash = [l for l in txt if l.startswith(("yellow-car", "white-van"))]
    allpx = np.array([r["err_px"] for r in ins])
    head = [f"in-tile vehicle-frames: {len(ins)}  median err {np.median(allpx):.1f}px  p90 {np.percentile(allpx, 90):.1f}px",
            f"GT boxes with no spec vehicle: {len(unmatched_gt)} box-frames ({len(unmatched_gt) / NF:.1f}/frame)",
            "crash pair:", *crash, "worst 15 by median:", *txt[:16]]
    open(os.path.join(OUT, "summary.txt"), "w").write("\n".join(head + ["", "all:"] + txt) + "\n")
    print("\n".join(head))


if __name__ == "__main__":
    main()
