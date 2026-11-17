# W1 tracking audit complete — 2026-11-15

W1 measurement work is finished and its data is stable for integration. **Coverage and physical accuracy are not certified.** The independent source census has residual differences, documented below. Production assembly, app acceptance, independent final review, documentation and commit/push belong to the integration thread. No git mutation, Electron launch/restart or database change was performed here.

Final outputs: **141 tracks / 10,732 samples** (baseline 168 / 11,184). All **9,090 fitted source observations** remain exactly represented in canonical samples, simultaneous alternatives, reserved crash silhouettes or excluded evidence. The authoritative crash pair retains all **649 original samples** unchanged. Lower track counts result from reviewed duplicates and unsupported component fits, not removed real traffic.

## Manual source census and exact primary deltas

The audit visually enumerated the source silhouettes on the nine requested frames. `manual_census.py` contains the hand-entered marks; `eye/manual_fNNN.png` displays them on the source; `eye_counts.json` contains their coordinates, descriptions, possible lanes and separability flags. Counts were not copied from raw detector totals. The source already contains burned-in wireframes. These are visual counts by this audit, not a second human or delegated reviewer.

The marks are approximate road-footprint anchors for counting, not new trajectory measurements. Lane membership uses the measured painted-line calibration. Lane vectors below are **[L0, L1, L2, L3, L4, L5, L6, L7]**: L1 is median-adjacent; L6 outermost; L0/L7 lie beyond the straight inner/outer line. Delta is **delivered tracks minus primary eye count**. Delivered count means the reprojected body intersects the tile; it includes retained inferred/hidden vehicles.

| Frame / source time | Eye per lane | Delivered per lane | Exact primary delta | Eye / delivered totals |
|---|---|---|---|---|
| f0 / 0.00s | `[0, 4, 9, 3, 4, 2, 1, 2]` | `[0, 4, 10, 2, 4, 2, 2, 1]` | `[0, 0, 1, -1, 0, 0, 1, -1]` | 25 / 25 (+0) |
| f125 / 10.00s | `[0, 6, 6, 6, 2, 1, 1, 1]` | `[0, 5, 7, 5, 3, 2, 2, 1]` | `[0, -1, 1, -1, 1, 1, 1, 0]` | 23 / 25 (+2) |
| f188 / 15.04s | `[0, 6, 6, 5, 4, 0, 2, 0]` | `[0, 7, 6, 5, 5, 0, 2, 0]` | `[0, 1, 0, 0, 1, 0, 0, 0]` | 23 / 25 (+2) |
| f212 / 16.96s | `[0, 6, 7, 4, 5, 1, 3, 0]` | `[0, 7, 6, 6, 5, 1, 4, 2]` | `[0, 1, -1, 2, 0, 0, 1, 2]` | 26 / 31 (+5) |
| f213 / 17.04s | `[0, 6, 6, 4, 5, 1, 3, 0]` | `[0, 7, 6, 6, 4, 2, 4, 2]` | `[0, 1, 0, 2, -1, 1, 1, 2]` | 25 / 31 (+6) |
| f250 / 20.00s | `[0, 7, 6, 6, 4, 1, 2, 0]` | `[0, 8, 5, 6, 3, 3, 4, 0]` | `[0, 1, -1, 0, -1, 2, 2, 0]` | 26 / 29 (+3) |
| f300 / 24.00s | `[0, 6, 2, 4, 1, 6, 0, 0]` | `[0, 6, 2, 4, 2, 4, 0, 1]` | `[0, 0, 0, 0, 1, -2, 0, 1]` | 19 / 19 (+0) |
| f350 / 28.00s | `[0, 6, 4, 6, 3, 3, 1, 0]` | `[0, 6, 3, 6, 3, 3, 2, 0]` | `[0, 0, -1, 0, 0, 0, 1, 0]` | 23 / 23 (+0) |
| f399 / 31.92s | `[0, 6, 5, 5, 5, 2, 1, 0]` | `[0, 5, 4, 6, 5, 2, 0, 0]` | `[0, -1, -1, 1, 0, 0, -1, 0]` | 24 / 22 (-2) |

| Frame | Source-mark total | Delivered measured | Delivered inferred/hidden |
|---|---:|---:|---|
| 0 | 25 | 25 | 0: none |
| 125 | 23 | 20 | 5: c038, c060, c066, c067, c068 |
| 188 | 23 | 22 | 3: c075, c078, c083 |
| 212 | 26 | 25 | 6: c030, c083, c084, c086, c092, c094 |
| 213 | 25 | 27 | 4: c083, c084, c086, c094 |
| 250 | 26 | 23 | 6: c050, c091, c094, c106, c107, c110 |
| 300 | 19 | 18 | 1: c114 |
| 350 | 23 | 20 | 3: c123, c133, yellow-car |
| 399 | 24 | 21 | 1: yellow-car |

`lane_counts.json` also records measured-only per-lane counts/deltas and the full per-lane assignment bounds. Those bounds allow the **same marks** to move among plausible lanes; they are not confidence intervals or bounds on complete traffic recall. `uncertain_silhouette_marks` identifies individual top/overlap marks whose separability can change the total. `count_excluding_uncertain_silhouettes` provides a conservative count after excluding those marks, not an alternate invented vehicle list. Fully hidden and subpixel vehicles remain uncountable.

f188 is 15.04s; f212 is 16.96s and f213 is 17.04s. There is no exact 17.00s source frame on the 12.5 fps grid. Opposing traffic is outside this census. The yellow wreck is excluded from the visible eye census at f350/f399 and retained in world data as `occluded-rest`. **Equal totals at f0/f300/f350 do not establish identity recall**: misses, inference and lane errors can cancel.

## Evidence-supported corrections

`identity_corrections.json` is a checked case manifest. It verifies the original track fingerprints and detector hash before applying changes, keeps stable canonical IDs, and refuses to apply silently to changed source detections. The contact sheets referenced in that manifest show the original competing fits on the source sequence.

| Canonical ID | Merged fragments | Evidence / limitation |
|---|---|---|
| c009 | c032 | Same inspected source silhouette; simultaneous fitted positions retained as alternatives. |
| c010 | c039, c047, c057 | Continuous white-car approach and lateral transition preserved through the merged observed span. |
| c013 | c042 | Same inspected source silhouette; simultaneous fitted positions retained as alternatives. |
| c059 | c079 | Same inspected source silhouette; simultaneous fitted positions retained as alternatives. |
| c064 | c085 | Same inspected source silhouette; simultaneous fitted positions retained as alternatives. |
| c077 | c102, c119, c128 | Median approach continues to the car later moving laterally; c128 was a duplicate at f297–302. |
| c108 | c151 | Same inspected source silhouette; simultaneous fitted positions retained as alternatives. |
| c149 | c150 | Same inspected source silhouette; simultaneous fitted positions retained as alternatives. |
| c147 | c159 | Same inspected source silhouette; simultaneous fitted positions retained as alternatives. |
| c087 | c165 | Same inspected source silhouette; simultaneous fitted positions retained as alternatives. |
| c082 | c141 | Same inspected source silhouette; simultaneous fitted positions retained as alternatives. |
| c073 | c121 | Same inspected source silhouette; simultaneous fitted positions retained as alternatives. |
| c026 | c144 | Same inspected source silhouette; simultaneous fitted positions retained as alternatives. |
| c090 | c100 | Same inspected source silhouette; simultaneous fitted positions retained as alternatives. |
| c113 | c112 | Same inspected source silhouette; simultaneous fitted positions retained as alternatives. |
| c051 | c069 | c069 through f135 only. Later fits remain unassigned evidence; the inferred reverse linkage was removed. |

- `c127`, `c137`, `c138` cover the crash white van front/body after impact, including clipped fits. They are stored under `reserved_crash_silhouette_tracks`; they do not create additional traffic. No authoritative crash sample was replaced by their approximate box fits.
- `c029`, `c098`, `c111`, `c163` are small car fits on green truck wireframe faces/edges without independent car bodies. Their full fitted observations remain under `excluded_source_part_tracks`. The unassigned later `c069` observations are also stored there with `exclusion_kind=unassigned-association`.
- All 9,090 measured fit records survive the exact before/after evidence-multiset assertion. New interpolated samples connect retained observations only; no lane snapping, fabricated lane changes, fabricated source positions or synthetic traffic was added.
- The final same-class overlap scan has zero candidates under its stated threshold. This scan is a review aid and does **not** exclude cross-class duplicates, marginal overlap, occluded fragments or identity switches below its threshold.

## Kinematics and clipped/horizon review

The previous short-horizon least-squares slope was installed as a confident initial velocity and its measurements were then reused by the filter. Background conversion now starts from the explicit weak prior vx = −18 ±18 m/s and vy = 0 ±2 m/s (one sigma), uses each position observation with camera covariance, and reports conditional `sigma_v_mps`. This is a model assumption, not a speed limit. Raw fitted positions are preserved in the pixel data.

Clipped boxes now include uncertainty for missing body faces. On `c073` this removes the unsupported late positive-X reversal and the 24.7 m/s² endpoint spike; the retained end remains toward-camera motion. Cartesian forces use the stored rounded mass and acceleration, reducing the maximum rounded force-identity residual to 0.05 N.

Final background speeds: median 22.837, p95 44.089, p99 55.672, max 61.600 m/s. Acceleration magnitude: median 0.981, p95 4.342, max 7.609 m/s². **These summaries are fitted model output, not accepted physical truth.**

`c023` formerly gave reverse ~118 m/s from four clipped horizon samples; it now gives roughly −17.8 m/s with ~17.8 m/s conditional velocity uncertainty and is prior-dependent. The former maximum ~118.75 m/s `c163` and ~106.8 m/s `c111` were component fits, not accepted moving cars.

The remaining high-speed cases were inspected in `inspect_c134.png`, `inspect_c034.png`, `inspect_c123.png`, `inspect_c078.png`. Their source fits move across tiny/partial horizon boxes, so the remaining maximum **61.6 m/s on c134 is still unvalidated**. c034 (~57.6), c123 (~56.5) and c078 (~56.0) also require this caveat. `audit_validation.json` lists every retained estimate over 45 m/s, its frame and conditional uncertainties. These uncertainties exclude association, body-dimension and calibration error. No hard speed clamp was applied, and no estimate above +3 m/s in X remains after the reviewed reverse-link corrections.

## Residual issues to carry into production caveats

1. **Visible source gaps remain.** A large unboxed dark/brown truck approaches through the background (clear at f250/f300/f350/f399; partly clipped at f212/f213). The wireframe-based detector does not establish a complete independent track for it. The clipped left-edge car slivers at f212 and f399 have no secure delivered identity. No path was manufactured to fill these gaps. See the corresponding primary manual marks/source images.
2. **Counts differ around 17s.** At f212 there are 31 delivered bodies versus 26 primary source marks, including six inferred tracks. At f213 there are 31 versus 25, including four inferred tracks. This is not a passing lane-coverage result. Inferred `c084`/`c092` near a truck, `c026`/`c094` source component associations and `c050`/`c086` around occlusion remain ambiguous; some may be retained fragments of one physical vehicle. They were not merged without sufficiently clear source identity evidence.
3. **The end-of-clip visible deficit remains.** f399 gives 22 delivered versus 24 primary source marks, while the delivered set includes the hidden yellow wreck. Its measured-visible count is 21. Horizon separability/lane uncertainty affects the exact deficit; total subtraction alone cannot identify all missing vehicles. f350 likewise includes the hidden wreck despite equal primary totals.
4. **Near-horizon class, size, speed and lane assignments remain provisional.** Some fits use only one face or a colored annotation component. No same-class scan or subpixel reprojection score validates their physical identity. c166 is a short horizon example with weak derivative information. Generic projected straight outer lanes also make L6/L7 assignment uncertain.
5. **Crash-pair limits are preserved.** Yellow identity before f151 remains unresolved; no early path was invented. Its f319–399 hidden resting pose is inferred with increased uncertainty. W2 collision/rest/heading caveats remain authoritative. No new collision, queue, pile-up or immovable-object conclusion was inferred here.

## Verification and reproduction

Passed `validate_audit.py` on the final real outputs: unique matching IDs; all observed spans consecutive on f0..399 and t=f/12.5; finite JSON samples; every measured source fit retained; 649 crash samples exactly unchanged; unchanged calibration/crash-pair hashes; exact Cartesian force identity within 0.05 N rounding; all nine eye dictionaries and lane deltas populated; no remaining overlap candidates under the diagnostic threshold. Clean regeneration into `reproduced_clean.json` is byte-for-byte identical to the delivered clean pixel file. Python compilation passed for changed measurement/audit scripts.

All 400 cached source tiles match decoded `demo_32s.mp4` exactly. The longer `demo.mp4` has different compression (mean absolute channel difference ~0.945 over those crops); the measured input is the hashed 32-second file. `source_cache_verification.json` records both. The final median source-box reprojection diagnostic is about 0.70 px; it measures agreement with fitted input boxes, not independent world accuracy or vehicle recall.

Source/provenance breakdown: 8,963 measured; 1,688 interpolated; 81 occluded-rest; zero out-of-view extrapolated in W1. 25 canonical measured fits were gated by the world smoother and marked inferred. All raw fits remain available.

From the repo root (existing .venv; no Electron or database needed):

```sh
.venv/bin/python apps/desktop/electron/demo-incident/measure/clean_tracks.py
.venv/bin/python apps/desktop/electron/demo-incident/measure/world_kinematics.py --review apps/desktop/electron/demo-incident/measure/review_tracks/world --no-render
.venv/bin/python apps/desktop/electron/demo-incident/measure/review_tracks/manual_census.py
.venv/bin/python apps/desktop/electron/demo-incident/measure/review_tracks/review.py
.venv/bin/python apps/desktop/electron/demo-incident/measure/clean_tracks.py --out apps/desktop/electron/demo-incident/measure/review_tracks/reproduced_clean.json
.venv/bin/python apps/desktop/electron/demo-incident/measure/review_tracks/identity_audit.py --out overlap_candidates_final.json
.venv/bin/python apps/desktop/electron/demo-incident/measure/review_tracks/validate_audit.py
```

`inspect_candidates.py` can render additional cases from the **current** IDs using its `render()` function. The saved `inspect_*` correction contact sheets depict pre-correction competing IDs; preserve them. Large `tiles.npy`, historical early outputs and the duplicate reproduction JSON are disposable caches/diagnostics for integration to exclude from git; no peer files were deleted.

## Final SHA-256 inputs and outputs

These hashes identify the final stable W1 data. The integration thread must rebuild production and its sidecar against these values. Complete machine-readable checks and hashes are in `audit_validation.json`.

| File (relative to repo) | SHA-256 |
|---|---|
| `demo_32s.mp4` | `62b6153f1839133d062d9f3425ebf93aae85250b8e854bdbd3eabbbfbe8dd16e` |
| `apps/desktop/electron/demo-incident/measure/data/calib_joint.json` | `9721aa4ea6a3ec01a26a4182ae74269f867dcd55a83e18832fb31b833c81cdfc` |
| `apps/desktop/electron/demo-incident/measure/data/br_camera.json` | `4bb97a34a2d610de696ce0b5eff5c3c2262e6a37202cc5bf665ce5eede3e2e5b` |
| `apps/desktop/electron/demo-incident/measure/data/crash_pair.json` | `55257fd71e3db320054cf712714cc1edf9a36bc3da0e4b48581b52ec73586f57` |
| `apps/desktop/electron/demo-incident/measure/data/tracks_px_clean.json` | `4e942dcc6e5bb334280e61204781d30da02a35f67f4d3e964099226dac2f9781` |
| `apps/desktop/electron/demo-incident/measure/data/tracks_world.json` | `6fa064d1f37e9f9abdadb9182054225f99bb3cddc6352a5cef10db825d14a464` |
| `apps/desktop/electron/demo-incident/measure/detect_track.py` | `8763ee6c1827d72fe4b6bf28074f763282ab97ff3ca61685c353630e590f1f24` |
| `apps/desktop/electron/demo-incident/measure/clean_tracks.py` | `95794ba40f91e6f5d8815db260626c0e9943f8e596aeac600654d72ec2d2d197` |
| `apps/desktop/electron/demo-incident/measure/world_kinematics.py` | `994af8ddbc5dea0e112bbd7d074605dc5e445d3483e2e65b4365e34e642f76a4` |
| `apps/desktop/electron/demo-incident/measure/review_tracks/dets.json` | `5d5c682774ee751e7cd5d0a3eeea401a921414ac52ed6a73d28d1bd58a2ec106` |
| `apps/desktop/electron/demo-incident/measure/review_tracks/identity_corrections.json` | `3eda04f7400925507ee387020d1f7a5539837e71dcb7afc8740c1d99c7627aa3` |
| `apps/desktop/electron/demo-incident/measure/review_tracks/eye_counts.json` | `bca4b72da3d6003e5421e525709cccf82e90324973c8a55b0442a667538cfbc7` |
| `apps/desktop/electron/demo-incident/measure/review_tracks/lane_counts.json` | `90e9d02c64efaddf5b332b2f43cbe6f92311be8e1afbf177abd7e597b1096216` |
| `apps/desktop/electron/demo-incident/measure/review_tracks/source_cache_verification.json` | `16f4552c41988452bf7b85336c51c25247ed7ef35ba08f95507ac165880620ac` |
| `apps/desktop/electron/demo-incident/measure/review_tracks/manual_census.py` | `724dfff2047a7f0f87adb2c813e0960da166975450af8464e280af508fa51022` |
| `apps/desktop/electron/demo-incident/measure/review_tracks/review.py` | `3eba1a9517da0a6bd9d2f6f67dd401b7dc858945d14cbe694e706d90a1233156` |
| `apps/desktop/electron/demo-incident/measure/review_tracks/validate_audit.py` | `5bddcc88a28b533c72b41523ef5261c3be242fec63b413c80f29bcf16b51b4cc` |

Integration thread: [Final integration, review and push — Sol xhigh standard](t3-thread://v2/6601a15e-2a4c-4aed-a511-f40fbc810ad2/thread:mcp:daf9172d-d51b-4a13-88b2-0c974e73f39d:sunhacks-standard-tier-continuations-2026-11-15:1). W1 hands off this audit and stops editing tracking files after notification.
