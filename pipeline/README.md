# Reconstruction pipeline

Python package and Sol job scripts that turn incident footage into a scene package (tracks, kinematics, events) and optionally a static OpenSplat background.

OpenSplat lives at [`vendor/OpenSplat`](../vendor/OpenSplat) (AGPL-3.0). Build it on the compute host; do not ship its source inside the Electron app.

## Local scene package (kinematics)

From the repository root:

```bash
python3 -m venv pipeline/.venv
pipeline/.venv/bin/pip install -e "pipeline/[dev]"
pipeline/.venv/bin/reconstruct build
pipeline/.venv/bin/reconstruct validate scene-packages/incident-demo
cd pipeline && .venv/bin/pytest -q
```

Input mosaic: [`data/demo.mp4`](../data/demo.mp4). Config: [`configs/incident-demo.yaml`](configs/incident-demo.yaml). Output: [`scene-packages/incident-demo/`](../scene-packages/incident-demo).

## Prepare OpenSplat on Sol

```bash
git submodule update --init --recursive
export CMAKE_PREFIX_PATH=/path/to/libtorch
export OPENCV_DIR=/path/to/opencv
export GPU_RUNTIME=CUDA
bash pipeline/build_opensplat.sh
```

## Run a static reconstruction on Sol

Requires `ffmpeg`, `colmap`, and the OpenSplat binary on the job node:

```bash
sbatch pipeline/slurm/reconstruct.sbatch \
  /scratch/$USER/sunhacks/incident-001/sources \
  /scratch/$USER/sunhacks/incident-001/output
```

Sample footage for Sol experiments is under [`data/samples/`](../data/samples).

## Proxy collision export

`export-collision-trajectories` (NumPy/SymPy) writes illustrative post-impact paths for the authored viewer scenes. The interactive viewer computes contact itself and does not consume that JSON at runtime.
