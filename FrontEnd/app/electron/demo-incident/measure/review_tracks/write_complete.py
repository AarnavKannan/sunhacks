"""Assemble the handoff from final, checked W1 evidence (does not mutate data)."""
from pathlib import Path
import json
P=Path(__file__).resolve().parent
v=json.load(open(P/'audit_validation.json'));checks=json.load(open(P/'lane_counts.json'))['checks'];stats=json.load(open(P/'verification.json'));px=json.load(open(P.parent/'data/tracks_px_clean.json'))
def vector(d):return '['+', '.join(str(d[str(l)]) for l in range(8))+']'
lines=['# W1 tracking audit complete — 2026-11-15','',
'W1 measurement work is finished and its data is stable for integration. **Coverage and physical accuracy are not certified.** The independent source census has residual differences, documented below. Production assembly, app acceptance, independent final review, documentation and commit/push belong to the integration thread. No git mutation, Electron launch/restart or database change was performed here.','',
f'Final outputs: **{v["tracks"]} tracks / {v["samples"]:,} samples** (baseline 168 / 11,184). All **{v["exact_source_fits_retained"]:,} fitted source observations** remain exactly represented in canonical samples, simultaneous alternatives, reserved crash silhouettes or excluded evidence. The authoritative crash pair retains all **{v["crash_pair_samples_unchanged"]} original samples** unchanged. Lower track counts result from reviewed duplicates and unsupported component fits, not removed real traffic.','',
'## Manual source census and exact primary deltas','',
'The audit visually enumerated the source silhouettes on the nine requested frames. `manual_census.py` contains the hand-entered marks; `eye/manual_fNNN.png` displays them on the source; `eye_counts.json` contains their coordinates, descriptions, possible lanes and separability flags. Counts were not copied from raw detector totals. The source already contains burned-in wireframes. These are visual counts by this audit, not a second human or delegated reviewer.','',
'The marks are approximate road-footprint anchors for counting, not new trajectory measurements. Lane membership uses the measured painted-line calibration. Lane vectors below are **[L0, L1, L2, L3, L4, L5, L6, L7]**: L1 is median-adjacent; L6 outermost; L0/L7 lie beyond the straight inner/outer line. Delta is **delivered tracks minus primary eye count**. Delivered count means the reprojected body intersects the tile; it includes retained inferred/hidden vehicles.','',
'| Frame / source time | Eye per lane | Delivered per lane | Exact primary delta | Eye / delivered totals |',
'|---|---|---|---|---|']
for r in checks:
 lines.append(f"| f{r['f']} / {r['source_t']:.2f}s | `{vector(r['eye']['per_lane'])}` | `{vector(r['tracks_per_lane'])}` | `{vector(r['delta_tracks_minus_eye_per_lane'])}` | {r['eye']['total']} / {r['total_tracks']} ({r['delta_tracks_minus_eye_total']:+d}) |")
lines += ['',
'| Frame | Source-mark total | Delivered measured | Delivered inferred/hidden |',
'|---|---:|---:|---|']
for r in checks:
 lines.append(f"| {r['f']} | {r['eye']['total']} | {r['measured']} | {len(r['inferred_track_ids'])}: {', '.join(r['inferred_track_ids']) or 'none'} |")
lines += ['',
'`lane_counts.json` also records measured-only per-lane counts/deltas and the full per-lane assignment bounds. Those bounds allow the **same marks** to move among plausible lanes; they are not confidence intervals or bounds on complete traffic recall. `uncertain_silhouette_marks` identifies individual top/overlap marks whose separability can change the total. `count_excluding_uncertain_silhouettes` provides a conservative count after excluding those marks, not an alternate invented vehicle list. Fully hidden and subpixel vehicles remain uncountable.','',
'f188 is 15.04s; f212 is 16.96s and f213 is 17.04s. There is no exact 17.00s source frame on the 12.5 fps grid. Opposing traffic is outside this census. The yellow wreck is excluded from the visible eye census at f350/f399 and retained in world data as `occluded-rest`. **Equal totals at f0/f300/f350 do not establish identity recall**: misses, inference and lane errors can cancel.','',
'## Evidence-supported corrections','',
'`identity_corrections.json` is a checked case manifest. It verifies the original track fingerprints and detector hash before applying changes, keeps stable canonical IDs, and refuses to apply silently to changed source detections. The contact sheets referenced in that manifest show the original competing fits on the source sequence.','',
'| Canonical ID | Merged fragments | Evidence / limitation |',
'|---|---|---|']
for edit in json.load(open(P/'identity_corrections.json'))['merges']:
 note='Same inspected source silhouette; simultaneous fitted positions retained as alternatives.'
 if edit['keep']=='c051':note='c069 through f135 only. Later fits remain unassigned evidence; the inferred reverse linkage was removed.'
 if edit['keep']=='c010':note='Continuous white-car approach and lateral transition preserved through the merged observed span.'
 if edit['keep']=='c077':note='Median approach continues to the car later moving laterally; c128 was a duplicate at f297–302.'
 lines.append(f"| {edit['keep']} | {', '.join(edit['merge'])} | {note} |")
lines += ['',
'- `c127`, `c137`, `c138` cover the crash white van front/body after impact, including clipped fits. They are stored under `reserved_crash_silhouette_tracks`; they do not create additional traffic. No authoritative crash sample was replaced by their approximate box fits.',
'- `c029`, `c098`, `c111`, `c163` are small car fits on green truck wireframe faces/edges without independent car bodies. Their full fitted observations remain under `excluded_source_part_tracks`. The unassigned later `c069` observations are also stored there with `exclusion_kind=unassigned-association`.',
'- All 9,090 measured fit records survive the exact before/after evidence-multiset assertion. New interpolated samples connect retained observations only; no lane snapping, fabricated lane changes, fabricated source positions or synthetic traffic was added.',
'- The final same-class overlap scan has zero candidates under its stated threshold. This scan is a review aid and does **not** exclude cross-class duplicates, marginal overlap, occluded fragments or identity switches below its threshold.','',
'## Kinematics and clipped/horizon review','',
'The previous short-horizon least-squares slope was installed as a confident initial velocity and its measurements were then reused by the filter. Background conversion now starts from the explicit weak prior vx = −18 ±18 m/s and vy = 0 ±2 m/s (one sigma), uses each position observation with camera covariance, and reports conditional `sigma_v_mps`. This is a model assumption, not a speed limit. Raw fitted positions are preserved in the pixel data.','',
'Clipped boxes now include uncertainty for missing body faces. On `c073` this removes the unsupported late positive-X reversal and the 24.7 m/s² endpoint spike; the retained end remains toward-camera motion. Cartesian forces use the stored rounded mass and acceleration, reducing the maximum rounded force-identity residual to 0.05 N.','',
f"Final background speeds: median {stats['background_speed_mps']['median']:.3f}, p95 {stats['background_speed_mps']['p95']:.3f}, p99 {stats['background_speed_mps']['p99']:.3f}, max {stats['background_speed_mps']['max']:.3f} m/s. Acceleration magnitude: median {stats['background_acceleration_mps2']['median']:.3f}, p95 {stats['background_acceleration_mps2']['p95']:.3f}, max {stats['background_acceleration_mps2']['max']:.3f} m/s². **These summaries are fitted model output, not accepted physical truth.**",
'',
'`c023` formerly gave reverse ~118 m/s from four clipped horizon samples; it now gives roughly −17.8 m/s with ~17.8 m/s conditional velocity uncertainty and is prior-dependent. The former maximum ~118.75 m/s `c163` and ~106.8 m/s `c111` were component fits, not accepted moving cars.','',
'The remaining high-speed cases were inspected in `inspect_c134.png`, `inspect_c034.png`, `inspect_c123.png`, `inspect_c078.png`. Their source fits move across tiny/partial horizon boxes, so the remaining maximum **61.6 m/s on c134 is still unvalidated**. c034 (~57.6), c123 (~56.5) and c078 (~56.0) also require this caveat. `audit_validation.json` lists every retained estimate over 45 m/s, its frame and conditional uncertainties. These uncertainties exclude association, body-dimension and calibration error. No hard speed clamp was applied, and no estimate above +3 m/s in X remains after the reviewed reverse-link corrections.','',
'## Residual issues to carry into production caveats','',
'1. **Visible source gaps remain.** A large unboxed dark/brown truck approaches through the background (clear at f250/f300/f350/f399; partly clipped at f212/f213). The wireframe-based detector does not establish a complete independent track for it. The clipped left-edge car slivers at f212 and f399 have no secure delivered identity. No path was manufactured to fill these gaps. See the corresponding primary manual marks/source images.',
'2. **Counts differ around 17s.** At f212 there are 31 delivered bodies versus 26 primary source marks, including six inferred tracks. At f213 there are 31 versus 25, including four inferred tracks. This is not a passing lane-coverage result. Inferred `c084`/`c092` near a truck, `c026`/`c094` source component associations and `c050`/`c086` around occlusion remain ambiguous; some may be retained fragments of one physical vehicle. They were not merged without sufficiently clear source identity evidence.',
'3. **The end-of-clip visible deficit remains.** f399 gives 22 delivered versus 24 primary source marks, while the delivered set includes the hidden yellow wreck. Its measured-visible count is 21. Horizon separability/lane uncertainty affects the exact deficit; total subtraction alone cannot identify all missing vehicles. f350 likewise includes the hidden wreck despite equal primary totals.',
'4. **Near-horizon class, size, speed and lane assignments remain provisional.** Some fits use only one face or a colored annotation component. No same-class scan or subpixel reprojection score validates their physical identity. c166 is a short horizon example with weak derivative information. Generic projected straight outer lanes also make L6/L7 assignment uncertain.',
'5. **Crash-pair limits are preserved.** Yellow identity before f151 remains unresolved; no early path was invented. Its f319–399 hidden resting pose is inferred with increased uncertainty. W2 collision/rest/heading caveats remain authoritative. No new collision, queue, pile-up or immovable-object conclusion was inferred here.','',
'## Verification and reproduction','',
'Passed `validate_audit.py` on the final real outputs: unique matching IDs; all observed spans consecutive on f0..399 and t=f/12.5; finite JSON samples; every measured source fit retained; 649 crash samples exactly unchanged; unchanged calibration/crash-pair hashes; exact Cartesian force identity within 0.05 N rounding; all nine eye dictionaries and lane deltas populated; no remaining overlap candidates under the diagnostic threshold. Clean regeneration into `reproduced_clean.json` is byte-for-byte identical to the delivered clean pixel file. Python compilation passed for changed measurement/audit scripts.','',
'All 400 cached source tiles match decoded `demo_32s.mp4` exactly. The longer `demo.mp4` has different compression (mean absolute channel difference ~0.945 over those crops); the measured input is the hashed 32-second file. `source_cache_verification.json` records both. The final median source-box reprojection diagnostic is about 0.70 px; it measures agreement with fitted input boxes, not independent world accuracy or vehicle recall.','',
f"Source/provenance breakdown: {stats['source_counts']['measured']:,} measured; {stats['source_counts']['interpolated']:,} interpolated; {stats['source_counts']['occluded-rest']} occluded-rest; zero out-of-view extrapolated in W1. {v['canonical_measured_fits_gated']} canonical measured fits were gated by the world smoother and marked inferred. All raw fits remain available.",
'',
'From the repo root (existing .venv; no Electron or database needed):','',
'```sh',
'.venv/bin/python FrontEnd/app/electron/demo-incident/measure/clean_tracks.py',
'.venv/bin/python FrontEnd/app/electron/demo-incident/measure/world_kinematics.py --review FrontEnd/app/electron/demo-incident/measure/review_tracks/world --no-render',
'.venv/bin/python FrontEnd/app/electron/demo-incident/measure/review_tracks/manual_census.py',
'.venv/bin/python FrontEnd/app/electron/demo-incident/measure/review_tracks/review.py',
'.venv/bin/python FrontEnd/app/electron/demo-incident/measure/clean_tracks.py --out FrontEnd/app/electron/demo-incident/measure/review_tracks/reproduced_clean.json',
'.venv/bin/python FrontEnd/app/electron/demo-incident/measure/review_tracks/identity_audit.py --out overlap_candidates_final.json',
'.venv/bin/python FrontEnd/app/electron/demo-incident/measure/review_tracks/validate_audit.py',
'```','',
'`inspect_candidates.py` can render additional cases from the **current** IDs using its `render()` function. The saved `inspect_*` correction contact sheets depict pre-correction competing IDs; preserve them. Large `tiles.npy`, historical early outputs and the duplicate reproduction JSON are disposable caches/diagnostics for integration to exclude from git; no peer files were deleted.','',
'## Final SHA-256 inputs and outputs','',
'These hashes identify the final stable W1 data. The integration thread must rebuild production and its sidecar against these values. Complete machine-readable checks and hashes are in `audit_validation.json`.','',
'| File (relative to repo) | SHA-256 |','|---|---|']
for path,sha in v['hashes'].items():lines.append(f'| `{path}` | `{sha}` |')
lines += ['',
'Integration thread: [Final integration, review and push — Sol xhigh standard](t3-thread://v2/6601a15e-2a4c-4aed-a511-f40fbc810ad2/thread:mcp:daf9172d-d51b-4a13-88b2-0c974e73f39d:sunhacks-standard-tier-continuations-2026-11-15:1). W1 hands off this audit and stops editing tracking files after notification.','']
(P/'REVIEW-COMPLETE.md').write_text('\n'.join(lines))
print('Wrote',P/'REVIEW-COMPLETE.md')
print('data hashes',{k:sha for k,sha in v['hashes'].items() if k.endswith(('tracks_px_clean.json','tracks_world.json'))})
