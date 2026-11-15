# Handoff: Reconstruction track (Role 1)

> From: the current Reconstruction lead (Role 1 in [roles.md](roles.md)). Written 2026-11-14.
> To: whoever takes over reconstruction, running on **their own GPU machine, not ASU Sol**.
> Read with: [requirements.md](requirements.md) (sections 5.1, 6 and 10) and [roles.md](roles.md).

---

## 0. Prompt to paste into your AI coding assistant

```text
You are taking over the "Reconstruction" track (Role 1) of a hackathon project that turns traffic-incident
video into a 4D Gaussian-splat scene. Read these files in the repo first, in this order:
  1. HANDOFF.md              (this handoff: history, decisions, known problems, how to run locally)
  2. requirements.md         (product spec; sections 5.1, 6 and 10 matter most for this track)
  3. roles.md                (who owns what; Role 1 delivers background.spz, vehicles/*.spz, cameras.json)
  4. sol/ingest.py, sol/add_holdout.py, sol/export_cameras.py, sol/diagnose_poses.py,
     sol/fused_ssim_shim/    (portable code)
  5. sol/*.sbatch, sol/config.sh, sol/submit_all.sh   (Slurm jobs for ASU Sol; reference only, I am NOT using Sol)
  6. handoff_artifacts/README.md   (what was copied off Sol and what is still valid)

My machine: <FILL IN: OS + version, GPU model + VRAM, NVIDIA driver version (nvidia-smi), conda/mamba or venv>.

Goals, in order:
  A. Check my machine against HANDOFF.md section 6.1, set up both environments (section 6.2), and confirm
     gsplat's CUDA backend loads ("from gsplat import csrc").
  B. Re-run camera poses with the fixed step (VGGT on the 4 real cameras only), then run
     sol/diagnose_poses.py and show me the numbers and both images. Tell me plainly whether all
     4 cameras ended up in one consistent 3D scene.
  C. If they did not (likely, see HANDOFF.md section 3.1), help me pick a geometry source from
     HANDOFF.md section 8 item 1 before spending time on splat training.
  D. Then train the background splat (section 6.2, last block), report PSNR/SSIM and the Gaussian count,
     and render views near and away from the source cameras.

Constraints: keep the pinned versions in HANDOFF.md section 5 unless my GPU needs newer ones (see 6.1).
Do not reintroduce the CUDA-compiled fused-ssim; keep the pure-PyTorch shim. Do not feed the 0_holdout
duplicate to VGGT. Explain any deviation.
```

---

## 1. TL;DR

- **Goal of this track:** video → static background splat + per-vehicle splats + camera poses
  (`background.spz`, `vehicles/*.spz`, `cameras.json`, see requirements.md section 6).
- **Built:** a 3-step pipeline, **ingest → camera poses (VGGT) → background splat (gsplat)**, on a
  practice clip. Vehicle splats were **not started** (the plan is the proxy-mesh fallback).
- **Status:**
  - ✅ **Ingest works.** The clip is split into 4 cameras, and each gets a clean "empty road" image.
  - ⚠️ **The poses step runs, but the geometry is unusable.** VGGT could not place the 4 cameras into
    one consistent 3D scene: every 3D point came from cam1, and the other cameras see almost none of
    them (section 3.1). Part of this was my bug (VGGT was fed a duplicate of cam1, now fixed). The main
    cause is that **these 4 fixed cameras barely see the same stretch of road**.
  - ❌ **The background splat was never trained.** Every attempt on Sol failed for Sol-specific reasons
    (old OS / glibc 2.28, a CUDA compiler crash, a network timeout, an opencv install quirk). None of
    these apply on a modern Linux GPU machine.
- **What to do first:** set up locally (section 6) and re-run poses with the fix. Expect to need
  **another source of geometry** (dataset calibration, or footage with overlapping/moving cameras)
  before a background splat is worth training (section 8).

---

## 2. The practice clip

| Property | Value |
|---|---|
| File | `r05_s03_labels_visualization.mp4` (renamed `videos/r05_s03.mp4` in the scripts) |
| SHA-256 | `a02fe07d46091bbde14d9c58a16d94680f18d15ad48b3f316d25e03c3938e54a` |
| Format | 960×610, 12.5 fps, 749 frames, 59.9 s, H.264 |
| Content | **4 fixed highway cameras tiled 2×2 into one frame**, normal traffic, snow on the verges |
| Source (unconfirmed) | The "p)" logo suggests the TUM Traffic / Providentia A9 highway dataset. If so, the dataset ships **official camera calibration, LiDAR and 3D box labels**. That would fix the geometry problem and save Role 2 most of the tracking work. **Confirm this first.** |

**Problems with this clip as demo footage:**
1. **3D label boxes are burned into the pixels.** The median plates remove them for the background, but
   they remain on every car. Get the raw, unlabeled footage if possible.
2. **There is no collision.** It's fine for practice, but the demo (requirements.md section 2) needs an
   impact event.
3. **4 static cameras with almost no overlap.** This is the root of the geometry failure (section 3.1).
4. **Low resolution:** 478×300 per camera. Cars cover about 50–150 px, so **vehicle splats will very
   likely need the proxy-mesh fallback** (requirements.md section 10).

Tile layout, as ffmpeg `crop=w:h:x:y`. **Offsets and sizes must be even:** ffmpeg rounds odd values for
yuv420 video, and `x=481` pulled the black divider into cam2 and cam4.

```
cam1=478:300:0:0      cam2=478:300:482:0
cam3=478:300:0:304    cam4=478:300:482:304
```

---

## 3. Pipeline design

| Step | Code | What it does | Key decisions |
|---|---|---|---|
| **Ingest** (CPU, ~10 s) | `sol/ingest.py` | Hashes the video, splits the mosaic into `frames/cam{1..4}/` (749 JPEGs each), and builds one **empty-road plate per camera** (per-pixel median of every 5th frame). Paints over the static "p)" logo. Writes `scene/images/{0_holdout,cam1..cam4}.png` and `ingest_meta.json`. | The median removes moving cars **and** the burned-in label boxes, so the background needs no masks. The logo is screen-fixed and would become a floating blob, so it's patched. **Known flaw:** slow or stopped traffic leaves faint "ghost vans" in the cam3/cam4 plates; Role 2's SAM 2 masks would fix this. |
| **Poses** (GPU, ~2 min) | VGGT `demo_colmap.py` → `sol/add_holdout.py` → `sol/export_cameras.py` → `sol/diagnose_poses.py` | VGGT-1B estimates intrinsics and extrinsics for the **4 real plates** and writes a COLMAP model. `0_holdout` is then added as a copy of cam1, `cameras.json` is exported, and diagnostics are saved. | The cameras are static, so one pose per camera is enough. VGGT's default confidence cut (5.0) kept **0 points**, so the step lowers it `5 → 3 → 2 → 1.5 → 1.2 → 1.05` until there are ≥ 20,000 points (1.0 is the minimum possible). On Sol it took 1.2 to get any points at all, which means VGGT had low confidence everywhere. |
| **Background splat** (GPU, ~5–15 min) | gsplat `examples/simple_trainer.py` | Trains 3D Gaussians on the 5 plates with the VGGT poses for 7,000 steps → `bg/ply/point_cloud_6999.ply` → `package/.../background.ply`. | `--disable_viewer` is **required** in non-interactive runs, otherwise it waits for Ctrl+C. `--disable_video` saves time. 7k steps is enough for 4 views. |
| **Vehicle splats** | — | **Not started.** | Plan: proxy car meshes sized per vehicle, driven by Role 2's tracks. |

**Why `0_holdout.png` exists:** gsplat's COLMAP loader always holds out image index 0 (sorted by name)
for evaluation. A copy of cam1 named `0_holdout.png` sorts first, so all 4 real cameras are trained on.
**It must not be given to VGGT.** Two identical images make VGGT confident about that one view only.

**`cameras.json`** (from `sol/export_cameras.py`; agree the final schema with Role 3): per camera `id, width,
height, model, params, R_cam_from_world, t_cam_from_world, center_world, static`. COLMAP/OpenCV axes
(x right, y down, z forward). **The world frame and scale are VGGT's arbitrary ones: not metric, not
Y-up.** Converting to the agreed convention (requirements.md section 6) is still to do.

### 3.1 Why the current poses can't be trusted (checked after the Sol run)

`sol/diagnose_poses.py` on the Sol model (copied to `handoff_artifacts/diagnostics/`):

| Camera | Centre (VGGT units) | Focal (px) | 3D points from this camera | Image area covered by reprojected points |
|---|---|---|---|---|
| cam1 | [0.000, 0.000, 0.000] | 661.7 | 54,983 (+45,017 from its duplicate) | **36.8%** |
| cam2 | [-0.152, -0.111, 0.741] | 737.3 | 0 | **0.0%** (the points are behind it) |
| cam3 | [-0.362, -0.514, 2.012] | 623.1 | 0 | **0.3%** |
| cam4 | [-0.280, -0.419, 1.617] | 731.5 | 0 | **0.5%** |

All 100k points form a small patch of road just in front of cam1 (extent about 0.1 × 0.08 units), while
the other cameras are spread up to 2 units away. **The 4 cameras were not registered into one scene.**
A splat trained on this would only learn cam1's patch, and the other 3 views would end up as
disconnected floaters.

Likely causes:
1. **My bug:** VGGT was fed `0_holdout.png`, an identical copy of cam1, which biases it towards cam1.
   **Fixed:** VGGT now gets only `cam*.png`, and the holdout is added afterwards with `add_holdout.py`.
2. **The real problem:** the 4 cameras look at different stretches of road; cam1/cam2 and cam3/cam4
   appear to face opposite directions. Feed-forward methods like VGGT need shared content between
   views. The fix in (1) may not be enough. See section 8, item 1.

**Good result** (for any future footage): every camera has thousands of points "from this camera" and
covers a large share of its image, and `vggt_reprojection.jpg` shows the points lining up with the road.

---

## 4. Everything that went wrong, and the fix (chronological)

| # | Symptom | Root cause | Fix (in the code) |
|---|---|---|---|
| 1 | The "ASU AI getting started" docs didn't help | That page is about ASU AIR (Intel Gaudi, Kubernetes/API), not Slurm GPU jobs | Used Sol's Slurm/partition/GPU/mamba docs |
| 2 | `Failed building wheel for fused_ssim` | CUDA compile of fused-ssim failed on Sol | **Pure-PyTorch shim** `sol/fused_ssim_shim/`. Same signature and maths; matches scikit-image SSIM to 2.6e-6, gradients verified. Slower, irrelevant here. |
| 3 | Black stripe on the left of cam2/cam4 | Odd crop offset (481) rounded by ffmpeg into the divider | Even crops: width 478, x = 482 |
| 4 | `numpy.linalg.LinAlgError: Eigenvalues did not converge` | VGGT kept **0 points** at conf ≥ 5.0, and gsplat's loader needs points to centre the scene, even for `--init_type random` | Threshold step-down loop; background refuses to run with < 1,000 points |
| 5 | `nvcc error: 'fatbinary' died due to signal 11` | gsplat's **prebuilt** `csrc.so` needs **glibc ≥ 2.32** (log: `/lib64/libm.so.6: version 'GLIBC_2.29' not found`), but Sol (Rocky Linux 8.10) has 2.28. gsplat then silently **JIT-compiles** CUDA, and nvcc crashes. | On Sol: run gsplat inside an Ubuntu 22.04 Apptainer container (`gs_run` in `sol/config.sh`). **Not needed on a modern Linux box.** |
| 6 | `FATAL: ... registry-1.docker.io ... TLS handshake timeout` | Network timeout pulling `docker://ubuntu:22.04` | Use Sol's `/packages/apps/simg/ubuntu-22.04.sif` (found and used OK), with Docker Hub and `public.ecr.aws` as fallbacks |
| 7 | `ModuleNotFoundError: No module named 'cv2'` (in the container) | `opencv-python` and `opencv-python-headless` share the `cv2/` folder. Uninstalling the first deleted the second's files, and pip then said headless was "already satisfied". | Requirements now ask for `opencv-python-headless<4.12` directly, plus a `--force-reinstall` of headless |
| 8 | Poses "succeeded" but the geometry is degenerate (section 3.1) | Duplicate cam1 fed to VGGT, and almost no overlap between cameras | VGGT gets the real cameras only; added `diagnose_poses.py`. **The overlap problem is not solved.** |

**General lesson:** `import gsplat` succeeding does **not** mean the CUDA backend works, because it
loads lazily. Always check with `python -c "import torch; from gsplat import csrc"`. If that fails,
gsplat tries to compile itself at the first rasterization call.

---

## 5. Pinned versions (known-good combination)

| Component | Version | Why pinned |
|---|---|---|
| PyTorch | **2.3.1 + cu121** (both envs) | VGGT's `requirements.txt` pins 2.3.1; gsplat publishes prebuilt 1.5.3 wheels for torch 2.3/cu121 |
| VGGT | commit **`a288dd0f14786c93483e45524328726ab7b1b4ce`** | Installed and ran on Sol |
| VGGT weights | `facebook/VGGT-1B` `model.pt` (~5 GB) | Downloaded by `torch.hub` into `$TORCH_HOME` |
| gsplat | **1.5.3**, prebuilt wheel from `https://docs.gsplat.studio/whl/pt23cu121` (cp310, so **Python 3.10**) | No CUDA compile. A `pt24cu124` 1.5.3 build also exists (linux + win, cp310). **No 1.5.3 wheels exist for torch ≥ 2.5.** |
| gsplat examples | git tag `v1.5.3` | `main` has moved to torch 2.9 with heavy extra dependencies |
| pycolmap | official **3.10.0** (vggt env); **rmbrualla fork** (gs env) | Both install as `pycolmap`, hence **two separate environments** |
| viser / tyro | `viser==0.2.23`, `tyro>=0.8.8,<1.0` | gsplat 1.5.3 leaves them unpinned |
| numpy | `<2` | torch 2.3 / gsplat 1.5.3 era |
| opencv (gs env) | `opencv-python-headless<4.12` **instead of** `opencv-python` | No libGL needed; see section 4, #7 |
| fused-ssim | **shim** (`sol/fused_ssim_shim`) | See section 4, #2 |
| fused-bilagrid | not installed | Only imported when bilateral grids are enabled |

Environments: `vggt` = Python 3.11 + ffmpeg (ingest, poses, diagnostics). `gs` = Python 3.10 (training).

---

## 6. Running it on your own machine (no Sol, no Slurm, no container)

### 6.1 Check your machine first
- **Linux x86-64 with an NVIDIA GPU** is the supported path. Run `ldd --version`: it must report
  **glibc ≥ 2.32** (Ubuntu 22.04 = 2.35, 24.04 = 2.39). If it's older, you have the Sol problem
  (section 4, #5); use a container or a newer OS.
- **Windows:** use **WSL2 + Ubuntu 22.04/24.04** (recommended). gsplat 1.5.3 also has `win_amd64` wheels,
  but this pipeline is untested on native Windows.
- **macOS:** **not supported** for training. There's no CUDA, so gsplat can't run. Ingest and
  diagnostics work anywhere.
- **GPU generation:** the pinned torch 2.3.1/cu121 supports up to Hopper (sm_90): RTX 20/30/40, A100,
  H100, L40S.
  - **RTX 50-series (Blackwell, sm_120) is not supported by torch 2.3.1.** You'd need torch ≥ 2.7 with
    cu128, override VGGT's `torch==2.3.1` pin, and **build gsplat 1.5.3 from source**, since no
    prebuilt wheel exists for those versions. Expect to debug that.
- **Driver:** recent enough for CUDA 12.1 (`nvidia-smi` shows "CUDA Version" ≥ 12.1).
- **VRAM:** ≥ 16 GB is comfortable; this scene is tiny. **Disk:** about 25 GB (two environments,
  torch ×2, 5 GB of VGGT weights).

### 6.2 Commands (Linux/WSL, conda or mamba)
Run from the repo root. Put the video at `videos/r05_s03.mp4`, or skip ingest and copy
`handoff_artifacts/scene/images` to `$WORK/scene/images`.

```bash
ROOT=$PWD
WORK=$ROOT/work/r05_s03            # intermediate files
PKG=$ROOT/package/incident-r05_s03 # deliverables
SRC=$ROOT/third_party              # cloned repos
export TORCH_HOME=$ROOT/.cache/torch
mkdir -p "$WORK" "$PKG/debug" "$SRC" "$TORCH_HOME"

# ---------- vggt env: ingest + poses + diagnostics ----------
mamba create -y -n vggt -c conda-forge python=3.11 pip ffmpeg git
conda activate vggt
pip install torch==2.3.1 torchvision==0.18.1 --index-url https://download.pytorch.org/whl/cu121
git clone https://github.com/facebookresearch/vggt.git "$SRC/vggt"
git -C "$SRC/vggt" checkout a288dd0f14786c93483e45524328726ab7b1b4ce
pip install -r "$SRC/vggt/requirements.txt" -r "$SRC/vggt/requirements_demo.txt"
pip install -e "$SRC/vggt"

# Ingest (CPU, about 10 s)
python sol/ingest.py videos/r05_s03.mp4 "$WORK" \
  cam1=478:300:0:0 cam2=478:300:482:0 cam3=478:300:0:304 cam4=478:300:482:304

# Poses (GPU): VGGT sees ONLY the real cameras, never 0_holdout
VIN=$WORK/vggt_input; rm -rf "$VIN"; mkdir -p "$VIN/images"; cp "$WORK"/scene/images/cam*.png "$VIN/images/"
cd "$SRC/vggt"
for T in 5 3 2 1.5 1.2 1.05; do
  rm -rf "$VIN/sparse"
  python demo_colmap.py --scene_dir "$VIN" --seed 42 --conf_thres_value "$T"
  N=$(grep -a -m1 "element vertex" "$VIN/sparse/points.ply" | awk '{print $3}')
  echo ">>> conf_thres_value=$T -> ${N:-0} points"
  [ "${N:-0}" -ge 20000 ] && break
done
cd "$ROOT"
rm -rf "$WORK/scene/sparse"; cp -r "$VIN/sparse" "$WORK/scene/sparse"
python sol/add_holdout.py "$WORK/scene/sparse" cam1.png 0_holdout.png
python sol/export_cameras.py "$WORK/scene/sparse" "$PKG/cameras.json"
cp "$WORK/scene/sparse/points.ply" "$PKG/debug/vggt_points.ply"
python sol/diagnose_poses.py "$WORK/scene" "$PKG/debug"   # READ THIS before training (section 3.1)
conda deactivate

# ---------- gs env: background splat ----------
mamba create -y -n gs -c conda-forge python=3.10 pip git
conda activate gs
pip install torch==2.3.1 torchvision==0.18.1 --index-url https://download.pytorch.org/whl/cu121
pip install ninja "numpy<2" jaxtyping "rich>=12"
pip install --no-deps gsplat==1.5.3 --index-url https://docs.gsplat.studio/whl/pt23cu121
git clone --depth 1 --branch v1.5.3 https://github.com/nerfstudio-project/gsplat.git "$SRC/gsplat"
grep -v -e fused-bilagrid -e fused-ssim "$SRC/gsplat/examples/requirements.txt" \
  | sed -e 's/^viser$/viser==0.2.23/' -e 's/^tyro.*/tyro>=0.8.8,<1.0/' \
        -e 's/^opencv-python$/opencv-python-headless<4.12/' > "$SRC/gs_requirements.txt"
pip install --no-build-isolation -r "$SRC/gs_requirements.txt"
pip install --force-reinstall --no-deps ./sol/fused_ssim_shim

# MUST print "... True". If "from gsplat import csrc" fails, stop: see section 4, #5.
python -c "import torch, cv2; from gsplat import csrc; print('gsplat CUDA backend OK, GPU:', torch.cuda.is_available())"

# Train (about 5-15 min). Only worth it once diagnose_poses looks sane.
cd "$SRC/gsplat/examples"
python simple_trainer.py default \
  --data_dir "$WORK/scene" --data_factor 1 --result_dir "$WORK/bg" \
  --max_steps 7000 --init_type sfm --save_ply --disable_viewer --disable_video
cd "$ROOT"
cp "$(ls -t "$WORK"/bg/ply/*.ply | head -1)" "$PKG/background.ply"
cat "$WORK"/bg/stats/val_step*.json   # PSNR/SSIM/LPIPS on the held-out cam1 copy
```

### 6.3 What "good" looks like
- **Poses:** `diagnose_poses.py` shows points coming from **every** camera and a large image-area coverage
  for each one, and `debug/vggt_reprojection.jpg` shows the points lining up with the road in all 4
  views. Also note the `>>> conf_thres_value` it settled on: needing 1.2 or lower means VGGT is unsure.
- **Training:** `val_step6999.json` exists. PSNR > ~25 dB on the held-out view is decent; < ~20 dB
  means poses or data are bad. The splat should look right **near** the source cameras, and artifacts
  far from them are expected. Note that the held-out view is a copy of cam1, a training view, so PSNR
  is optimistic. Judge by renders from the other cameras too.
- Spark (`@sparkjsdev/spark`, the viewer library) loads `.ply` directly, so `.spz` conversion is optional.

---

## 7. State on ASU Sol (reference only)

Layout: `/scratch/<asurite>/sunhacks/{sol,videos,envs,src,cache,containers,work,package,logs}`.
Scratch files untouched for 90 days are deleted. Outputs were copied into `handoff_artifacts/`
(see its README for what's still valid).

| Job | Result |
|---|---|
| 1518552 setup | Failed: fused-ssim CUDA build → shim |
| 1521234 setup / 1521235 ingest / 1521236 poses | **Succeeded** (poses kept 0 points) |
| 1521237 background | Failed: 0 points → threshold loop |
| 1522346 poses | **Succeeded:** threshold 5/3/2/1.5 → 0 points, **1.2 → 100,000** (capped). Geometry degenerate (section 3.1). |
| 1522348 background | Failed: glibc 2.28 → JIT → nvcc segfault → container |
| 1523298 setup | Failed: Docker Hub TLS timeout → Sol's local image + mirrors |
| 1523299 background | Cancelled (its dependency, 1523298, failed) |
| 1523629 setup | Failed: found `/packages/apps/simg/ubuntu-22.04.sif` OK, then `No module named 'cv2'` → opencv fix (section 4, #7). **The container check and training were never reached.** |

On Sol: `bash sol/submit_all.sh` (full chain) or `FROM=poses|background bash sol/submit_all.sh`.
Setup only runs when `envs/.ready` is missing. Emails go to `<asurite>@asu.edu` (override with
`MAIL_USER=`). Jobs after a failed job are auto-cancelled.

---

## 8. Open items for the reconstruction track (priority order)

1. **Get usable geometry.** In order of effort:
   - **(a) Dataset calibration:** if this is TUM Traffic A9, use its official per-camera
     intrinsics/extrinsics (and LiDAR point clouds to initialise the splat) instead of VGGT. Then
     write them as a COLMAP model the same way, so gsplat can read them.
   - **(b) Re-run VGGT with the duplicate fix** and check `diagnose_poses.py`. It may improve, but
     don't expect miracles with this little overlap.
   - **(c) Different footage:** a moving camera (dashcam, phone walk-around) or several cameras that
     see the same intersection. Feed-forward pose methods need shared content.
   - **(d) Fallback:** per-camera "2.5D" backgrounds from monocular depth. You can view each camera's
     area, but not orbit freely between them.
2. **Train and check the background splat** (section 6.2) once item 1 gives sane diagnostics.
3. **Get the right footage for the demo:** the raw, unlabeled version, and ideally the actual incident
   with a collision.
4. **Coordinate frame:** convert `cameras.json` and the splats to meters, Y-up, landmark origin
   (requirements.md section 6). Agree the frame with Roles 2 and 3. Scale can come from lane width or
   dash spacing (requirements.md P7).
5. **Vehicles:** with ~50–150 px cars, go straight to the **proxy-mesh fallback** (sized car models
   moved by Role 2's `tracks.json`), unless better footage arrives.
6. **Masks:** use Role 2's SAM 2 vehicle masks to remove the ghost vans from the cam3/cam4 plates. A
   colour-threshold detector for the burned-in boxes (cyan, yellow, green hues) was prototyped; it missed
   faint yellow lines and needs a "present in > 50% of frames = scene, not label" filter.
7. **`.spz` export**, if file size matters for the viewer.
8. **Keep a known-good scene package** at all times (roles.md pairing rules).

---

## 9. File index

| Path | Portable? | Purpose |
|---|---|---|
| `sol/ingest.py` | ✅ | Mosaic split, hashes, median plates, scene layout |
| `sol/add_holdout.py` | ✅ | Adds the `0_holdout` copy of cam1 to a COLMAP model **after** VGGT |
| `sol/export_cameras.py` | ✅ | COLMAP → `cameras.json` (pycolmap 3.10) |
| `sol/diagnose_poses.py` | ✅ | Per-camera point and coverage stats, reprojection sheet, top-down map |
| `sol/fused_ssim_shim/` | ✅ | Pure-PyTorch `fused_ssim` drop-in (`pip install`) |
| `sol/config.sh` | Sol only | Paths, tiles, pins, `activate`, `gs_run` container wrapper |
| `sol/setup_env.sbatch` | Sol only | Builds both environments, caches weights, gets the container |
| `sol/ingest.sbatch`, `poses.sbatch`, `background.sbatch` | Sol only | Slurm jobs; the logic matches section 6.2 |
| `sol/submit_all.sh` | Sol only | Chains jobs with `afterok`, emails, `FROM=` restart |
| `handoff_artifacts/` | — | Outputs copied from Sol, with a README on validity |
