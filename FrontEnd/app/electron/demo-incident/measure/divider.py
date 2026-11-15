"""Median divider of the crash camera (bottom-right tile), measured from the background plate.

Run from measure/:  python divider.py      -> data/divider.json, review_calib/divider_*.png

Method
  * data/br_bg.png (per-pixel median of frames 0..396 step 4, so moving traffic is gone) is resampled onto
    the road plane Z=0 with cam.py (world W: X away from the camera, Y to its right, Z up).
  * Lateral profiles (grey level and HSV saturation, median over 10 m X bands) locate the painted crash-side
    edge line, the crash-side edge of the vegetated median verge, the snow/grass boundary, the far-side
    barrier band and, beyond the verge, the crash-side band of the paved median. Half-level crossings of
    each step give the edge positions; their spread over the bands is the reported scatter.
  * Longitudinal profiles along the verge give where it ends (snow and grass both stop).
  * Raised objects project away from the camera on Z=0: a point (Y, Z) lands at
    Y_g = cam_Y + (Y - cam_Y) * h / (h - Z). The width of a projected face band therefore gives a height
    estimate; the visibility of the painted edge line next to the verge bounds the verge's height there.

Everything that is a model parameter (friction, restitution, stiffness) is marked "assumed".
"""
import json, os, sys
import numpy as np, cv2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cam  # noqa: E402

DATA = os.path.join(HERE, "data")
OUT_REVIEW = os.path.join(HERE, "review_calib")
H, CAM_Y = float(cam.h), float(cam.cy0)

bgr = cv2.imread(os.path.join(DATA, "br_bg.png"))
gray = bgr.astype(np.float32).mean(2)
sat = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)[:, :, 1].astype(np.float32)


def sample(img, X, Y):
    shape = np.shape(X)
    u, v = cam.to_img(np.ravel(X), np.ravel(Y))
    n = u.size
    w = 1024  # remap needs < 32767 rows/cols
    pad = (-n) % w
    U = np.concatenate([u, np.full(pad, -10.0)]).astype(np.float32).reshape(-1, w)
    V = np.concatenate([v, np.full(pad, -10.0)]).astype(np.float32).reshape(-1, w)
    out = cv2.remap(img, U, V, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=float("nan"))
    return out.ravel()[:n].reshape(shape)


def lateral_profile(img, x0, x1, ys):
    xs = np.arange(x0, x1, 0.5)
    XX, YY = np.meshgrid(xs, ys, indexing="ij")
    return np.nanmedian(sample(img, XX, YY), 0)


def crossing(ys, prof, lo, hi, rising=True):
    """Y where prof crosses the half level between its min and max inside [lo, hi] (first crossing scanning +Y)."""
    m = (ys >= lo) & (ys <= hi)
    y, p = ys[m], prof[m]
    a, b = np.nanmin(p), np.nanmax(p)
    half = (a + b) / 2
    for i in range(len(p) - 1):
        if (p[i] < half <= p[i + 1]) if rising else (p[i] > half >= p[i + 1]):
            return float(y[i] + (half - p[i]) / (p[i + 1] - p[i]) * (y[i + 1] - y[i]))
    return None


def height_from_band(y_foot, y_proj):
    """Height of a vertical face whose foot is at y_foot and whose top projects (on Z=0) to y_proj."""
    k = (y_proj - CAM_Y) / (y_foot - CAM_Y)
    return H * (1 - 1 / k)


def height_bound_visible(y_obj, y_ground):
    """Max height at lateral position y_obj so that the ground at y_ground (further from the camera) stays visible."""
    return H * (1 - (y_obj - CAM_Y) / (y_ground - CAM_Y))


ys = np.arange(-9.6, -3.4, 0.01)
cal = json.load(open(os.path.join(DATA, "br_camera.json")))
L = cal["lines_Y"]

# ---------------------------------------------------------------------------------------------- verge section
VERGE_BANDS = [(58, 70), (70, 85), (85, 100), (100, 115), (115, 130), (130, 145), (145, 158)]
rows = []
for x0, x1 in VERGE_BANDS:
    g = lateral_profile(gray, x0, x1, ys)
    s = lateral_profile(sat, x0, x1, ys)
    # painted edge line: brightest point in -9.25..-8.85
    m = (ys > -9.25) & (ys < -8.85)
    y_line = float(ys[m][np.argmax(g[m])])
    # crash-side verge edge: dark asphalt -> bright snow, scanning +Y from the line
    y_verge = crossing(ys, g, y_line + 0.12, -8.2, rising=True)
    # snow -> green grass (saturation rise)
    y_snow = crossing(ys, s, -7.6, -6.3, rising=True)
    # far-side barrier band (bright strip next to the right carriageway's shoulder)
    y_bar_in = crossing(ys, g, -5.15, -4.82, rising=True)     # verge side of the band (projected top)
    y_bar_out = crossing(ys, g, -4.83, -4.55, rising=False)   # shoulder side (foot)
    rows.append({"X": [x0, x1], "line": y_line, "verge_edge": y_verge, "snow_grass": y_snow,
                 "barrier_band": [y_bar_in, y_bar_out]})

# where the verge ends: snow (Y -8.5..-7.8) and grass saturation (Y -6.5..-5.5) both stop
xs = np.arange(140, 180, 0.25)
snow = np.nanmean(np.stack([sample(gray, xs, np.full_like(xs, y)) for y in np.arange(-8.5, -7.7, 0.1)]), 0)
grass = np.nanmean(np.stack([sample(sat, xs, np.full_like(xs, y)) for y in np.arange(-6.5, -5.4, 0.1)]), 0)


def first_drop(x, p, ref_lo, ref_hi):
    hi = np.nanmedian(p[(x >= ref_lo) & (x < ref_lo + 10)])
    lo = np.nanmedian(p[(x >= ref_hi - 10) & (x <= ref_hi)])
    half = (hi + lo) / 2
    k = np.convolve(p, np.ones(5) / 5, mode="same")
    for i in range(len(x) - 1):
        if x[i] > ref_lo + 5 and k[i] > half >= k[i + 1]:
            return float(x[i])
    return None


x_end_snow = first_drop(xs, snow, 140, 180)
x_end_grass = first_drop(xs, grass, 140, 180)

# ---------------------------------------------------------------------------------------------- far section
FAR_BANDS = [(170, 200), (200, 240), (240, 290)]
far = []
for x0, x1 in FAR_BANDS:
    g = lateral_profile(gray, x0, x1, ys)
    s = lateral_profile(sat, x0, x1, ys)
    m = (ys > -9.25) & (ys < -8.8)
    y_line = float(ys[m][np.argmax(g[m])])
    y_band_l = crossing(ys, g, y_line + 0.05, -8.4, rising=False)   # bright line -> dark band
    y_band_r = crossing(ys, g, -8.2, -7.3, rising=True)              # dark band -> light paved median
    y_rb_l = crossing(ys, g, -5.6, -5.0, rising=False)               # light median -> dark far band
    y_rb_r = crossing(ys, g, -5.1, -4.6, rising=True)
    msk = (ys > -8.6) & (ys < -8.0)
    far.append({"X": [x0, x1], "line": y_line, "crash_band": [y_band_l, y_band_r], "far_band": [y_rb_l, y_rb_r],
                "crash_band_sat": float(np.nanmedian(s[msk])), "asphalt_sat": float(np.nanmedian(s[(ys > -9.6) & (ys < -9.3)])),
                "paved_sat": float(np.nanmedian(s[(ys > -7.2) & (ys < -6.0)]))})

# ---------------------------------------------------------------------------------------------- summarise
med = lambda v: float(np.median([x for x in v if x is not None]))
spread = lambda v: float(np.std([x for x in v if x is not None]))
verge_edge = med([r["verge_edge"] for r in rows])
verge_edge_sd = spread([r["verge_edge"] for r in rows])
snow_grass = med([r["snow_grass"] for r in rows])
bar_in = med([r["barrier_band"][0] for r in rows])
bar_out = med([r["barrier_band"][1] for r in rows])
line_chk = med([r["line"] for r in rows])
y_bar_foot = bar_out   # shoulder-side half-level edge of the band = foot of the lit face (calibration R_barrier, the band centre, is ~0.08 m further in)
BAR_THICK = 0.3        # assumed: the median-side face is hidden in the grass
x_verge_end = float(np.mean([v for v in (x_end_snow, x_end_grass) if v is not None]))
far_l = med([f["crash_band"][0] for f in far])
far_r = med([f["crash_band"][1] for f in far])
far_rb_l = med([f["far_band"][0] for f in far])
far_rb_r = med([f["far_band"][1] for f in far])


def x_near_visible(y):
    """Smallest X still inside the tile (bottom edge, v < 299.5) at lateral position y."""
    for X in np.arange(40, 80, 0.25):
        u, v = cam.to_img(X, y)
        if v[0] < 299.5 and 0 <= u[0] < 479:
            return float(X)
    return None


x_near = max(x_near_visible(verge_edge), x_near_visible(y_bar_foot))
X_FAR = 320.0  # beyond this the median is a few pixels wide; R_barrier/L_edge_inner seen to 293/317 m
x_far_seen = min(float(cal["residuals"]["line_X_seen"]["R_barrier"][1]), float(cal["residuals"]["line_X_seen"]["L_edge_inner"][1]))

# heights
h_edge_bound = height_bound_visible(verge_edge, line_chk + 0.08)   # verge edge must not hide the dark asphalt next to the line
h_barrier = height_from_band(y_bar_foot, bar_in)                   # far barrier face (foot at the band's shoulder edge, projected top at bar_in)
h_far_band = [height_from_band(far_r, far_l)]                      # crash-side band of the paved median, if it were a vertical face

# The crash-side band of the paved median (X > verge end): if it is ~0.5 m tall its crash-side top edge is here
H_FAR_BAND_ASSUMED = 0.5
far_face = CAM_Y + (far_l - CAM_Y) * (H - H_FAR_BAND_ASSUMED) / H

R = lambda v: round(float(v), 3)
x_end = R(x_verge_end)
zero = [0.0, 0.0, 0.0]


def ccw(poly):
    """Counter-clockwise in the (X, Y) plane (W is right-handed with Z up, so this is CCW seen from above)."""
    poly = [[R(x), R(y)] for x, y in poly]
    area = 0.5 * sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(poly, poly[1:] + poly[:1]))
    return poly if area > 0 else poly[::-1]


def rect(x0, x1, y0, y1):
    return ccw([[x0, y0], [x1, y0], [x1, y1], [x0, y1]])


def static_object(oid, kind, label, x0, x1, y_crash, y_far, height, h_sigma, material, mu, e, k, source, sigma, note, **extra):
    return {"id": oid, "kind": kind, "label": label, "footprint_W": rect(x0, x1, y_crash, y_far),
            "face_Y_crash_side": R(y_crash), "face_Y_far_side": R(y_far), "x_range": [R(x0), R(x1)],
            "height_m": R(height), "height_sigma_m": h_sigma, "material": material,
            "friction": mu, "restitution": e, "stiffness_n_per_m": k,
            "contact_params_source": "assumed (typical values for the material); not measured",
            "immovable": True, "velocity_mps": zero, "acceleration_mps2": zero,
            "source": source, "sigma_m": R(sigma), "note": note, **extra}


y_bar_in = y_bar_foot - BAR_THICK
divider = static_object(
    "median-divider", "median_divider", "median verge (snow-covered grass)",
    x_near, x_verge_end, verge_edge, y_bar_in, 0.15, 0.15, "snow_covered_grass_verge", 0.35, 0.05, 3.0e5,
    "measured", max(0.05, verge_edge_sd) + 0.05,
    (f"At the crash site (X {x_near:.0f}-{x_end:.0f} m) the median is a vegetated verge: plowed snow on grass from the crash-side edge "
     f"Y={verge_edge:.2f} to Y={snow_grass:.2f}, bare grass to the far-side barrier (lit face foot Y={y_bar_foot:.2f}, right-carriageway side). "
     f"No tall hedge/barrier is visible on the crash side. A low kerb or asphalt/verge lip is unresolved: the painted edge line (calibrated Y={float(L['L_edge_inner']):.2f}) and "
     f"~{verge_edge - line_chk - 0.08:.2f} m of asphalt are visible next to it, which bounds the verge height at its crash-side edge to "
     f"<= {h_edge_bound:.2f} m; the height of the snow-covered vegetation itself is not resolvable from this single fixed view "
     f"(height_m 0.15 is an estimate, height_sigma_m 0.15). Beyond X={x_end:.0f} m the verge ends and the median is paved, bordered on the crash "
     f"side by a dark band (see related_objects: median-hedge-far). No tall 'bushy' hedge is visible next to the crash site itself: "
     f"a vehicle leaving lane 1 to its left runs onto this soft verge first and reaches the barrier ~{y_bar_in - verge_edge:.1f} m further on."),
    snow_band_Y=[R(verge_edge), R(snow_grass)],
)
divider["x_range_note"] = (f"visible extent of the verge: tile bottom edge at X={x_near:.1f} m (the median continues toward and past the camera, "
                           f"unseen), verge end at X={x_end:.1f} m (snow end {x_end_snow:.1f}, grass end {x_end_grass:.1f}). Anything drawn outside "
                           "x_range is inferred.")
related = [
    static_object(
        "median-barrier", "barrier", "median barrier (far side)",
        x_near, X_FAR, y_bar_in, y_bar_foot, h_barrier, 0.2, "concrete_barrier", 0.5, 0.15, 5.0e6, "measured", 0.1,
        (f"Bright band Y {bar_in:.2f}..{bar_out:.2f} on the road plane along the whole visible median (calibration line R_barrier "
         f"Y={float(L['R_barrier']):.2f} is its centre). Read as the lit right-carriageway face of a barrier with its foot at Y={y_bar_foot:.2f}; "
         f"the projected width gives height ~{h_barrier:.2f} m (sigma 0.2). Thickness {BAR_THICK} m is assumed (the median-side face is hidden). "
         "Concrete vs steel is not resolvable at this resolution."),
        thickness_m=BAR_THICK, thickness_source="assumed"),
    static_object(
        "median-hedge-far", "other", "median hedge band (far section)",
        x_verge_end, X_FAR, far_face, far_r, H_FAR_BAND_ASSUMED, 0.3, "hedge", 0.4, 0.05, 5.0e5, "inferred", 0.3,
        (f"Dark band Y {far_l:.2f}..{far_r:.2f} (road-plane projection) on the crash side of the paved median beyond X={x_end:.0f} m; "
         f"saturation {np.median([f['crash_band_sat'] for f in far]):.0f} vs asphalt {np.median([f['asphalt_sat'] for f in far]):.0f} "
         f"and paved median {np.median([f['paved_sat'] for f in far]):.0f}: vegetation-like, probably a low hedge (could be a barrier in shade). "
         f"Height assumed {H_FAR_BAND_ASSUMED} m; its crash-side face is then at Y={far_face:.2f}. Far from the crash site (X~80 m)."),
        projected_band_Y=[R(far_l), R(far_r)]),
]
divider["related_objects"] = related
divider["paved_median_far"] = {"x_range": [x_end, X_FAR], "Y": [R(far_r), R(y_bar_in)], "material": "paved (flat)", "source": "measured",
                               "note": "flat light-grey strip between the hedge band and the barrier; not a collision object"}
divider["measurements"] = {
    "verge_bands": rows,
    "verge_end_X": {"snow": x_end_snow, "grass": x_end_grass},
    "far_bands": far,
    "edge_line_check": {"profile_peak_Y": R(line_chk), "calibration_Y": float(L["L_edge_inner"]),
                        "note": "profile peak of the ~0.15 m wide paint; agrees with the calibrated line within 0.05 m"},
    "height_bound_at_verge_edge_m": R(h_edge_bound),
    "camera": {"h_m": H, "cam_Y_m": CAM_Y},
    "method": "divider.py: road-plane resampling of data/br_bg.png with cam.py; half-level crossings of lateral grey/saturation profiles",
}
footprint = divider["footprint_W"]

if __name__ == "__main__":
    out = os.path.join(DATA, "divider.json")
    with open(out, "w") as fh:
        json.dump(divider, fh, indent=1)
    # Add the measured median details without replacing the camera fit or existing lane data.
    cal["median"].update({"right_side_barrier_reference_Y": float(L["R_barrier"]),
                           "right_side_barrier_foot_Y": R(y_bar_foot),
                           "crash_side_verge_face_Y": R(verge_edge), "far_side_verge_face_Y": R(y_bar_in),
                           "verge_x_range": [R(x_near), R(x_verge_end)],
                           "verge_height_m": 0.15, "verge_height_sigma_m": 0.15,
                           "barrier_height_m": R(h_barrier), "barrier_height_sigma_m": 0.2,
                           "divider_geometry_file": "divider.json",
                           "description": "Low snow-covered grass verge near the crash, separate narrow far-side barrier; paved median beyond X~159 m. Far crash-side dark band may be a low hedge or shaded barrier; do not model the near verge as tall bushes."})
    cal["crash_carriageway"]["cross_section_check"] = {
        "painted_lines_Y": [float(L[k]) for k in ("L_edge_inner", "L_1_2", "L_2_3", "L_3_4", "L_4_5", "L_5_6", "L_edge_outer")],
        "strip_count": 6, "method": "calib_joint fit, inspected divider_overlay_bg/f0/f296/f360.png",
        "line_median_abs_residual_max_px": max(cal["residuals"]["line_median_abs_px"][k] for k in L if k.startswith("L")),
        "note": "Six lane-width strips, including possible auxiliary lanes; outer strips enter the camera farther away."}
    with open(os.path.join(DATA, "br_camera.json"), "w") as fh:
        json.dump(cal, fh, indent=1)
    print("wrote", out)
    for r in rows:
        print("verge", r)
    for f in far:
        print("far", f)
    print(f"verge edge {verge_edge:.3f} (sd {verge_edge_sd:.3f}), snow/grass {snow_grass:.2f}, barrier band {bar_in:.2f}..{bar_out:.2f}, "
          f"edge line {line_chk:.3f} (cal {L['L_edge_inner']:.3f})")
    print(f"verge X {x_near:.1f}..{x_verge_end:.1f} (snow end {x_end_snow}, grass end {x_end_grass}); far band {far_l:.2f}..{far_r:.2f}, far-right band {far_rb_l:.2f}..{far_rb_r:.2f}")
    print(f"height bound at verge edge {h_edge_bound:.2f} m; barrier height est {h_barrier:.2f} m; far band as vertical face {h_far_band[0]:.2f} m")
    print("footprint_W", footprint)
