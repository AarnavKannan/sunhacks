# Measured reconstruction handoff

Updated 2026-11-15. Checkout: `/home/rayan/Developer/projects/sunhacks`; delivery branch: `testing`. This continues the unfinished checkpoint at `39e2fec` (`handoff to rayan for harness optimization`). The historical Windows paths and missing-data statements from that checkpoint are superseded by this document and `WHAT-RAYAN-DID.md`.

**The Electron app has not been started, restarted or terminated, and the real database has not been changed.** Browser verification uses an isolated Vite/agent-browser harness; database tests use disposable Mongo instances. Backend changes need a user-controlled app restart before testing the updated desktop behavior.

## Current scope and behavior

The demo covers source frames **0–399 at 12.5 fps**, times **0–31.92 s**, in a 32-second scene. The measurement crop is exactly **(481,304,479,300)** in `demo_32s.mp4`. Both allowlisted `demo.mp4` and `demo_32s.mp4` uploads load this same 32-second reconstruction. Other footage retains authenticated Codex reconstruction on **GPT-6.1 Terra, xhigh**; no API-key or Gemini fallback was introduced. Development continuations use **Sol xhigh, standard service tier**; final independent review uses **Sol medium, standard tier**.

- Each vehicle replays its own keyframes and heading, with interpolation between observations. There is no generated traffic queue, relocated vehicle, universal pile-up or invented collision response.
- Cleaned tracks supply pre-impact traffic. The strict visibility check requires every supplied vehicle to reach the planner, layout and scene metadata at its supplied times. Motorcycles have a two-wheel proxy; measured proxy dimensions, including supplied cuboid heights, survive rendering.
- The road uses all six measured crash-side strips and asymmetric paint offsets. Measured road ends are ±850 m; site, camera and surroundings bounds cover that extent and the supplied observations/static objects.
- Production background visibility follows the audited measured/interpolated source spans. Unrestricted road-end extension was found to add 51 unsupported in-frame vehicles at f213 and is disabled for real production. `--extend-background-edges` retains it as a labeled diagnostic option; synthetic fixtures continue to exercise it. A source track can appear inside the image at its first reliable fit. Crash trajectories never use that extension.
- The near median is a measured low snow/grass verge, with a separate far-side barrier and an uncertain distant hedge band. Fixed footprints agree with rendered collision geometry. Fixed objects have zero velocity/acceleration and an immovable response.
- Source sample labels and position sigma survive the schema, playback and database. Mongo rows use the same playback poses on the source frame grid. Their velocity/acceleration are differences of those poses; net force is assumed mass × acceleration. A force split uses assumed drag/rolling/grip coefficients and is not a measured separation of tyre and contact forces.
- Assistant queries return stored vectors, source frame/provenance, fixed geometry and contacts. Scene/contact/force results preserve the reconstruction caveats. Position sigma does not quantify derivative uncertainty; measured scenes do not receive an invented small generic speed/acceleration sigma.
- Demo uploads and saved/legacy demo scenes reload the current disk spec. Content hashes invalidate stale analyses and motion rows. Per-incident serialized upserts and revision cleanup repair the reproduced Mongo duplicate-key/interrupted-sync problems without deleting the real database.

## Evidence that must remain qualified

The authoritative crash-pair input and overlays are in `FrontEnd/app/electron/demo-incident/measure/data/crash_pair.json` and `measure/review_crash/`.

- First supported vehicle contact: **f291 ±1**, **23.28 s**. Touching surfaces are hidden by the van; this is an inferred contact, not a directly observed touch.
- Yellow-car identity is reliable from **f151 (12.08 s)**. Its centre occupies lane 1 through f254, lane 2 f255–279, then lane 1 from f280. The outward pass and large return/rotation are supported. Earlier identity and repeated small wiggles are unresolved; no early yellow-car path was fabricated.
- Soft-verge entry: **f283 ±2**, **22.64 s**. Its impulse is unidentifiable and omitted. This does not establish a rigid hedge/barrier strike. No van/verge or far-side-barrier contact is asserted.
- The van travels approximately **18.1 m** after impact and remains partly in the tile. The old 4 m shove and 22.3-second fallback contact are superseded.
- Yellow paint is visible through f316. f317–318 interpolate its occluded turn; f319–399 retain an `occluded-rest` region with sigma **3→5 m**. Precise final rest/time and spin heading are uncertain; continued hidden motion cannot be excluded.
- Vehicle masses and some dimensions/material parameters are assumptions. Horizon depth and association are weak. Fitted acceleration, impulse and net force are sensitive to timing, calibration and pose choices and are not sensor measurements.

Final tracking corrections, lane census/deltas, source preservation and hashes belong to `measure/review_tracks/REVIEW-COMPLETE.md`. Numerical integrity and visual acceptance are separate: passing implementation checks does not prove complete identity/recall, exact physics or that the hackathon visual target has been accepted by the user.

## Build and verification

The production input must be the **real** `measure/data` directory. `measure/review_spec` contains explicitly synthetic fixtures and must never replace it.

From repository root:

```sh
.venv/bin/python FrontEnd/app/electron/demo-incident/build-measured-spec.py --data FrontEnd/app/electron/demo-incident/measure/data --out FrontEnd/app/electron/demo-incident/incident-spec.json --omit-opposing
.venv/bin/python FrontEnd/app/electron/demo-incident/measure/review/validate_measured.py
.venv/bin/python FrontEnd/app/electron/demo-incident/measure/review/reproject.py --no-video --out FrontEnd/app/electron/demo-incident/measure/review/final/reprojection
```

From `FrontEnd/app`:

```sh
node tests/verify-measured.mjs
node tests/playback-render.mjs --require-source --out=tests/final-playback demo
```

`verify-measured.mjs` runs integrity, schema, all-observation retention, camera, real-clip viewer→disposable Mongo→actual assistant checks, Mongo race/recovery, upload/restore routing, production geometry/kinematics, collision tests, assistant typecheck/tests and production build. It stops on failure and writes `tests/final-verification.json`. It does not run Electron or a live model.

The browser harness captures exact source frames f0,125,188,212,213,250,281–294,300,350,399. Thus requests around 15/17 seconds are represented by 15.04 and both 16.96/17.04 seconds. It uses the hashed build transform, calibrated optical axis **and roll**, exact odd-pixel crop, and no fitted van anchor. Its own browser/server close on completion. See `tests/final-playback/README.md` and `playback-render-status.json`; `sourceFidelityAccepted:false` deliberately leaves final acceptance to the user.

The builder writes `incident-spec.json.build.json` with actual input/builder/video/output SHA-256 values, stable ID mapping, coordinate transform and omitted/dropped scope. Rebuild after any source change; mismatched hashes are errors. World W is X away from camera, Y camera-right, Z up; plan is `(X_REF-X, Y-Y_median)`, heading `180-heading_W`; Three.js is `(plan_x,height,-plan_y)`.

## Delivery evidence

Final assembly, checks, source/viewer findings, independent review and commit/push results are recorded in `WHAT-RAYAN-DID.md`. Production is assembled from the frozen 141-track / 10,732-sample real data, with zero added road-end traffic. All 1,170 integrity assertions, 16 verification groups and 23 source/viewer checkpoints pass their stated implementation scope. Independent Sol-medium review found no blocking implementation defects and passed focused independent checks; its source-acceptance limits remain explicit. Review settings and evidence are in `tests/final-review.md` and `tests/final-review-run.json` under the app. Delivery is on `testing`, commit message `complete measured reconstruction and verification`; see branch Git history and `WHAT-RAYAN-DID.md`.

Historical fallback/synthetic screenshots and W4 failures are not final source acceptance. `tests/W4-playback-report.md` labels that earlier checkpoint. `measure/review/story.py` retains old lane/contact assumptions and is not a final oracle. Disposable tile/numpy caches and superseded diagnostic captures stay local under scoped ignores; measurement scripts, final data and appropriate evidence are preserved.
