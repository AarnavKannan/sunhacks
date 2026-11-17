# CRASHVZN desktop app

Electron + Vite + React viewer for 4D traffic-incident reconstructions.

## Run

The app imports the assistant package by source path. From the repository root:

```sh
cd packages/assistant
npm install
cd ../../apps/desktop
npm install
npm start
```

Stage footage in the upload queue to copy videos into Electron's application data directory. Load `.splat`, `.ply`, or `.spz` output through the upload control to view it with Spark.

## Reconstruction boundary

OpenSplat is a native C++ executable under [`vendor/OpenSplat`](../../vendor/OpenSplat), not an npm dependency. Build it on the compute host (ASU Sol). Docs: [`pipeline/README.md`](../../pipeline/README.md).

After a Sol job creates `background.splat`, download it and choose **Load splat output**. The app does not yet submit Sol jobs automatically.

Measured 4D packages live under [`scene-packages/`](../../scene-packages). Demo measurement tooling is under `electron/demo-incident/`.
