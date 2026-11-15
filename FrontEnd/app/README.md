# Reconstruct desktop app

## Run

From `FrontEnd/app`:

```powershell
npm install
npm start
```

The Electron app can stage multiple source videos in its application data directory. Staging copies the files and writes a `manifest.json` containing each filename, size, and SHA-256 hash. This does not submit a job to Sol yet.

The viewer can load `.splat`, `.ply`, and `.spz` files into the React Three Fiber canvas through Spark. A selected file is streamed from the browser file handle; it is not copied into PostgreSQL or uploaded.

## Reconstruction pipeline boundary

OpenSplat is a native C++ executable, not an npm dependency. Its upstream repository is [WebODM/OpenSplat](https://github.com/WebODM/OpenSplat). Build or install it on the compute host (ASU Sol); do not add its source tree to the Electron app with `npm install`.

OpenSplat consumes a COLMAP, OpenSfM, ODX, OpenMVG, or Nerfstudio project with camera poses and sparse points. Raw videos first need frame extraction and structure-from-motion processing (for example, FFmpeg and COLMAP). OpenSplat can then write a `.splat` file with its output option.

One OpenSplat run creates a static scene, not a time-varying reconstruction. The full 4D scene package also needs vehicle detections/tracks and per-vehicle splats or proxy meshes, plus a Slurm job workflow to transfer inputs and outputs. Those Sol submission and dynamic-tracking steps are not wired up yet.
