# handoff_artifacts

Outputs copied from ASU Sol on 2026-11-14. See [../HANDOFF.md](../HANDOFF.md), section 7.

| Path | What it is | Still valid? |
|---|---|---|
| `scene/images/` | The 5 empty-road plates from ingest (`cam1..cam4.png` + the `0_holdout.png` copy of cam1) | ✅ Yes. You can reuse these instead of re-running ingest. |
| `scene/sparse/` | VGGT's COLMAP model (confidence threshold 1.2, 100k points) | ⚠️ **No.** VGGT was given the `0_holdout` duplicate, and the result is degenerate (all points from cam1). Regenerate it with the fixed poses step. |
| `package/incident-r05_s03/cameras.json`, `debug/vggt_points.ply` | Exported from that same model | ⚠️ No, for the same reason |
| `diagnostics/` | `sol/diagnose_poses.py` output for that model. It shows the problem: the points only cover cam1. | Reference |
| `ingest_meta.json` | Video hash, fps, frame counts | ✅ |
| `logs/` | Every Sol job log | Reference |
| `status_report.txt` | Sol queue/job summary and log excerpts at handoff time | Reference |
