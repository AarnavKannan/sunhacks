import { driveVehicle, makeVehicle, type VehicleRig } from "@/scene/cars";
import { Painter } from "@/scene/draw";
import {
  applyWorldUVs,
  buildSurroundings,
  createSurfaces,
  DEFAULT_ENVIRONMENT,
  environmentKey,
  loadSky,
  releaseSky,
  resolveEnvironment,
  type SceneEnvironment,
} from "@/scene/environment";
import { getLayout, type Layout, type Pose } from "@/scene/layouts";
import { type CameraAdjustments } from "@/scene/camera";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

export type VehicleVisual = { id: string; color: string; label?: string };

export type SceneHandle = {
  showProxy: (layoutId: string, vehicles: VehicleVisual[], environment: SceneEnvironment) => void;
  showSplat: (bytes: Uint8Array, fileName: string, environment: SceneEnvironment) => Promise<void>;
  setTime: (time: number) => void;
  setCameraAdjustments: (adjustments: CameraAdjustments) => void;
  resetCamera: () => void;
  resize: () => void;
  render: () => void;
  dispose: () => void;
};

type Mover = { rig: VehicleRig; poseAt: (time: number) => Pose };

/** Step for finite differences on trajectories (s). */
const DT = 0.05;

function wrapAngle(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

type SplatMeshLike = THREE.Object3D & {
  initialized?: Promise<unknown>;
  dispose?: () => void;
};

const LOADING_BACKGROUND = 0x9aa4b2;

export async function mountScene(
  container: HTMLElement,
  onCameraChange: (adjustments: CameraAdjustments) => void,
): Promise<SceneHandle> {
  // No default-framebuffer MSAA: the composer below renders into its own multisampled
  // target, so built-in antialiasing would only cost memory (~65 MB at 1080p).
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  // 1.5x is visually close to 2x on HiDPI screens at ~56% of the buffer memory.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(LOADING_BACKGROUND, 1);
  // Neutral tone mapping leaves mid-tones untouched, so linear horizon colour as fog
  // matches the (untone-mapped) sRGB sky backdrop where the ground meets it.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  container.appendChild(renderer.domElement);

  // Post-processing chain, rendered in linear HDR:
  //   ambient occlusion (contact shadows under cars, curbs, barriers)
  //   -> bloom (only things brighter than white: lamps, brake lights, sun glints)
  //   -> tone mapping + sRGB output. Multisampling keeps edges smooth.
  const composer = new EffectComposer(
    renderer,
    new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }),
  );

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(LOADING_BACKGROUND);

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 3000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2.05;
  controls.minDistance = 6;
  controls.maxDistance = 220;
  controls.zoomToCursor = true;
  controls.target.set(-2, 0, 2);

  const hemi = new THREE.HemisphereLight(0xffffff, 0xb7c0c8, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.25);
  sun.position.set(28, 42, 16);
  sun.castShadow = true;
  // 2048^2 over the site (see placeSun) keeps shadow texels around 8 cm at 16 MB.
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.far = 400;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  let sparkReady = false;
  try {
    const spark = await import("@sparkjsdev/spark");
    scene.add(new spark.SparkRenderer({ renderer }));
    sparkReady = true;
  } catch (error) {
    console.error("Spark failed to initialize", error);
  }

  const proxy = new THREE.Group();
  scene.add(proxy);

  composer.addPass(new RenderPass(scene, camera));
  const ambientOcclusion = new GTAOPass(scene, camera, 1, 1);
  ambientOcclusion.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.5, thickness: 1.5, scale: 1.1, samples: 16 });
  ambientOcclusion.blendIntensity = 0.85;
  composer.addPass(ambientOcclusion);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.35, 2.4);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  let environment: SceneEnvironment | null = null;
  let pack = resolveEnvironment(DEFAULT_ENVIRONMENT);
  let skyToken = 0;
  let shownSky: string | null = null;
  let sunDirection = new THREE.Vector3(28, 42, 16).normalize();
  let currentLayout: Layout | null = null;
  let splatMesh: SplatMeshLike | null = null;
  let movers: Mover[] = [];
  const home = {
    position: new THREE.Vector3(34, 30, 36),
    target: new THREE.Vector3(-2, 0, 2),
  };

  const readCameraAdjustments = (): CameraAdjustments => {
    const baseOffset = home.position.clone().sub(home.target);
    const base = new THREE.Spherical().setFromVector3(baseOffset);
    const offset = camera.position.clone().sub(controls.target);
    const current = new THREE.Spherical().setFromVector3(offset);
    const round = (value: number) => Math.round(value * 1000) / 1000;
    return {
      panX: round(controls.target.x - home.target.x),
      panY: round(controls.target.y - home.target.y),
      panZ: round(controls.target.z - home.target.z),
      zoom: round(current.radius / base.radius),
      tilt: round(THREE.MathUtils.radToDeg(current.phi - base.phi)),
      rotate: round(THREE.MathUtils.radToDeg(wrapAngle(current.theta - base.theta))),
    };
  };

  const setCameraAdjustments = (adjustments: CameraAdjustments) => {
    const baseOffset = home.position.clone().sub(home.target);
    const base = new THREE.Spherical().setFromVector3(baseOffset);
    const target = home.target.clone().add(
      new THREE.Vector3(adjustments.panX, adjustments.panY, adjustments.panZ),
    );
    const minZoom = controls.minDistance / base.radius;
    const maxZoom = controls.maxDistance / base.radius;
    const radius = base.radius * THREE.MathUtils.clamp(adjustments.zoom, minZoom, maxZoom);
    const phi = THREE.MathUtils.clamp(
      base.phi + THREE.MathUtils.degToRad(adjustments.tilt),
      0.001,
      controls.maxPolarAngle,
    );
    const theta = base.theta + THREE.MathUtils.degToRad(adjustments.rotate);
    camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(new THREE.Spherical(radius, phi, theta)));
    controls.target.copy(target);
    controls.saveState();
    controls.reset();
    onCameraChange(readCameraAdjustments());
  };

  controls.addEventListener("change", () => onCameraChange(readCameraAdjustments()));

  const placeSun = () => {
    const center = currentLayout ? new THREE.Vector3(0, 0, 0) : controls.target.clone();
    const extent = currentLayout ? Math.max(currentLayout.site.width, currentLayout.site.depth) * 0.55 : 70;
    sun.target.position.copy(center);
    sun.position.copy(center).addScaledVector(sunDirection, 200);
    const shadow = sun.shadow.camera;
    shadow.left = -extent;
    shadow.right = extent;
    shadow.top = extent;
    shadow.bottom = -extent;
    shadow.updateProjectionMatrix();
  };

  const applyAtmosphere = () => {
    const token = ++skyToken;
    sun.color.set(pack.sunColor);
    sun.intensity = pack.sunIntensity;
    hemi.intensity = pack.hemiIntensity;

    void loadSky(pack.sky)
      .then((sky) => {
        if (token !== skyToken) return;
        // Free the sky we're replacing only now that the new one is on screen.
        if (shownSky && shownSky !== pack.sky) releaseSky(shownSky);
        shownSky = pack.sky;
        scene.background = sky.backdrop;
        scene.backgroundIntensity = pack.backgroundIntensity;
        scene.environment = sky.lighting;
        scene.environmentIntensity = pack.envIntensity;
        hemi.color.copy(sky.horizon);
        hemi.groundColor.set(0x5b5a50);
        const fog = new THREE.FogExp2(0xffffff, pack.fogDensity);
        // Match the backdrop as displayed, which night scales down.
        fog.color.copy(sky.horizon).multiplyScalar(pack.backgroundIntensity);
        scene.fog = fog;
        sunDirection = sky.sunDirection.clone();
        placeSun();
      })
      .catch((error) => console.error("Could not load sky", error));
  };

  /** Switches sky, light and materials; returns true when anything changed. */
  const useEnvironment = (next: SceneEnvironment) => {
    if (environment && environmentKey(environment) === environmentKey(next)) return false;
    environment = next;
    pack = resolveEnvironment(next);
    applyAtmosphere();
    return true;
  };

  const resize = () => {
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(width, height);
  };

  const applyHome = () => {
    camera.position.copy(home.position);
    controls.target.copy(home.target);
    controls.saveState();
    controls.reset();
    onCameraChange(readCameraAdjustments());
  };

  const disposeObject = (object: THREE.Object3D) => {
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material;
      const disposeMaterial = (item: THREE.Material) => {
        // Canvas textures (signs) are per-scene; shared texture files stay cached.
        const map = (item as THREE.MeshStandardMaterial).map;
        if (map instanceof THREE.CanvasTexture) map.dispose();
        item.dispose();
      };
      if (Array.isArray(material)) material.forEach(disposeMaterial);
      else if (material) disposeMaterial(material);
    });
  };

  const clearProxy = () => {
    movers = [];
    for (const child of [...proxy.children]) {
      proxy.remove(child);
      disposeObject(child);
    }
  };

  const clearSplat = () => {
    if (!splatMesh) return;
    scene.remove(splatMesh);
    splatMesh.dispose?.();
    splatMesh = null;
  };

  const buildProxy = (layout: Layout, vehicles: VehicleVisual[]) => {
    clearProxy();
    const surfaces = createSurfaces(pack);
    const painter = new Painter(proxy, surfaces, layout.site);
    layout.build(painter);
    buildSurroundings(proxy, pack, surfaces, layout.site, painter.obstacles);
    applyWorldUVs(proxy);
    proxy.visible = true;

    for (const vehicle of vehicles) {
      const motion = layout.vehicles.find((item) => item.id === vehicle.id);
      if (!motion) continue;
      const rig = makeVehicle(motion.kind ?? "car", vehicle.color, vehicle.id, vehicle.label);
      rig.root.scale.setScalar(motion.scale ?? 1);
      proxy.add(rig.root);
      movers.push({ rig, poseAt: motion.poseAt });
    }
    placeSun();
  };

  const showProxy = (layoutId: string, vehicles: VehicleVisual[], next: SceneEnvironment) => {
    const layout = getLayout(layoutId);
    if (!layout) return;
    useEnvironment(next);
    clearSplat();
    ambientOcclusion.enabled = true;
    currentLayout = layout;
    buildProxy(layout, vehicles);
    home.position.set(...layout.camera.position);
    home.target.set(...layout.camera.target);
    applyHome();
  };

  const frameObject = (object: THREE.Object3D) => {
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 1);
    home.target.copy(center);
    home.position.copy(center).add(new THREE.Vector3(radius * 0.9, radius * 0.72, radius * 0.95));
    applyHome();
  };

  const showSplat = async (bytes: Uint8Array, fileName: string, next: SceneEnvironment) => {
    if (!sparkReady) {
      throw new Error("Spark is not available in this window, so the splat file cannot be rendered.");
    }
    const spark = await import("@sparkjsdev/spark");
    useEnvironment(next);
    clearSplat();
    clearProxy();
    currentLayout = null;
    proxy.visible = false;
    // Ambient occlusion is computed from mesh depth/normals; splats don't provide them.
    ambientOcclusion.enabled = false;

    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const mesh = new spark.SplatMesh({ fileBytes: copy, fileName }) as SplatMeshLike;
    mesh.quaternion.set(1, 0, 0, 0);
    scene.add(mesh);
    splatMesh = mesh;
    if (mesh.initialized) await mesh.initialized;
    frameObject(mesh);
  };

  /** Speed along the heading at `time`, by central difference. */
  const speedAt = (poseAt: (time: number) => Pose, time: number) => {
    const a = poseAt(time - DT);
    const b = poseAt(time + DT);
    const heading = poseAt(time).yaw;
    return ((b.x - a.x) * Math.sin(heading) + (b.z - a.z) * Math.cos(heading)) / (2 * DT);
  };

  const setTime = (time: number) => {
    for (const mover of movers) {
      const pose = mover.poseAt(time);
      mover.rig.root.position.set(pose.x, 0, pose.z);
      mover.rig.root.rotation.y = pose.yaw;

      // Motion state from the trajectory itself, so any poseAt (scripted now, simulated
      // or tracked later) drives wheels, brake lights and suspension consistently.
      const speed = speedAt(mover.poseAt, time);
      let accel = (speedAt(mover.poseAt, time + DT) - speedAt(mover.poseAt, time - DT)) / (2 * DT);
      // A looped road teleports cars; ignore the resulting spike.
      if (!Number.isFinite(accel) || Math.abs(accel) > 15) accel = 0;
      const yawRate = wrapAngle(mover.poseAt(time + DT).yaw - mover.poseAt(time - DT).yaw) / (2 * DT);
      driveVehicle(mover.rig, { speed, accel, yawRate: Math.abs(speed) > 0.2 ? yawRate : 0, lamps: pack.lamps });
    }
  };

  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  let disposed = false;

  return {
    showProxy,
    showSplat,
    setTime,
    setCameraAdjustments,
    resetCamera: applyHome,
    resize,
    render: () => {
      if (disposed) return;
      controls.update();
      composer.render();
    },
    dispose: () => {
      disposed = true;
      skyToken += 1;
      observer.disconnect();
      controls.dispose();
      clearProxy();
      clearSplat();
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
