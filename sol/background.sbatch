#!/bin/bash
# GPU job: train the static background splat with gsplat on the empty-road plates + VGGT poses.
# Requests an A100 (80 GB), the most common GPU on Sol.
#SBATCH -J recon-background
#SBATCH -p htc
#SBATCH -q public
#SBATCH -G a100:1
#SBATCH -c 8
#SBATCH --mem=64G
#SBATCH -t 0-02:00
#SBATCH -o /scratch/%u/sunhacks/logs/%x-%j.out
#SBATCH --mail-type=END,FAIL
#SBATCH --mail-user=%u@asu.edu
set -eo pipefail
source "$SLURM_SUBMIT_DIR/config.sh"
module purge
nvidia-smi --query-gpu=name,memory.total --format=csv
# Fail fast (instead of letting gsplat try to compile itself) if the prebuilt module or GPU is unusable.
gs_run python -c "import torch; from gsplat import csrc; assert torch.cuda.is_available(), 'no GPU in container'; print('container OK:', torch.cuda.get_device_name(0))"

SCENE=$WORK/scene
RESULT=$WORK/bg
rm -rf "$RESULT"

# gsplat's loader needs VGGT's points to centre and scale the scene, even for random init.
NPTS=$(grep -a -m1 "element vertex" "$SCENE/sparse/points.ply" | awk '{print $3}')
NPTS=${NPTS:-0}
if [ "$NPTS" -lt 1000 ]; then
  echo "Only $NPTS VGGT points in $SCENE/sparse - rerun the poses job first (FROM=poses bash submit_all.sh)."
  exit 1
fi
INIT=sfm
echo "VGGT points: $NPTS (conf threshold $(cat "$SCENE/sparse/conf_thres_used.txt" 2>/dev/null || echo '?')) -> init_type=$INIT"

cd "$SRC/gsplat/examples"
gs_run python simple_trainer.py default \
  --data_dir "$SCENE" \
  --data_factor 1 \
  --result_dir "$RESULT" \
  --max_steps "$BG_STEPS" \
  --init_type "$INIT" \
  --save_ply \
  --disable_viewer \
  --disable_video

PLY=$(ls -t "$RESULT"/ply/*.ply | head -1)
cp "$PLY" "$PACKAGE/background.ply"
cp "$RESULT"/stats/val_step*.json "$PACKAGE/debug/" 2>/dev/null || true
echo "background splat: $PACKAGE/background.ply ($(du -h "$PACKAGE/background.ply" | cut -f1))"
cat "$RESULT"/stats/val_step*.json 2>/dev/null || true
