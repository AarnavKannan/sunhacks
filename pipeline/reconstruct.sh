#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  echo "Usage: $0 <directory-of-videos> <output-directory>" >&2
}

if [[ $# -ne 2 ]]; then
  usage
  exit 2
fi

INPUT_DIR="$(cd -- "$1" && pwd)"
mkdir -p "$2"
OUTPUT_DIR="$(cd -- "$2" && pwd)"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
FFMPEG_BIN="${FFMPEG_BIN:-ffmpeg}"
COLMAP_BIN="${COLMAP_BIN:-colmap}"
OPEN_SPLAT_BIN="${OPEN_SPLAT_BIN:-$REPO_ROOT/vendor/OpenSplat/build/opensplat}"
FRAME_RATE="${FRAME_RATE:-1}"
OPEN_SPLAT_ITERATIONS="${OPEN_SPLAT_ITERATIONS:-2000}"

if [[ ! "$FRAME_RATE" =~ ^[0-9]+([.][0-9]+)?$ ]] || ! awk -v rate="$FRAME_RATE" 'BEGIN { exit !(rate > 0) }'; then
  echo "FRAME_RATE must be a positive number (frames per second)." >&2
  exit 2
fi

if [[ ! "$OPEN_SPLAT_ITERATIONS" =~ ^[0-9]+$ ]] || [[ "$OPEN_SPLAT_ITERATIONS" -eq 0 ]]; then
  echo "OPEN_SPLAT_ITERATIONS must be a positive integer." >&2
  exit 2
fi

for command_name in "$FFMPEG_BIN" "$COLMAP_BIN"; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command not found: $command_name" >&2
    exit 127
  fi
done

if [[ "$OPEN_SPLAT_BIN" == */* ]]; then
  if [[ ! -x "$OPEN_SPLAT_BIN" ]]; then
    echo "OpenSplat executable not found or not executable: $OPEN_SPLAT_BIN" >&2
    echo "Build it with pipeline/build_opensplat.sh on the compute host." >&2
    exit 127
  fi
else
  if ! command -v "$OPEN_SPLAT_BIN" >/dev/null 2>&1; then
    echo "OpenSplat executable not found: $OPEN_SPLAT_BIN" >&2
    exit 127
  fi
fi

shopt -s nullglob
videos=("$INPUT_DIR"/*)
video_paths=()
for video in "${videos[@]}"; do
  [[ -f "$video" ]] || continue
  case "${video,,}" in
    *.mp4|*.mov|*.m4v|*.mkv|*.avi|*.webm) video_paths+=("$video") ;;
  esac
done

if [[ ${#video_paths[@]} -eq 0 ]]; then
  echo "No supported video files found in $INPUT_DIR." >&2
  exit 2
fi

PROJECT_DIR="$OUTPUT_DIR/colmap-project"
IMAGES_DIR="$PROJECT_DIR/images"
DATABASE_PATH="$PROJECT_DIR/database.db"
SPARSE_DIR="$PROJECT_DIR/sparse"
mkdir -p "$IMAGES_DIR" "$SPARSE_DIR"

for index in "${!video_paths[@]}"; do
  camera_dir="$IMAGES_DIR/camera_$(printf '%02d' "$((index + 1))")"
  mkdir -p "$camera_dir"
  echo "Extracting frames from $(basename -- "${video_paths[$index]}")"
  "$FFMPEG_BIN" \
    -nostdin \
    -hide_banner \
    -loglevel error \
    -y \
    -i "${video_paths[$index]}" \
    -vf "fps=$FRAME_RATE" \
    -q:v 2 \
    "$camera_dir/frame_%06d.jpg"

  frames=("$camera_dir"/*.jpg)
  if [[ ${#frames[@]} -eq 0 ]]; then
    echo "No frames extracted from ${video_paths[$index]}." >&2
    exit 1
  fi
done

echo "Estimating camera poses and sparse points with COLMAP"
"$COLMAP_BIN" feature_extractor \
  --database_path "$DATABASE_PATH" \
  --image_path "$IMAGES_DIR" \
  --ImageReader.single_camera_per_folder 1
"$COLMAP_BIN" exhaustive_matcher --database_path "$DATABASE_PATH"
"$COLMAP_BIN" mapper \
  --database_path "$DATABASE_PATH" \
  --image_path "$IMAGES_DIR" \
  --output_path "$SPARSE_DIR"

if [[ ! -d "$SPARSE_DIR/0" ]]; then
  echo "COLMAP did not produce sparse/0; OpenSplat needs a registered sparse model." >&2
  exit 1
fi

SPLAT_PATH="$OUTPUT_DIR/background.splat"
echo "Training static scene splat with OpenSplat"
"$OPEN_SPLAT_BIN" "$PROJECT_DIR" -o "$SPLAT_PATH" -n "$OPEN_SPLAT_ITERATIONS"

if [[ ! -s "$SPLAT_PATH" ]]; then
  echo "OpenSplat completed without producing a non-empty splat: $SPLAT_PATH" >&2
  exit 1
fi

manifest_tmp="$OUTPUT_DIR/manifest.json.tmp"
{
  printf '{\n  "schemaVersion": 1,\n  "sceneType": "static",\n'
  printf '  "pipeline": "ffmpeg-colmap-opensplat",\n'
  printf '  "coordinateUnits": "COLMAP-relative",\n'
  printf '  "backgroundSplat": "background.splat",\n'
  printf '  "sourceVideos": [\n'
  for index in "${!video_paths[@]}"; do
    video="${video_paths[$index]}"
    hash="$(sha256sum -- "$video" | awk '{print $1}')"
    escaped_name="${video##*/}"
    escaped_name="${escaped_name//\\/\\\\}"
    escaped_name="${escaped_name//\"/\\\"}"
    if [[ "$escaped_name" == *$'\n'* || "$escaped_name" == *$'\r'* || "$escaped_name" == *$'\t'* ]]; then
      echo "Video filename contains a control character that cannot be recorded in the manifest." >&2
      exit 2
    fi
    if [[ "$index" -gt 0 ]]; then
      printf ',\n'
    fi
    printf '    {"fileName": "%s", "sha256": "%s"}' "$escaped_name" "$hash"
  done
  printf '\n  ]\n}\n'
} > "$manifest_tmp"
mv "$manifest_tmp" "$OUTPUT_DIR/manifest.json"

echo "Static scene package ready: $OUTPUT_DIR"
echo "Load $SPLAT_PATH in the Electron viewer."
