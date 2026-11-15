#!/bin/bash
# CPU job: hash the video, split the 2x2 mosaic into 4 cameras, build empty-road plates.
#SBATCH -J recon-ingest
#SBATCH -p htc
#SBATCH -q public
#SBATCH -c 4
#SBATCH --mem=16G
#SBATCH -t 0-00:30
#SBATCH -o /scratch/%u/sunhacks/logs/%x-%j.out
#SBATCH --mail-type=FAIL
#SBATCH --mail-user=%u@asu.edu
set -eo pipefail
source "$SLURM_SUBMIT_DIR/config.sh"
activate vggt

[ -f "$VIDEO" ] || { echo "Missing $VIDEO - upload it first"; exit 1; }
python "$SLURM_SUBMIT_DIR/ingest.py" "$VIDEO" "$WORK" "${TILES[@]}"
ls -la "$WORK/scene/images"
