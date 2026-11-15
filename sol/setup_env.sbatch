#!/bin/bash
# One-time setup: builds two mamba envs and pre-downloads model weights.
#   vggt : VGGT + official pycolmap + ffmpeg  (ingest, camera poses)
#   gs   : gsplat 1.5.3 + its training example (background splat)
# They are separate because gsplat 1.5.3's examples use a pycolmap fork that clashes with the official one.
#
# Runs on lightwork (meant for building envs, starts fast, no GPU). Nothing is compiled: gsplat is a
# prebuilt wheel run inside an Ubuntu 22.04 container, fused-ssim is a pure-PyTorch shim.
#SBATCH -J recon-setup
#SBATCH -p lightwork
#SBATCH -q public
#SBATCH -c 8
#SBATCH --mem=32G
#SBATCH -t 0-03:00
#SBATCH -o /scratch/%u/sunhacks/logs/%x-%j.out
#SBATCH --mail-type=END,FAIL
#SBATCH --mail-user=%u@asu.edu
set -eo pipefail
source "$SLURM_SUBMIT_DIR/config.sh"
mkdir -p "$ENVS" "$SRC" "$TORCH_HOME" "$HF_HOME" "$PIP_CACHE_DIR"
module purge
module load mamba/latest

echo "=== [1/5] vggt env ==="
if [ ! -d "$ENVS/vggt" ]; then
  mamba create -y -p "$ENVS/vggt" -c conda-forge python=3.11 pip ffmpeg git
fi
source activate "$ENVS/vggt"
pip install torch==2.3.1 torchvision==0.18.1 --index-url "$TORCH_INDEX"
if [ ! -d "$SRC/vggt" ]; then
  git clone https://github.com/facebookresearch/vggt.git "$SRC/vggt"
  git -C "$SRC/vggt" checkout -q "$VGGT_COMMIT"
fi
pip install -r "$SRC/vggt/requirements.txt" -r "$SRC/vggt/requirements_demo.txt"
pip install -e "$SRC/vggt"
python -c "import vggt, pycolmap, trimesh, torch; print('vggt env OK, torch', torch.__version__, 'pycolmap', pycolmap.__version__)"
echo "vggt commit: $(git -C "$SRC/vggt" rev-parse HEAD)"

echo "=== [2/5] VGGT-1B weights (~5 GB) ==="
python -c "import torch; torch.hub.load_state_dict_from_url('$VGGT_WEIGHTS_URL', map_location='cpu'); print('weights cached')"
conda deactivate || source deactivate || true

echo "=== [3/5] gs env ==="
if [ ! -d "$ENVS/gs" ]; then
  # No CUDA toolkit needed: gsplat is a prebuilt wheel and fused-ssim is replaced by a pure-PyTorch shim.
  mamba create -y -p "$ENVS/gs" -c conda-forge python=3.10 pip git ninja
fi
source activate "$ENVS/gs"
pip install torch==2.3.1 torchvision==0.18.1 --index-url "$TORCH_INDEX"
pip install ninja "numpy<2" jaxtyping "rich>=12"
pip install --no-deps "gsplat==$GSPLAT_VERSION" --index-url "$GSPLAT_WHEEL_INDEX"
[ -d "$SRC/gsplat" ] || git clone --depth 1 --branch "v$GSPLAT_VERSION" https://github.com/nerfstudio-project/gsplat.git "$SRC/gsplat"
# fused-ssim (CUDA build failed on Sol) is replaced by the pure-PyTorch shim in sol/fused_ssim_shim.
# fused-bilagrid is only imported when bilateral grids are enabled, so it is skipped.
# Pin viser/tyro to versions from gsplat 1.5.3's era (its requirements leave them unpinned).
grep -v -e fused-bilagrid -e fused-ssim "$SRC/gsplat/examples/requirements.txt" \
  | sed -e 's/^viser$/viser==0.2.23/' -e 's/^tyro.*/tyro>=0.8.8,<1.0/' \
        -e 's/^opencv-python$/opencv-python-headless<4.12/' > "$SRC/gs_requirements.txt"
pip install --no-build-isolation -r "$SRC/gs_requirements.txt"
pip install --force-reinstall --no-deps "$SLURM_SUBMIT_DIR/fused_ssim_shim"
# opencv-python needs libGL, which the minimal Ubuntu container lacks; the headless build does not.
# Both builds install into the same cv2/ folder, so uninstalling opencv-python deletes headless's
# files too; force-reinstall headless afterwards (a plain install says "already satisfied").
pip uninstall -y opencv-python || true
pip install --force-reinstall --no-deps "opencv-python-headless<4.12"

echo "=== [4/5] Ubuntu 22.04 container (Sol's glibc is too old for gsplat's prebuilt module) ==="
mkdir -p "$(dirname "$CONTAINER")" "$APPTAINER_CACHEDIR"
if [ ! -f "$CONTAINER" ]; then
  # 1) Sol ships ubuntu-22.04.sif (see `showsimg`); copy it if we can find it.
  SOL_IMG=$(find /packages -maxdepth 4 -name 'ubuntu-22.04.sif' 2>/dev/null | head -1 || true)
  if [ -n "$SOL_IMG" ]; then
    echo "Using Sol's image: $SOL_IMG"
    cp "$SOL_IMG" "$CONTAINER"
  else
    # 2) Otherwise pull it: Docker Hub first, then AWS's public mirror of the same official image.
    for src in docker://ubuntu:22.04 docker://public.ecr.aws/docker/library/ubuntu:22.04; do
      for try in 1 2 3; do
        echo "Pulling $src (attempt $try)"
        if apptainer pull --force "$CONTAINER" "$src"; then break 2; fi
        sleep 15
      done
    done
  fi
fi
[ -f "$CONTAINER" ] || { echo "Could not get an Ubuntu 22.04 container image"; exit 1; }
gs_run python -c "import torch, gsplat, cv2, fused_ssim; from gsplat import csrc; from pycolmap import SceneManager; print('gs env OK (in container), gsplat', gsplat.__version__, 'torch', torch.__version__, '- prebuilt CUDA module loads')"

echo "=== [5/5] LPIPS weights used by the trainer's eval ==="
gs_run python -c "from torchmetrics.image.lpip import LearnedPerceptualImagePatchSimilarity as L; L(net_type='alex'); print('lpips cached')"

touch "$ENVS/.ready"
echo "SETUP DONE"
