# CRASHVZN

Desktop app and offline pipeline that turn traffic-incident video into an explorable **4D reconstruction** (3D scene + time) with per-vehicle kinematics. Users scrub the timeline, measure the scene, or drive the viewer by chat/voice through MCP tools.

This repository (`sunhacks`) is the hackathon monorepo for that product. Marketing site: [crashvzn.us](https://crashvzn.us).

## Repository layout

| Path | What it is |
| --- | --- |
| [`apps/desktop`](apps/desktop) | Electron + React viewer |
| [`apps/landing`](apps/landing) | Marketing site (Vite) |
| [`packages/assistant`](packages/assistant) | Chat/voice assistant + MCP tool layer |
| [`packages/scene-types`](packages/scene-types) | Shared TypeScript types for scene packages |
| [`pipeline`](pipeline) | Python `reconstruct` CLI, Sol/OpenSplat scripts, Slurm |
| [`schema`](schema) | JSON Schema for scene packages (source of truth) |
| [`scene-packages`](scene-packages) | Built incident packages (e.g. `incident-demo`) |
| [`data`](data) | Reference footage (`demo.mp4`, `demo_32s.mp4`) and samples |
| [`docs`](docs) | Requirements, roles, status, UX notes, handoff |
| [`assets`](assets) | Brand artwork |
| [`vendor`](vendor) | Third-party Git submodules (OpenSplat, VGGT, Hex, …) |

```
videos ──▶ pipeline (track + kinematics [+ optional OpenSplat])
              │
              ▼
        scene-packages/…  ──▶  apps/desktop  ◀──  packages/assistant (MCP / voice)
```

## Quick start

**Viewer**

```sh
git submodule update --init --recursive   # if you need vendor tools later
cd packages/assistant && npm install
cd ../../apps/desktop && npm install && npm start
```

Load a scene package from [`scene-packages/`](scene-packages) or use the built-in demo path in the app.

**Pipeline** (regenerate the measured package)

```sh
python3 -m venv pipeline/.venv
pipeline/.venv/bin/pip install -e "pipeline/[dev]"
pipeline/.venv/bin/reconstruct build
pipeline/.venv/bin/reconstruct validate scene-packages/incident-demo
```

**Landing page**

```sh
cd apps/landing && npm install && npm run dev
```

## Docs

- [`docs/requirements.md`](docs/requirements.md) — product scope and architecture
- [`docs/roles.md`](docs/roles.md) — team hand-offs
- [`docs/STATUS.md`](docs/STATUS.md) — current `incident-demo` package status
- [`docs/HANDOFF.md`](docs/HANDOFF.md) — demo harness handoff notes
- [`pipeline/README.md`](pipeline/README.md) — Sol / OpenSplat jobs
- [`CREDITS.md`](CREDITS.md) — open-source licenses and assets (update it when you add something new)

## Submodules

Third-party code lives under `vendor/`. After clone:

```sh
git submodule update --init --recursive
```
