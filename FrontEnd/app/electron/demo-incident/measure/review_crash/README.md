# Crash pair measurement review

Production input: `../data/crash_pair.json`. Regenerate from the saved source fits
and frame-checked controls with the repository venv:

```sh
.venv/bin/python FrontEnd/app/electron/demo-incident/measure/crash_pair.py
```

The script writes JSON atomically and regenerates the overlays and report. It
reads the final `cam.py` calibration and W3's `data/divider.json`. It does not
start the app, change the incident spec, or touch the database.

## Results and coverage

- First supported car/van contact: **f291, 23.28 s, ±1 frame**. Touching surfaces
  are behind the van. The van rocks at f292 and visibly translates by f293.
- Van is stopped in lane 1 through f290. Its measured calibration pose is
  `(80.564, -10.368)` W, rather than the nominal lane centre.
- Yellow pre-impact average velocity, f284–289: **(-20.01, +1.66) m/s W**,
  speed **20.08 m/s**. The van's pre-impact speed is zero.
- Comparing that car velocity with f296–301 gives **Δv = 12.48 m/s**;
  van post-impact velocity is **(-8.63, -0.42) m/s**, Δv **8.64 m/s**.
  These are fitted window averages, not instantaneous instrument readings.
- Van travel after impact: **18.10 m**. Final fitted pose is approximately
  `(62.60, -11.65)`, heading 185.6° W. It remains partly in the tile at f399;
  there is no out-of-view van extrapolation.
- Yellow centre occupies lane 1 at f151–254, lane 2 at f255–279, then lane 1
  at f280–399. `lanes_occupied` records the rotating footprint straddling lines,
  including the final uncertain straddle of lanes 1/2.
- Yellow footprint first encroaches onto the measured soft verge at **f283,
  22.64 s, ±2 frames**, around `(98.39, -8.637)` W. Its normal to the verge is
  `(0, +1)`. `impulse_ns` is **omitted** because it cannot be separated from
  steering and tyre/soft-ground forces. This is not a claimed rigid bush impact.
- No van/verge or vehicle/far-side-barrier contact is supported by the source.

## Files and provenance

- `report.json`: numerical results, source counts, contacts, uncertainty.
- `overlays/f000.png` etc.: 49 projected source comparisons. They include every
  frame f270–300 and requested f0,100,200,250,317,340,360,399. Red is the van,
  purple the yellow car, thick lines are ground footprints, and green is the
  measured verge edge. The legend is outside the source tile.
- `overlays_contact_a.jpg`, `overlays_contact_b.jpg`, `overlays_required.jpg`:
  contact sheets of those same comparisons. All 49 frames were visually inspected.
- `reprojection_metrics.json`: one-way distance from model edges to the burned-in
  source annotation, capped at 5 px. It is a diagnostic, not an accuracy certificate.
  Selected yellow approach median: 0.17 px; later selected yellow samples median:
  2.42 px, max 4.43 px. Selected stopped-van median: 1.79 px; later van median:
  1.96 px. Occluded edges and imperfect source boxes affect these distances.
- `car_approach_fixed_yaw.json`: per-frame source wire fits f151–266; the initial
  four tiny/partly obscured fits are replaced by an interpolation of the next
  short observed segment and labelled accordingly.
- `van_raw.json`: per-frame cuboid wire fits. The delivered stationary prefix
  removes rasterisation drift; the post-impact path uses five-frame median
  controls and interpolation, with source labels preserved in the output.
- `fit_tracks.py`: original intermediate fitting driver (`back`, `forward`, `van`).
- `car_back_raw.json`, `car_forward_raw.json`, `rotate_candidates.json`,
  `manual_seed_fits.json` and diagnostic images: intermediate investigations.
  **Do not feed the free forward fit into production.** It drifts onto the queue
  after f288; the checked source paint/wheel/silhouette controls in `CAR_TURN`
  replace it. Reverse fits before f151 likewise do not establish identity.
- `_tiles/`: ignored disk cache of exact 479×300 tiles, one frame at a time.

## Practical limits

There are **400 van samples** and **249 yellow samples**, f151–399. The yellow
car is a tiny, unlabelled light vehicle earlier, but a unique association before
f151 is unresolved. Its actual first in-view frame is not claimed. Far approach
depth is weak beyond the calibrated X<335 m range, and its large sigma reflects
that. Those early acceleration fluctuations have cause `other`.

The yellow body's spin heading uses the bonnet/window/side silhouette to resolve
the wire box's 180° ambiguity. At partial occlusion yaw may be uncertain by
20–40°. The f291 position is contact-constrained within its visual uncertainty,
so that pose is labelled interpolated.

Yellow paint is visible beside the van through f316. f317–318 interpolate the
last occluded turn, then f319–399 retain the final constrained region behind the
van as `occluded-rest` with sigma increasing **3→5 m**. The exact final stopping
time/pose is not observed; hidden continued motion cannot be excluded. This is
an explicit retention assumption, not a measured resting trajectory.

Vehicle masses (1350/2500 kg) and yellow dimensions are estimates. Velocity and
acceleration come from the delivered positions, and force is exactly m·a in W.
The vehicle contact's ~22.5 kN·s impulse is inferred from van Δv and assumed mass,
including unresolved tyre forces. It is not a measured action/reaction force
decomposition. Peak fitted net forces are ~242 kN car and ~63 kN van, highly
sensitive to the contact timing, pose controls and unknown mass.

All 649 samples have finite numeric fields and positive sigma; frame coverage,
source enums, unit normals, contact times, and force identity were checked.
Maximum m·a discrepancy is **0 N**. See `validation.json` for the final checks.
