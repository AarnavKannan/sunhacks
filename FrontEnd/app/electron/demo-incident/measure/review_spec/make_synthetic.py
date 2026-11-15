"""Synthetic stand-ins for A1/A3/A4 outputs (scene agent's scratch only). Writes into this folder."""
import json, math, os, random

here = os.path.dirname(os.path.abspath(__file__))
random.seed(3)
FPS = 12.5
cal = json.load(open(os.path.join(here, "..", "data", "br_camera.json")))
json.dump({"synthetic": True, "lines_Y": cal["lines_Y"]}, open(os.path.join(here, "br_camera.json"), "w"), indent=1)
L = cal["lines_Y"]
cl = sorted((v for k, v in L.items() if k.startswith("L")), reverse=True)
rl = sorted(v for k, v in L.items() if k.startswith("R") and "barrier" not in k)
toward = [(a + b) / 2 for a, b in zip(cl, cl[1:])][:3]
away = [(a + b) / 2 for a, b in zip(rl, rl[1:])]

PAINTS = [("silver", "#b8bcc2"), ("black", "#16181c"), ("white", "#eeeeea"), ("grey", "#6d7178"), ("blue", "#2a4f8f"), ("red", "#9c1f1f")]
CLASSES = ["car"] * 8 + ["van", "truck", "bus", "motorcycle"]


def track(i, cls, lane_y, sx, x0, f0, speed):
    samples = []
    x = x0
    for f in range(f0, 400):
        if not (5 < x < 220):
            if samples:
                break
            x += sx * speed / FPS
            continue
        hd = 0.0 if sx > 0 else 180.0
        samples.append({"f": f, "t": f / FPS, "x": round(x, 3), "y": round(lane_y + random.gauss(0, 0.05), 3), "heading_deg": hd,
                        "speed_mps": speed, "vx": sx * speed, "vy": 0.0, "ax": 0.0, "ay": 0.0, "yaw_rate_dps": 0.0,
                        "fx_n": 0.0, "fy_n": 0.0, "cause": "coasting", "sigma_m": 0.4, "src": "measured"})
        x += sx * speed / FPS
    paint, hexv = random.choice(PAINTS)
    return {"id": f"t{i:03d}", "class": cls, "paint": paint, "paint_hex": hexv, "crash": False,
            "length_m": 4.6, "width_m": 1.8, "mass_kg": 1500, "samples": samples}


tracks = []
for i in range(130):
    sx = random.choice([1, -1])
    lane = random.choice(toward if sx < 0 else away)
    if sx < 0 and lane == toward[0]:
        lane = toward[1]
    f0 = random.randint(0, 380)
    x0 = 200 if sx < 0 else 10
    tracks.append(track(i, random.choice(CLASSES), lane, sx, x0, f0, random.uniform(18, 33)))
tracks = [t for t in tracks if len(t["samples"]) >= 3]
# A3 also flags the crash pair; A4's file overrides these.
tracks.append({**track(900, "van", toward[0], -1, 60, 0, 0.0), "crash": True, "paint": "white"})

CF = 279  # contact frame
van, car = [], []
for f in range(400):
    t = f / FPS
    vx_van = 0.0
    xv = 60.0
    if f >= CF:
        tau = (f - CF) / FPS
        vx_van = -max(0.0, 3.0 - 6.0 * tau)
        xv = 60.0 - (3.0 * min(tau, 0.5) - 3.0 * min(tau, 0.5) ** 2)
    van.append({"f": f, "t": t, "x": xv, "y": toward[0], "heading_deg": 180.0 if f < CF else 180.0 - min(8.0, (f - CF) * 0.6),
                "speed_mps": abs(vx_van), "vx": vx_van, "vy": 0.0, "ax": 0.0, "ay": 0.0, "yaw_rate_dps": 0.0,
                "fx_n": (-120000.0 if CF <= f < CF + 2 else (13000.0 if f < CF + 8 and f >= CF + 2 else 0.0)), "fy_n": 0.0,
                "cause": "impact" if CF <= f < CF + 2 else ("braking" if f >= CF + 2 and f < CF + 8 else "coasting"),
                "sigma_m": 0.2, "src": "measured"})
    if f < 200:
        continue
    # yellow car: lane 2 at 25 m/s, drifting toward lane 1, hits the van's rear at f=CF
    if f <= CF:
        tau = (CF - f) / FPS
        x = 60.0 + 5.0 + 25.0 * tau
        y = toward[0] + (toward[1] - toward[0]) * min(1.0, tau / 2.0) - 0.9 * max(0.0, 1 - tau / 2.0)
        sp, hd, cause, fx = 25.0, 180.0 + 20.0 * max(0.0, 1 - tau / 2.0), "steering", 0.0
    else:
        tau = (f - CF) / FPS
        d = 25.0 * 0.3 * min(tau, 1.2) - 0.5 * 6 * min(tau, 1.2) ** 2 if tau < 1.2 else 25.0 * 0.3 * 1.2 - 3 * 1.44
        x = 65.0 - max(0.0, d)
        y = toward[0] - 0.9 + 0.8 * min(1.0, tau)
        sp = max(0.0, 7.5 - 6 * tau)
        hd = 200.0 + 30 * min(1.0, tau / 1.5)
        cause, fx = ("impact", 120000.0) if f < CF + 2 else ("sliding", 7000.0 if sp > 0 else 0.0)
    car.append({"f": f, "t": f / FPS, "x": round(x, 3), "y": round(y, 3), "heading_deg": hd, "speed_mps": sp, "vx": -sp, "vy": 0.0,
                "ax": 0.0, "ay": 0.0, "yaw_rate_dps": 0.0, "fx_n": fx, "fy_n": 0.0, "cause": cause, "sigma_m": 0.2, "src": "measured"})
json.dump({"synthetic": True, "tracks": tracks}, open(os.path.join(here, "tracks_world.json"), "w"))
veh = lambda cls, paint, hexv, L, W, M, s: {"class": cls, "paint": paint, "paint_hex": hexv, "crash": True, "length_m": L, "width_m": W, "mass_kg": M, "samples": s}
json.dump({"synthetic": True, "vehicles": {"white-van": veh("van", "white", "#f2f2f0", 5.4, 2.05, 2500, van),
                        "yellow-car": veh("car", "yellow", "#e8c21a", 4.3, 1.8, 1350, car)},
           "contacts": [{"a": "yellow-car", "b": "white-van", "kind": "vehicle-vehicle", "source": "inferred", "sigma_s": 0.08, "note": "SYNTHETIC integration contact", "frame": CF, "t": CF / FPS, "point": [62.3, toward[0] - 0.8], "normal_deg": 180.0, "impulse_ns": 9000.0,
                       "peak_force_n": 120000.0, "duration_s": 0.12},
                        {"a": "yellow-car", "b": "synthetic-divider", "frame": 305, "W": [60, toward[0] + 0.8], "normal_W": [0, 1],
                         "kind": "vehicle-static", "impulse_ns": 3000, "source": "inferred", "sigma_s": 0.16,
                         "note": "SYNTHETIC vehicle-static contact, not evidence about the real clip"}]},
          open(os.path.join(here, "crash_pair.json"), "w"))
print("synthetic:", len(tracks), "tracks")

# Deliberately synthetic geometry, independent of the measured divider file.
json.dump({"id": "synthetic-divider", "kind": "median_divider", "label": "SYNTHETIC low median verge",
           "footprint_W": [[55, toward[0] + 0.8], [160, toward[0] + 0.8], [160, -5], [55, -5]],
           "height_m": 0.15, "material": "snow_covered_grass_verge", "friction": 0.35,
           "restitution": 0.05, "stiffness_n_per_m": 300000, "source": "inferred", "sigma_m": 0.2,
           "immovable": True, "note": "SYNTHETIC integration geometry; not a source-footage measurement",
           "related_objects": [{"id": "synthetic-barrier", "kind": "barrier", "label": "SYNTHETIC concrete barrier",
                                "footprint_W": [[55, -5], [320, -5], [320, -4.7], [55, -4.7]], "height_m": 0.54,
                                "material": "concrete_barrier", "friction": 0.5, "restitution": 0.15,
                                "stiffness_n_per_m": 5e6, "source": "inferred", "sigma_m": 0.2,
                                "note": "SYNTHETIC integration geometry"}]}, open(os.path.join(here, "divider.json"), "w"), indent=2)
