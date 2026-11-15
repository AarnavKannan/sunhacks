# Shared settings for every Sol job. Sourced by each *.sbatch script.

# Where everything lives on Sol (scratch: fast, 100 TB, files untouched for 90 days are deleted).
BASE=/scratch/$(whoami)/sunhacks
ENVS=$BASE/envs
SRC=$BASE/src
VIDEO=$BASE/videos/r05_s03.mp4
INCIDENT=r05_s03
WORK=$BASE/work/$INCIDENT          # intermediate files (frames, COLMAP scene, training output)
PACKAGE=$BASE/package/incident-$INCIDENT   # what gets copied back to laptops

# Model weights and caches go to scratch, not the 100 GB home quota.
export TORCH_HOME=$BASE/cache/torch
export HF_HOME=$BASE/cache/hf
export PIP_CACHE_DIR=$BASE/cache/pip

# This clip is a 2x2 mosaic (960x610). Each camera tile as ffmpeg crop w:h:x:y.
# The black divider lines (cols 479-480, rows 300-303) are excluded. Offsets and sizes are even
# because ffmpeg rounds odd crop values for yuv420 video (which would pull in the divider).
TILES=(
  "cam1=478:300:0:0"
  "cam2=478:300:482:0"
  "cam3=478:300:0:304"
  "cam4=478:300:482:304"
)

# Pinned versions. VGGT pins torch 2.3.1; gsplat publishes a prebuilt 1.5.3 wheel for torch 2.3 + CUDA 12.1.
TORCH_INDEX=https://download.pytorch.org/whl/cu121
GSPLAT_VERSION=1.5.3
GSPLAT_WHEEL_INDEX=https://docs.gsplat.studio/whl/pt23cu121
VGGT_WEIGHTS_URL=https://huggingface.co/facebook/VGGT-1B/resolve/main/model.pt
VGGT_COMMIT=a288dd0f14786c93483e45524328726ab7b1b4ce   # known-good on Sol (2026-11-14)

# Background splat training length. 4 static views overfit quickly, so 7k is plenty.
BG_STEPS=7000

activate() {
  module purge
  module load mamba/latest
  source activate "$ENVS/$1"
}

# gsplat's prebuilt CUDA module needs glibc >= 2.32, but Sol (Rocky Linux 8.10) has glibc 2.28.
# Without it, gsplat falls back to compiling itself, and nvcc crashes on Sol. So every gs-env command
# runs inside an Ubuntu 22.04 container (glibc 2.35) while still using the gs env's own Python.
CONTAINER=$BASE/containers/ubuntu-22.04.sif
export APPTAINER_CACHEDIR=$BASE/cache/apptainer
gs_run() {
  local envs=(--env "PATH=$ENVS/gs/bin:/usr/local/bin:/usr/bin:/bin"
              --env "TORCH_HOME=$TORCH_HOME" --env "HF_HOME=$HF_HOME")
  if [ -n "${CUDA_VISIBLE_DEVICES:-}" ]; then envs+=(--env "CUDA_VISIBLE_DEVICES=$CUDA_VISIBLE_DEVICES"); fi
  apptainer exec --nv --cleanenv -B /scratch "${envs[@]}" "$CONTAINER" "$@"
}
