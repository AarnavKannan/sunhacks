# Final measured source/viewer review

Source is the hashed `demo_32s.mp4`, exact crop (481,304,479,300), 12.5 fps. Production spec SHA-256: `38515829d0c5234dc23322d9fb4f33c5013ac9039b4d358d5ea99d7d7442f6f1`. The viewer uses the matching builder transform, calibrated optical axis and roll, and supplied vehicle dimensions. Opposing traffic is omitted. No Electron app or real database is involved.

All **23 checkpoints passed** in `playback-render-status.json`, across six completed batches, with zero recorded console/page errors. Batches must agree on spec, sidecar and render-code hashes; `passed` requires all 23 requested source frames, full supplied-track pose/visibility coverage and no recorded console/page errors. `sourceFidelityAccepted:false` deliberately preserves the separate visual/measurement acceptance decision. Partial runs interrupted by SIGTERM were superseded by resumed batches; no partial result is an acceptance pass.

Every `playback-compare-demo-fNNN.png` has source left, actual Three.js viewer right. `playback-overview-demo-fNNN.png` shows the same instant from an overview. Exact source times are f/12.5: the 15-second comparison is f188/15.04s; f212/16.96s and f213/17.04s bracket 17 seconds.

## Inspection and practical limits

- Before impact, traffic now renders at source times 0,10,15.04,16.96,17.04 and20 seconds. There is no impact-time appearance gate. Source-body counts and identities remain qualified by the W1 audit; equal totals are not proof of recall.
- f281–286 preserve the yellow car's sharp return/rotation toward the near verge while the van is stationary. The f283 soft-verge event is inferred, ±2 frames, with unknown impulse. The model does not assert a rigid hedge/barrier strike.
- f287–294 preserve the rotating return and inferred rear/median-side contact at f291/23.28s. The touching surfaces remain hidden; proxy shape, apparent occlusion and body yaw differ from the source within the documented fitting limits.
- f300/24s shows van translation and a partially visible yellow car. At f350/28s and f399/31.92s, the van remains clipped at the lower-left boundary; the yellow wreck is retained behind it. Its exact final pose/time is not observed.
- All 23 source/viewer pairs were inspected, including `contact-281-286.jpg`, `contact-287-292.jpg` and `aftermath.jpg`; representative full-resolution pairs were inspected separately. The overview confirms distinct fixed objects and continued traffic, with no generated universal queue.
- The near verge is low; the far-side barrier and distant hedge band are separate. Snow, terrain, trees, paint phase and proxy body styles/shading are approximate. Empty opposing lanes are the authorized scope reduction.
- First reliable observations can begin inside the image. Unsupported road-end extension is disabled in production. The initial assembly projected 81 vehicle centres into the tile at f213, including 51 extrapolated samples; final production projects 30 centres there, with zero edge extrapolation. This centre-based diagnostic differs from W1's body-intersection count of31 and primary eye count25.
- W1 retains unresolved unboxed brown-truck and clipped-edge gaps, possible occluded/cross-class duplicates, and weak horizon classes/depth/lane/velocity. f399 source-census deficit remains. See `../../electron/demo-incident/measure/review_tracks/REVIEW-COMPLETE.md` for exact per-lane counts, differences and uncertainties.
- The all-frame reprojection report's median16.8px/p90 51.2px values are nearest connected-color-component diagnostics. Adjacent annotations merge, boxes clip, multiple models can select one component, and opposing traffic is included. These values are not identity/recall or physical accuracy metrics. The tracking report's ~0.70px fit diagnostic likewise measures agreement with its fitted input boxes, not independent world truth.

## Reproduce

From `FrontEnd/app`:

```sh
node tests/playback-render.mjs --require-source --out=tests/final-playback demo
```

On a runner with a short process lifetime, capture smaller sets with `--frames=... --all-checkpoints`; start without `--resume`, then add `--resume` to later sets. The report remains incomplete until all default frames are present. Each invocation owns and closes its browser session and temporary Vite server.

Do not use old root-level `playback-*` screenshots, the old W4 report or synthetic fixture pictures as real source acceptance. The user must test the desktop app after a user-controlled restart to load backend changes; none was performed here.
