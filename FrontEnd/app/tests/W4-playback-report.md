# Historical W4 report — superseded by final integration

The results below describe the interrupted W4 checkpoint. Final source captures and outcomes are documented in `final-playback/README.md` and root `WHAT-RAYAN-DID.md`. Final integration adds motorcycle meshes, measured footprint scales, full road/site bounds, exact odd-pixel crop and calibrated camera roll. Historical failed screenshots are local diagnostics, excluded from the delivery commit.

# W4 playback / visibility report

Work is confined to motion.ts, the saved mountScene.ts camera change, and W4 tests/artifacts. No Electron restart, database change, git index operation or commit.

## Findings

The current fallback does **not** reproduce an impact-time spawn gate. At 17 s it has 24 covered/posed objects, 20 on the crash side. `planMotion` retains them, `engine.ts` creates their layout entries before playback, `poseAt(17).hidden` is false, and `mountScene.setTime` applies that pose without checking involvement/contact time. All 78 fallback objects pass every keyframe and midpoint check. This verifies playback of the fallback; it does not establish that its approximate traffic identities or positions match the footage.

Representative fallback trace (plan metres; scene position is `(x, 0, -y)`, yaw = pi/2 for these headings):

| ID | Raw visibility and keyframe bounds (s) | Pose at 17 s (x, y) | Planner/layout visibility |
| --- | --- | --- | --- |
| white-van | 0–59.92 | (15, -2.925) | visible |
| yellow-car | 10.72–59.92 | (-58.36, -6.675) | visible |
| bg-023 | 2.96–26.04 | (27.872875, -6.675) | visible |
| bg-031 | 11.56–46.04 | (-97.498667, -10.425) | visible |
| bg-035 | 15.8–50.92 | (-125.491, -6.675) | visible |
| bg-036 | 16.24–51.36 | (-134.422875, -10.425) | visible |

The fallback remains `hand-verified-a9-v1`, 59.92 s / 78 objects / three lanes / 22.3 s contact. Its source positions and lane geometry remain insufficient for final acceptance; W1/W2 + coordinator own the real replacement. Manual review of exact source frames 212/213 (16.96/17.04 s) and the 15/17/20/24 s source-vs-overview PNGs confirms pre-impact traffic is drawn but does not validate source alignment or the old crash trajectory.

The strict test exposed a separate genuine removal: `engine.ts:33,187` filters eight `motorcycle` objects from the regenerated synthetic measured fixture. As of the W4 run they are `t036,t051,t067,t076,t079,t089,t101,t105`. The planner retains 132 objects; the layout retains 124. The test intentionally reports this failure instead of hiding the unsupported objects from its expected set. W3 owns the engine/builder resolution.

Also flagged to W3: the new builder's road ends are ±850 m but `engine.ts` still caps site width at 400 m. Posed tracks beyond the site can be outside the drawn road; numerical pose coverage cannot certify road/frustum visibility.

The old source-camera harness had a flipped optical-axis Y component and inferred registration from a hardcoded van reference. Its original 2026-11-15T15:11 comparison images are invalid evidence for source registration.

## Implementation

- `src/gemini/motion.ts:103`: direct keyframe lookup at any requested time, linear position and shortest-angle heading interpolation, including irregular/non-50-Hz-aligned samples. Removed obsolete queue, lane snapping, relocation/removal and contact simulation code. Replay is independent of lane hints, forces, contacts, seed and sample provenance.
- `src/gemini/motion.ts:154`: only an already stopped crash participant whose observations end after contact gets a labelled `occluded-rest` hold. A moving vehicle leaving view is not frozen.
- `src/gemini/motion.ts:194`: keyframe bounds control playback, including edge/out-of-view/occluded samples; observation-only visibility metadata cannot suppress them. Planning no longer mutates the input evidence.
- `src/scene/mountScene.ts:188,759`: retained optional camera FOV support; reset/home restore 32 degrees. No impact/involvement-based render gate was added.
- `tests/motion-observations.test.ts:4`: fixture path is relative to the test module, so the requested command works from the app directory.
- `tests/playback-visibility.test.ts:46`: independent visibility and pose oracle through planner, engine layout and scene metadata at 0/10/15/17/20/24/28/31.92 s; every keyframe and interval midpoint checked at 1e-8 m/radian tolerance. Includes all provenance types, early extrapolation despite narrow metadata, lateral wiggles, heading wrap, ignored lane hints/forces/contact positions, input immutability, held wreck and moving exit.
- `tests/render/source-camera.ts:18`: camera position/direction use actual builder X_REF/Y_median; world optical axis maps as `(-X, Z, -Y)`. No van-anchor inference.
- `tests/render/viewer.ts:22`: reads `<spec>.build.json` (also supports replacing `.json` with `.build.json`), hashes the actual loaded files, rejects stale spec metadata and real-calibration mismatches, refuses a clamped source camera. Missing mapping permits an explicitly labelled overview only. About 0.17 degrees of camera roll is not applied; this harness is not a subpixel reprojection test.
- `tests/playback-camera.test.ts`: optical-axis centre-projection regression against the calibrated matrix.
- `tests/playback-render.mjs`: Linux agent-browser runner, its own session, free port >=5199, Vite HMR disabled, separately issued GPU render calls for the shared CPU, source crops, screenshots/poses/coverage/errors/input hashes, and browser/server cleanup. It never starts Electron. `sourceFidelityAccepted` stays false for human/coordinator review.

No shared spec fields were added.

## Verification and rerun

From `/home/rayan/Developer/projects/sunhacks/FrontEnd/app`:

```sh
npx tsx --tsconfig tsconfig.json tests/motion-observations.test.ts
npx tsx --tsconfig tsconfig.json tests/playback-camera.test.ts
npx tsx --tsconfig tsconfig.json tests/playback-visibility.test.ts
npx tsc -b
node tests/playback-render.mjs --overview-only demo fixture
```

The observation regression, camera regression, fallback visibility/pose checks and tsc passed. The completed Linux browser run saved and W4 inspected all eight source-vs-overview comparisons (demo and synthetic fixture at 15/17/20/24 s), with zero console errors and zero page errors. Its expected exit code is 1 because the synthetic fixture loses eight objects (123/131 at 15 s, 124/132 at 17/20/24 s). The test port 5199 is closed and its agent-browser session is closed. Render status generated 2026-11-15T15:32:07.741Z; no final source-fidelity acceptance is claimed. The default two-spec visibility test currently fails on the eight filtered synthetic motorcycle tracks described above. `playback-visibility-status.json` and `playback-render-status.json` record the exact tested inputs; these files are overwritten by each corresponding command.

Fallback visible counts at the eight requested times: **21,23,24,24,22,27,25,25**. At 17 s, the 20 crash-side IDs are `white-van,yellow-car,bg-007,bg-008,bg-009,bg-010,bg-016,bg-017,bg-018,bg-021,bg-022,bg-023,bg-025,bg-026,bg-029,bg-031,bg-032,bg-034,bg-035,bg-036`.

For final real integration, rerun the default visibility test after the coordinator replaces `electron/demo-incident/incident-spec.json`, and run:

```sh
node tests/playback-render.mjs --require-source demo
```

That requires the matching `electron/demo-incident/incident-spec.json.build.json` emitted by W3 (X_REF, Y_median, output hash and calibration provenance). Outputs are `tests/playback-compare-demo-{15,17,20,24}.png`, `playback-overview-demo-*.png`, exact `playback-source-frame-{212,213}.png`, and `playback-render-status.json`. Synthetic renders are labelled by the sidecar and never count as final real-data acceptance. The coordinator owns final measured-scene visual validation.

Latest tested hashes: production fallback `c5f8d73199e42a1944632b4d8d47b1e43127afa300ed6b75d4a5e41c76e5fff3`; synthetic measured fixture `663a99d9a8f4c3234d30be87943d2e4e2ed36b7f3a6f334275bda16b354bac59`.
