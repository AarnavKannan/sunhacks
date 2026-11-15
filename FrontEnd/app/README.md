# Reconstruct desktop app

## Run

From `FrontEnd/app`:

```powershell
npm install
npm start
```

The Electron app can stage multiple source videos in its application data directory. Staging copies the files and writes a `manifest.json` containing each filename, size, and SHA-256 hash. This does not submit a job to Sol yet.

The updated viewer provides a searchable scene list, video upload queue, scene controls, and a draggable timeline. The side panel overlays the viewer and collapses to a narrow reopen rail. Use **Stage footage** in the upload queue to copy queued videos into Electron's application data directory.

Select `.splat`, `.ply`, or `.spz` output through the upload control to view it with Spark. The selected file is held locally in the app; it is not uploaded. A static splat has no time-varying scene data, so timeline playback does not animate it.

## Reconstruction pipeline boundary

OpenSplat is a native C++ executable, not an npm dependency. Its upstream repository is [WebODM/OpenSplat](https://github.com/WebODM/OpenSplat), tracked at the repository root as a Git submodule. Build it on the compute host (ASU Sol); do not add its source tree to the Electron app with `npm install`.

OpenSplat consumes a COLMAP, OpenSfM, ODX, OpenMVG, or Nerfstudio project with camera poses and sparse points. Raw videos first need frame extraction and structure-from-motion processing (for example, FFmpeg and COLMAP). OpenSplat can then write a `.splat` file with its output option.

The initial backend pipeline and Slurm wrapper are documented in [`BackEnd/README.md`](../../BackEnd/README.md). After the job creates `background.splat`, download it to the desktop and select it through the upload control. The app does not yet transfer files to Sol or submit jobs automatically.

One OpenSplat run creates a static scene, not a time-varying reconstruction. The full 4D scene package still needs vehicle detections/tracks and per-vehicle splats or proxy meshes.
