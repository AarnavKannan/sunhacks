# Frame-exact measurement of the demo crash (0–32 s, bottom-right camera)

Python venv: C:/Users/anvit/AppData/Local/Temp/claude/c4cbf845f760d618/c0659285-94a2-4095-861f-34610b7ebe23/scratchpad/measure/.venv/Scripts/python.exe (numpy, scipy, opencv-python-headless).

Video: repo-root demo.mp4, 960x610 mosaic, 12.5 fps. Bottom-right tile (crash camera) = crop x=481 y=304 w=479 h=300. Frames 0..399 = 0..31.92 s (t = f / 12.5).

## World frame W (meters)
X along the road, positive AWAY from the camera; Y lateral, positive to the camera's RIGHT; Z up. The camera is at (0, cam_y, h).
Y = 0 is the dashed lane line between lanes 1 and 2 of the RIGHT carriageway (traffic moving away). The crash carriageway (traffic toward the camera) is at negative Y.
Camera model: cam.py (`to_ground(u, v)` → (X, Y) on Z=0; `to_img(X, Y, Z)` → (u, v) in tile pixels). Fitted to the right-carriageway dashes (6 m dash, 12 m gap): RMS 0.58 px, assuming 3.75 m lanes (calib_3.75.json).

## Files: one owner each
- data/br_camera.json, cam.py → calibration agent
- data/tracks_px.json → detection/tracking agent
- data/tracks_world.json → world-kinematics agent
- data/crash_pair.json → crash-pair agent
- ../build-measured-spec.py, ../incident-spec.json, demo_32s.mp4 → scene agent
- review/ → review agent
