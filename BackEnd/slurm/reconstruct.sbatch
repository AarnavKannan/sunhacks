#!/usr/bin/env bash
#SBATCH --job-name=incident-splat
#SBATCH --nodes=1
#SBATCH --cpus-per-task=8
#SBATCH --mem=32G
#SBATCH --time=04:00:00
#SBATCH --gres=gpu:1
#SBATCH --output=incident-splat-%j.log

set -Eeuo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: sbatch $0 <directory-of-videos> <output-directory>" >&2
  exit 2
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"

export OPEN_SPLAT_BIN="${OPEN_SPLAT_BIN:-$REPO_ROOT/OpenSplat/build/opensplat}"

srun bash "$REPO_ROOT/BackEnd/pipeline/reconstruct.sh" "$1" "$2"
