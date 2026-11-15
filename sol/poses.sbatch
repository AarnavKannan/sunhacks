#!/bin/bash
# GPU job: VGGT estimates the 4 static camera poses (+ a sparse point cloud) from the empty-road plates.
#SBATCH -J recon-poses
#SBATCH -p htc
#SBATCH -q public
#SBATCH -G a100:1
#SBATCH -c 8
#SBATCH --mem=64G
#SBATCH -t 0-01:00
#SBATCH -o /scratch/%u/sunhacks/logs/%x-%j.out
#SBATCH --mail-type=END,FAIL
#SBATCH --mail-user=%u@asu.edu
set -eo pipefail
source "$SLURM_SUBMIT_DIR/config.sh"
activate vggt
nvidia-smi --query-gpu=name,memory.total --format=csv
python -c "import torch; assert torch.cuda.is_available(), 'no GPU visible'; print(torch.cuda.get_device_name(0))"

SCENE=$WORK/scene
# VGGT sees only the 4 real cameras. Feeding it the 0_holdout duplicate of cam1 made it confident
# about cam1 alone (all 100k points came from cam1 + its copy). The holdout is added back afterwards.
VIN=$WORK/vggt_input
rm -rf "$VIN"; mkdir -p "$VIN/images"
cp "$SCENE"/images/cam*.png "$VIN/images/"

cd "$SRC/vggt"
# VGGT only keeps 3D points whose confidence is >= conf_thres_value (default 5.0; the minimum
# possible is 1.0). On this weak-overlap scene nothing reached 1.5, so step the threshold down
# until there are enough points to initialise the splat.
MIN_POINTS=20000
NPTS=0
for T in 5 3 2 1.5 1.2 1.05; do
  rm -rf "$VIN/sparse"
  python demo_colmap.py --scene_dir "$VIN" --seed 42 --conf_thres_value "$T"
  NPTS=$(grep -a -m1 "element vertex" "$VIN/sparse/points.ply" | awk '{print $3}')
  NPTS=${NPTS:-0}
  echo ">>> conf_thres_value=$T -> $NPTS points"
  if [ "$NPTS" -ge "$MIN_POINTS" ]; then break; fi
done
if [ "$NPTS" -lt 1000 ]; then
  echo "VGGT kept only $NPTS points even at the lowest threshold; poses are unusable for training."
  exit 1
fi
rm -rf "$SCENE/sparse"
cp -r "$VIN/sparse" "$SCENE/sparse"
echo "$T" > "$SCENE/sparse/conf_thres_used.txt"
python "$SLURM_SUBMIT_DIR/add_holdout.py" "$SCENE/sparse" cam1.png 0_holdout.png

mkdir -p "$PACKAGE/debug"
python "$SLURM_SUBMIT_DIR/export_cameras.py" "$SCENE/sparse" "$PACKAGE/cameras.json"
cp "$SCENE/sparse/points.ply" "$PACKAGE/debug/vggt_points.ply"
# Look at debug/vggt_reprojection.jpg before trusting the poses: every camera should be covered.
python "$SLURM_SUBMIT_DIR/diagnose_poses.py" "$SCENE" "$PACKAGE/debug"
