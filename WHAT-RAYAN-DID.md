# What Rayan completed

2026-11-15 · branch `testing` · continuation of `39e2fec`.

The old 59.92-second fallback has been replaced with the real measured first 32 seconds: **141 vehicle tracks, 10,732 source samples, three fixed median objects and two qualified contacts**. Playback, stored vectors and assistant queries now use those trajectories. Source coverage and physical accuracy remain qualified below; this is ready for the user's next visual test, not a claim of complete traffic recall.

## Reconstruction and integration

The five interrupted workstreams were recovered without resetting the shared checkout. Development resumed on **Sol xhigh, standard service tier**. Application reconstruction remains authenticated **Terra xhigh**. The final independent review ran on **Sol medium**, explicitly configured and returned by the orchestrator with **serviceTier=default**. The reviewer could not independently attest billing tier; no priority/fast setting was used.

- W1 reviewed duplicate identities and wireframe component fits, reducing 168 tracks to 141. All **9,090 original fitted observations** remain as canonical/alternate/reserved/excluded evidence. All **649 authoritative crash-pair samples** remain unchanged. The manual census covers nine source frames and records exact per-lane deltas, inferred tracks and uncertain silhouettes.
- W2 recovered the yellow car's lane-1 → lane-2 → lane-1 approach, sharp return/rotation, inferred van contact at **f291 ±1 / 23.28 s**, van travel of approximately **18.1 m**, and the retained occluded aftermath. Soft-verge entry at **f283 ±2 / 22.64 s** has no identifiable impulse; none was fabricated.
- W3 supplied six measured crash-side strips, asymmetric paint offsets, a low near verge, separate barrier and uncertain far hedge. Fixed geometry is rendered with the same footprints/normals used by collision and database metadata. Material/contact parameters remain assumptions.
- Replay retains every supplied keyframe and heading, with linear position/shortest-heading interpolation. It does not generate a queue, relocate vehicles or simulate an invented pile-up. Strict visibility tests cover every keyframe and midpoint. The eight synthetic motorcycles now have an actual two-wheel proxy; measured length/width/height are preserved by proxy scaling.
- The measured ±850 m road, site bounds, camera limits and terrain now agree. Source comparisons use hashed build metadata, the calibrated optical axis and roll, exact source frames and exact odd-pixel crop.
- The production comparison exposed an integration defect: road-end extension added **51 unsupported in-frame vehicles at f213**. Real production now uses the audited source spans and contains **zero edge-extrapolated samples**. The extension remains an explicit diagnostic option and a synthetic regression fixture. First reliable detection can therefore appear inside the image; no unsupported run-in identity is claimed.
- Both allowlisted videos and saved/legacy demo scenes reload the disk spec. Content hashing invalidates stale analyses and vectors. Per-frame rows preserve source provenance/position sigma, body heading, static zero motion and contacts. Assistant queries return the stored vectors and carry the source caveats.
- The reproduced Mongo duplicate-key race is fixed with per-incident serialization, normalized frame times, deduplicated input, revisioned upserts and interrupted-sync recovery. Tests use disposable Mongo databases.

The production spec SHA-256 is `38515829d0c5234dc23322d9fb4f33c5013ac9039b4d358d5ea99d7d7442f6f1`. Its matching `.build.json` hashes the actual inputs, frozen tracking review, builder and output. W1 final pixel/world hashes are respectively `4e942dcc6e5bb334280e61204781d30da02a35f67f4d3e964099226dac2f9781` and `6fa064d1f37e9f9abdadb9182054225f99bb3cddc6352a5cef10db825d14a464`.

## Checks and evidence

All **16 verification groups passed** in `FrontEnd/app/tests/final-verification.json`: current real input/output/upstream hashes, schema, every observation and midpoint, calibrated camera, **10,732 real pose checks / 11,932 disposable-Mongo rows**, actual assistant queries, concurrent/interrupted sync recovery, both upload hashes and saved/legacy reload, production geometry/kinematics, five collision tests, assistant typecheck and **65 assistant tests**, and production build. The build reports existing large-chunk and dependency-annotation warnings. All **23 browser checkpoints** also passed supplied-track coverage with zero recorded console/page errors, across six hash-consistent batches. All source/viewer pairs were inspected. The source-census deficits and approximate proxy occlusion remain separate from these implementation checks.

Evidence locations:

- `FrontEnd/app/electron/demo-incident/measure/review_tracks/REVIEW-COMPLETE.md`: final tracking audit, manual lane census, corrections, exact hashes, residual gaps and reproduction commands.
- `FrontEnd/app/electron/demo-incident/measure/review_crash/README.md`, `report.json`, `validation.json`, overlays: contact, lane sequence, van motion, hidden wreck and uncertainty evidence.
- `FrontEnd/app/electron/demo-incident/measure/review/final/integrity.json`: current source→spec integrity; `reprojection/errors.json` and `summary.txt`: all 400 frames, with diagnostic nearest-annotation residuals. These are not one-to-one identity/recall scores. `extrapolation-before.json` records the superseded integration defect.
- `FrontEnd/app/tests/final-playback/README.md` and `playback-render-status.json`: final source/viewer inspection and exact input hashes. Frames cover f0,125,188,212,213,250,281–294,300,350,399. Historical fallback/synthetic screenshots are not final acceptance.
- `FrontEnd/app/tests/measured-clip-status.json`: actual production spec→viewer poses→disposable Mongo→actual assistant controller.
- `FrontEnd/app/tests/final-review.md`: independent Sol-medium review and limits; `final-review-run.json` records orchestrator settings.

Review thread: [Independent final measured reconstruction review — Sol medium standard](t3-thread://v2/6601a15e-2a4c-4aed-a511-f40fbc810ad2/thread:delegated-task:command%3Amcp%3Ab942fe11-79c9-4163-aebf-3f15672fe424%3Adelegate-task%3A36783ea8-bddd-42bc-b41b-e7a2e2fb2b0b).

## Remaining uncertainty for the next test

These limitations are preserved in production caveats and assistant results, not hidden by passing tests:

- The unboxed brown truck and some clipped left-edge vehicles still lack secure tracks. Possible occluded/cross-class duplicates remain. Full source traffic recall has not been established.
- In the W1 source-body census, f212 has **31 retained vs 26 primary visible marks** (six inferred); f213 has **31 vs 25** (four inferred). f399 has **22 vs 24**, including the hidden yellow wreck; measured count is 21. Equal totals at f300/f350 do not establish correct identities. These counts precede assembly and are distinct from total scene visibility or projected-centre diagnostics.
- Yellow identity before f151 is unresolved. Repeated small early wiggles and overtaking intent are not established. Its f319–399 `occluded-rest` hold has sigma **3→5 m**; precise hidden rest/time and spin heading remain uncertain.
- Verge encroachment does not prove a rigid bush/barrier collision. No van/verge or far-barrier contact is supported. The missing static impulse means unknown, not zero.
- Horizon depth, class, dimensions, lane membership and derivatives remain uncertain. The highest fitted background speed, **61.6 m/s on c134**, is unvalidated physical truth. Masses/material parameters are assumed. Net force = mass × playback acceleration is a consistency check; it does not validate true contact forces. Derivative uncertainty is not quantified by position sigma.
- Proxy body styles, terrain, snow and distant road layout are approximations. A browser coverage pass establishes that supplied observations render; the user decides visual acceptance.

## Delivery

The independent review found **no blocking implementation findings** and passed focused replay/schema/camera/routing, actual assistant-vector and disposable Mongo race/recovery checks. It verified current hashes and all saved final evidence while leaving source fidelity unaccepted. Its scope and limits are in `FrontEnd/app/tests/final-review.md`.

Delivery branch: `testing`; commit message: `complete measured reconstruction and verification`. The commit includes the handoff, this summary, final sources/spec/sidecar, implementation, checks and appropriate evidence. The branch Git history records the delivered commit. No Electron app was launched/restarted/terminated; no real database was changed. The browser harness owns and closes its server/session. Large tile/numpy caches, duplicate reproduction data and superseded diagnostics are preserved locally under scoped ignores.
