# Backend reconstruction pipeline

The backend runs on ASU Sol. The `OpenSplat` directory at the repository root is a Git submodule; the backend scripts use its built executable at `OpenSplat/build/opensplat`. OpenSplat is licensed under AGPL-3.0, which should be considered before distributing this application.

## Prepare OpenSplat on Sol

Initialize the submodule after cloning the project:

```bash
git submodule update --init --recursive
```

Load or activate the LibTorch, OpenCV, CMake, and CUDA environment supported by your Sol allocation. Set the CMake paths, then build:

```bash
export CMAKE_PREFIX_PATH=/path/to/libtorch
export OPENCV_DIR=/path/to/opencv
export GPU_RUNTIME=CUDA
bash BackEnd/pipeline/build_opensplat.sh
```

`CMAKE_PREFIX_PATH` and `OPENCV_DIR` must point to the compatible installations on Sol. Do not build OpenSplat on the Windows desktop for the Sol job.

## Run a static reconstruction

First make sure `ffmpeg`, `colmap`, and the OpenSplat executable are available in the job environment. Then submit:

```bash
sbatch BackEnd/slurm/reconstruct.sbatch \
  /scratch/$USER/sunhacks/incident-001/sources \
  /scratch/$USER/sunhacks/incident-001/output
```

The pipeline extracts frames into one folder per input video, runs COLMAP feature extraction/matching/mapper, and trains `background.splat` with OpenSplat. `FRAME_RATE` defaults to 1 frame per second and `OPEN_SPLAT_ITERATIONS` defaults to 2000; both can be overridden when exported into the Slurm job environment.

The output contains `background.splat`, `manifest.json`, and the COLMAP project used for training. The manifest records source filenames and SHA-256 hashes. The output is **static** and uses COLMAP-relative coordinates. This job does not yet create vehicle segmentation, 6DoF tracks, kinematics, or per-vehicle splats, so it is not the complete 4D incident package.

The Electron app currently stages selected source videos locally; it does not transfer them to Sol or submit this job automatically. Transfer inputs to Sol, submit the Slurm job, and download `background.splat` to the desktop. In the app, choose **Load splat output** to view it.

The local `TestData` folder currently contains one MP4. Copy it to Sol before submitting; COLMAP still needs enough camera motion/parallax and visual overlap to estimate poses and geometry. A fixed-camera clip may not produce a usable 3D reconstruction, while overlapping views from multiple cameras are more suitable.

## Built-in proxy collision motion

The roundabout and Apache proxy scenes use collision trajectories exported by the Python pipeline. Install the pipeline package, then run `export-collision-trajectories` from the repository root to regenerate `FrontEnd/app/src/data/impactTrajectories.json`. The solver uses SymPy to solve vector momentum conservation and Newton's restitution equation along the impact normal, NumPy for the vector response and sampled motion, and Coulomb friction to bring each vehicle to rest.

These are illustrative point-mass collisions, not measured crash reconstructions: masses are 1,950 kg (roundabout SUV), 1,500 kg (roundabout sedan), 1,600 kg (Apache sedan), and 2,000 kg (Apache SUV); both built-in collision pairs approach at about 20 m/s. Restitution is 0.15 and dry-asphalt friction is 0.75, matching the viewer's road specification. Since the proxy scenes contain no contact-point geometry, the impact normal is estimated opposite the incoming relative velocity. Real reconstruction should use measured vehicle masses, contact geometry, and tracked pre-impact velocities.
