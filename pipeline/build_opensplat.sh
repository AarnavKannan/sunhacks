#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
SOURCE_DIR="$REPO_ROOT/vendor/OpenSplat"
BUILD_DIR="$SOURCE_DIR/build"

if [[ ! -f "$SOURCE_DIR/CMakeLists.txt" ]]; then
  echo "OpenSplat submodule is missing. Run: git submodule update --init --recursive" >&2
  exit 2
fi

if [[ -z "${CMAKE_PREFIX_PATH:-}" ]]; then
  echo "Set CMAKE_PREFIX_PATH to the LibTorch installation before building OpenSplat." >&2
  exit 2
fi

if [[ -z "${OPENCV_DIR:-}" ]]; then
  echo "Set OPENCV_DIR to the OpenCV CMake package directory before building OpenSplat." >&2
  exit 2
fi

GPU_RUNTIME="${GPU_RUNTIME:-CUDA}"
BUILD_JOBS="${BUILD_JOBS:-4}"

cmake \
  -S "$SOURCE_DIR" \
  -B "$BUILD_DIR" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_PREFIX_PATH="$CMAKE_PREFIX_PATH" \
  -DOPENCV_DIR="$OPENCV_DIR" \
  -DGPU_RUNTIME="$GPU_RUNTIME"

cmake --build "$BUILD_DIR" --parallel "$BUILD_JOBS"

if [[ ! -x "$BUILD_DIR/opensplat" ]]; then
  echo "OpenSplat build finished without producing $BUILD_DIR/opensplat." >&2
  exit 1
fi

echo "Built OpenSplat: $BUILD_DIR/opensplat"
