// Geometry-only browser fixture: measured road/median, SYNTHETIC traffic. No Electron/database.
import * as THREE from "three";
import { buildGeminiScene } from "../../../../src/gemini/engine";
import type { IncidentSpec, StaticObject } from "../../../../src/gemini/spec";
import { Painter } from "../../../../src/scene/draw";
import { applyWorldUVs, createSurfaces, resolveEnvironment } from "../../../../src/scene/environment";
import measuredDivider from "../data/divider.json";
import syntheticSpec from "./incident-spec.json";
import metadata from "./incident-spec.json.build.json";

const spec = structuredClone(syntheticSpec) as IncidentSpec;
const sourceObjects = [measuredDivider, ...measuredDivider.related_objects];
spec.static_objects = sourceObjects.map((o) => {
  const fp = o.footprint_W.map(([x, y]) => [metadata.X_REF - x, y - metadata.Y_median] as [number, number]).reverse();
  return { ...o, kind: o.kind as StaticObject["kind"], source: o.source as StaticObject["source"], immovable: true,
    footprint_m: fp, note: o.note };
});
const { layout } = buildGeminiScene({ id: "w3-browser-geometry", spec, seed: 1, created: "2026-11-15" });
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xcbd0d1);
scene.add(new THREE.HemisphereLight(0xe6edf3, 0x555549, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(20, 80, 30); scene.add(sun);
const group = new THREE.Group();
scene.add(group);
const pack = resolveEnvironment({ sky: "overcast", snow: 0.45, vegetation: "dormant", road: "dry" });
const surfaces = createSurfaces(pack);
const painter = new Painter(group, surfaces, layout.site);
layout.build(painter);
applyWorldUVs(group);
const canvas = document.querySelector("canvas")!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setSize(1200, 660);
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const camera = new THREE.PerspectiveCamera(42, 1200 / 660, 0.1, 2000);
const render = () => renderer.render(scene, camera);
const overview = () => { camera.position.set(-95, 160, 95); camera.lookAt(-90, 0, 8); render(); };
const near = () => { camera.position.set(48, 26, 32); camera.lookAt(-8, 0, 4); render(); };
document.querySelector("#overview")!.addEventListener("click", overview);
document.querySelector("#near")!.addEventListener("click", near);
const statuses = { source: "measured road and divider; traffic fixture synthetic", staticObjects: spec.static_objects.map((o) => ({ id: o.id, height: o.height_m, source: o.source })), colliders: group.userData.staticColliders.length,
  forwardLines: spec.road.lane_lines_forward_m, backwardLines: spec.road.lane_lines_backward_m, meshes: 0, triangles: 0 };
THREE.DefaultLoadingManager.onLoad = () => { render(); (window as any).__w3Ready = true; };
overview();
statuses.meshes = renderer.info.render.calls;
statuses.triangles = renderer.info.render.triangles;
(window as any).__w3Status = statuses;
(window as any).__w3Render = render;
document.querySelector("output")!.textContent = JSON.stringify(statuses);
