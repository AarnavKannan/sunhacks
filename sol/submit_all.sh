#!/bin/bash
# Submit the whole reconstruction chain. Run on a Sol login node from anywhere:
#   bash sol/submit_all.sh                 # full chain
#   FROM=poses bash sol/submit_all.sh      # rerun poses + background only
# Each job starts only if the previous one succeeded (afterok). Setup is skipped once it has passed.
set -eo pipefail
cd "$(dirname "$0")"
source ./config.sh
mkdir -p "$BASE/logs" "$PACKAGE/debug"

# Email on every job's success (END) or failure (FAIL). Override with: MAIL_USER=you@asu.edu bash submit_all.sh
MAIL_USER=${MAIL_USER:-$(whoami)@asu.edu}
# --kill-on-invalid-dep: if a job fails, cancel the jobs waiting on it instead of leaving them stuck in the queue.
SB=(sbatch --parsable --mail-type=END,FAIL --mail-user="$MAIL_USER" --kill-on-invalid-dep=yes)

# Start the chain at a later step with FROM=poses or FROM=background (earlier outputs are reused).
FROM=${FROM:-ingest}
case "$FROM" in ingest|poses|background) ;; *) echo "FROM must be ingest, poses or background"; exit 1;; esac

dep=""
if [ ! -f "$ENVS/.ready" ]; then
  j=$("${SB[@]}" setup_env.sbatch); echo "setup      $j"; dep="--dependency=afterok:$j"
fi
if [ "$FROM" = ingest ]; then
  j=$("${SB[@]}" $dep ingest.sbatch);     echo "ingest     $j"; dep="--dependency=afterok:$j"
fi
if [ "$FROM" != background ]; then
  j=$("${SB[@]}" $dep poses.sbatch);      echo "poses      $j"; dep="--dependency=afterok:$j"
fi
j=$("${SB[@]}" $dep background.sbatch);   echo "background $j"

echo "Emails go to: $MAIL_USER"
echo
echo "Watch:   squeue -u $(whoami)      (or: myjobs)"
echo "Logs:    tail -f $BASE/logs/recon-*.out"
echo "Output:  $PACKAGE"
