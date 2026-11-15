# Independent final review — 2026-11-15

Verdict: **No blocking implementation findings identified in the reviewed integration.** No new concrete defect or false source-fidelity acceptance claim was established. This is a qualified implementation review, not acceptance of source recall, identities, reconstructed physics or visual similarity.

## Scope and settings

Reviewed the shared `testing` working tree against baseline `39e2fec`, including current HANDOFF.md, WHAT-RAYAN-DID.md and frozen measure/review_tracks/REVIEW-COMPLETE.md. Review performed directly, with no delegates. Runtime identifies GPT-6.1 Sol, medium effort. Requested service setting: STANDARD (`serviceTier=default`); the running harness does not expose a tier-control or billing attestation to this reviewer, so the actual service tier cannot independently be certified here. No priority/fast call or additional model run was requested by this review.

Tested production spec SHA-256: `38515829d0c5234dc23322d9fb4f33c5013ac9039b4d358d5ea99d7d7442f6f1`.
Matching `.build.json` SHA-256: `349c4e81e89d20adb627cdb755e63046c9d48552b7dde218adb52f4f9399f2d0`.
Independent checks confirmed real inputs, all sidecar source/builder/video hashes, 141 vehicles, 10,732 keyframes, three static objects, two contacts, `synthetic=false`, `omit_opposing=true`, `background_edge_extrapolation=false`, and zero extrapolated keyframes.

## Review and independent checks

Inspected builder routing and caveat propagation; schema retention; exact keyframe replay and visibility; engine dimensions/motorcycle support; scene bounds/camera; static footprint extrusion/collision metadata; derivation/contact conversion; Mongo serialization, revision cleanup and recovery; demo upload/legacy restore routing; renderer invalidation; and assistant data/contact/force paths.

Focused commands were run from repository root using `packages/assistant/node_modules/.bin/tsx --tsconfig FrontEnd/app/tsconfig.json`:

- `FrontEnd/app/tests/spec-measured.test.ts` — passed geometry, provenance, static/contact round-trip and invalid-geometry rejection.
- `FrontEnd/app/tests/motion-observations.test.ts` — passed retention of 131 overlapping tracks, keyframes and crash timing.
- `FrontEnd/app/tests/playback-camera.test.ts` — passed calibrated projection, optical-axis sign, roll and builder transform.
- `FrontEnd/app/tests/kinematics-playback.test.ts` — passed 1,751 synthetic rows on the 400-frame grid, visibility, derivatives, mass/force consistency, static zero motion, contacts, provenance and rebuild invalidation; actual assistant controller checks passed stored vectors, body heading, contacts, frame seeks and rejection paths.
- `FrontEnd/app/tests/kinematics-sync.test.ts` — passed with a newly created disposable Mongo instance: reproduced old duplicate-key race, concurrent identical and changed-revision syncs, legacy revision cleanup, duplicate/float-time normalization, finite/frame validation, no-op and interrupted-sync recovery.
- `node FrontEnd/app/tests/gemini-demo-routing.test.mjs` — passed both allowlisted hashes, measured labels, upload, saved/legacy reload, contacts/statics and content invalidation.

A separate read-only Python audit verified current output and upstream hashes, counts and absence of edge extrapolation. It also verified all 16 saved final-verification groups pass against the tested spec and that all current render-code hashes match the browser report. All 23 required browser frames occur across six completed runs of the same spec, with no recorded console/page errors and `sourceFidelityAccepted=false`.

The existing full evidence records 1,170 integrity assertions, 10,732 actual pose checks / 11,932 disposable Mongo rows, 65 assistant tests, production build, routing, geometry and collision checks. These totals are existing evidence, not a claim that this review reran the entire suite. Tests that rewrite status artifacts were deliberately not rerun. Strict visibility assertions remain present; the shortest-angle implementation uses the documented `[-180,180)` tie convention rather than weakening the oracle.

## Visual evidence and acceptance claims

Inspected saved full source/viewer comparisons at f213, f283, f291 and f399 and the contact-281-286, contact-287-292 and aftermath sheets. They support replay continuity and show approximate proxy shape/occlusion, background gaps and different surroundings. They do not establish exact surface contact, source identity completeness or precise hidden rest. No new browser session/capture was necessary.

Current handoff, completion notes and browser README distinguish supplied-track coverage from source acceptance. The production default correctly removes the earlier 51 unsupported f213 in-frame vehicles caused by endpoint extension. Synthetic fixtures and explicit `--extend-background-edges` retain diagnostic coverage with labels. W1 body intersections, production projected-centre counts and primary eye marks are different measures; their differing counts are disclosed rather than used as an acceptance pass.

## Measurement limits that remain open

These are known source limitations, not newly discovered implementation regressions:

- Unboxed brown truck and clipped vehicle gaps; possible occluded/cross-class duplicates. W1 f212: 31 retained versus 26 primary marks; f213: 31 versus 25. End deficit at f399: 22 retained versus 24 primary marks, with only 21 measured-visible and the hidden yellow wreck retained.
- c134's maximum fitted 61.6 m/s remains unvalidated; horizon class, depth, dimensions, lane and derivative estimates remain provisional. Position sigma does not quantify derivative uncertainty.
- Yellow identity before f151 remains uncertain. The f319–399 occluded-rest hold has increasing position uncertainty; continued hidden movement and uncertain final heading/rest time remain possible.
- Vehicle contact f291 ±1 is inferred behind the van. Soft-verge entry f283 ±2 does not prove a rigid barrier strike. Its omitted impulse means unknown, not zero. No van/verge or far-barrier contact is established.
- Approximate 18.1 m van travel is retained. Masses, material coefficients, derivative-based net force and force decomposition remain assumptions/model results rather than instrumented contact measurements.

No correction is requested for these limitations within this review; retain the qualifications in production and assistant results. User visual acceptance and desktop behavior after a user-controlled restart remain unverified.

## Review limits and write scope

No Electron process was launched, restarted or terminated; no real database was connected to or changed; no live model analysis, git mutation, implementation edit or tracking edit was performed. Only this review report was written in the repository. The disposable Mongo test downloaded its runtime binary and closed its own instance. Source extraction/calibration and every identity were not independently remeasured. Multi-process database writers and crash-time power-loss guarantees were not certified; reviewed serialization addresses the single Electron-process integration. Root retains commit/push ownership.
