# W3 measured-builder integration checks

**Everything in `tracks_world.json`, `crash_pair.json`, `divider.json`, and the resulting `incident-spec.json` here is synthetic.** These exercise integration; they are not measurements of the crash. `br_camera.json` contains the real measured cross-section to exercise all six crash-side strips. Real median geometry is in `../data/divider.json`.

Run from repository root:

```sh
.venv/bin/python FrontEnd/app/electron/demo-incident/measure/divider.py
.venv/bin/python FrontEnd/app/electron/demo-incident/measure/divider_overlay.py 0 296 360
.venv/bin/python FrontEnd/app/electron/demo-incident/measure/review_spec/make_synthetic.py
.venv/bin/python FrontEnd/app/electron/demo-incident/build-measured-spec.py --data FrontEnd/app/electron/demo-incident/measure/review_spec --out FrontEnd/app/electron/demo-incident/measure/review_spec/incident-spec.json
```

Run from `FrontEnd/app`:

```sh
../../packages/assistant/node_modules/.bin/tsx --tsconfig tsconfig.json electron/demo-incident/engine-check.mts electron/demo-incident/measure/review_spec/incident-spec.json
../../packages/assistant/node_modules/.bin/tsx --tsconfig tsconfig.json electron/demo-incident/measure/review_spec/engine-check-measured.mts
npx tsc -b
```

`engine-check-measured.json` and `engine-check.log` record the checks. These cover exact poses at keyframes, unmodified source observations and provenance, stable IDs and hashes, lane-bound extrapolation, road paint offsets, static mesh/footprint agreement, first-contact geometry, normal direction and infinite-mass response, and kinematics static/contact retention. Final integration also requires every fixture object to reach the renderer. Motorcycles use a two-wheel proxy; measured mesh footprints match supplied lengths and widths. The strict `tests/playback-visibility.test.ts` checks all 132 identities and every keyframe/midpoint.

The builder emits `<output>.build.json` with `X_REF`, `Y_median`, `source_track_to_spec_id`, source absolute paths and SHA-256s, source video hash, output hash, and explicit W→plan→Three.js transforms. Downstream reprojection must use these values, not fit another van anchor or regex builder globals. Background IDs are retained verbatim except collisions with reserved/static IDs, whose deterministic suffix is recorded. Normals point **from a into b**; W `(nx, ny)` becomes plan `(-nx, ny)`, then scene `(-nx, 0, -ny)`. Static objects have inverse mass zero and zero motion.

Synthetic fixtures and the explicit `--extend-background-edges` diagnostic option use constant endpoint along-road velocity and fixed endpoint Y, and stops at the drawn ±850 m road ends or video frames 0/399. It never changes observed samples or extends the crash pair. `edge-extrapolated` labels and growing position uncertainty distinguish these samples. Contacts default to `inferred` unless explicitly labeled measured; impulses are optional. A moving or out-of-view vehicle gets no invented resting pose. Real production defaults to audited source spans: unrestricted extension was found to create unsupported in-camera traffic and is disabled there.

The main impact marker (`crash.start_s`) follows the first vehicle-vehicle contact when present. Earlier soft-verge entry remains a separately timed vehicle-static contact. Undefined/null impulses stay absent in the emitted spec; no zero impulse is fabricated.

`browser-geometry.html` is an agent-browser geometry check using the real road/median and a synthetic scene template. It does not launch Electron, access MongoDB or depict real traffic. Its screenshots show the low near verge, separate far-side barrier and separate uncertain far-section hedge. The generated JS can be recreated from `FrontEnd/app`:

```sh
node_modules/.bin/esbuild electron/demo-incident/measure/review_spec/browser-geometry.ts --bundle --format=iife --target=es2022 --define:import.meta.env.BASE_URL='"file:///home/rayan/Developer/projects/sunhacks/FrontEnd/app/public/"' --outfile=electron/demo-incident/measure/review_spec/browser-geometry.js
agent-browser --session w3-geometry --allow-file-access --args '--use-gl=angle,--use-angle=swiftshader,--enable-unsafe-swiftshader' open file:///home/rayan/Developer/projects/sunhacks/FrontEnd/app/electron/demo-incident/measure/review_spec/browser-geometry.html
agent-browser --session w3-geometry snapshot -i
agent-browser --session w3-geometry close
```

Real assembly remains the coordinator's responsibility. W3 must never overwrite `../../incident-spec.json`. If real `../data/tracks_world.json` and `../data/crash_pair.json` exist, build with `--data .../measure/data --out .../measure/review_spec/real-preview-incident-spec.json` and run the measured check with that path.

Near-crash median measurements: W crash-side face Y=-8.637 m; far face Y=-5.025 m; visible X=55.5..158.875 m; height estimate 0.15±0.15 m. The separate far-side barrier spans Y=-5.025..-4.725, height 0.536±0.20 m; concrete versus steel and hidden thickness are unresolved. The far dark band beyond X≈159 m is modeled as an inferred 0.5 m hedge, possibly a shaded barrier. Friction/restitution/stiffness are assumed material parameters, not measurements. No tall hedge is inferred at the actual crash site.
