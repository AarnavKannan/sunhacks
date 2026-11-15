import { makeCar } from "@/scene/cars";
import { getLayout, type Pose } from "@/scene/layouts";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export type VehicleVisual = { id: string; color: string };

export type SceneHandle = {
  showProxy: (layoutId: string, vehicles: VehicleVisual[]) => void;
  showSplat: (bytes: Uint8Array, fileName: string) => Promise<void>;
  setTime: (time: number) => void;
  resetCamera: () => void;
  resize: () => void;
  render: () => void;
  dispose: () => void;
};

type Mover = { object: THREE.Object3D; poseAt: (time: number) => Pose };

type SplatMeshLike = THREE.Object3D & {
  initialized?: Promise<unknown>;
  dispose?: () => void;
};

export async function mountScene(container: HTMLElement): Promise<SceneHandle> {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x0a2378, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a2378);

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 500);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2.05;
  controls.minDistance = 6;
  controls.maxDistance = 140;
  controls.zoomToCursor = true;
  controls.target.set(-2, 0, 2);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xb7c0c8, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.25);
  sun.position.set(28, 42, 16);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -70;
  sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70;
  sun.shadow.camera.bottom = -70;
  sun.shadow.camera.far = 140;
  sun.shadow.bias = -0.0004;
  scene.add(sun);

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

  let splatMesh: SplatMeshLike | null = null;
  let movers: Mover[] = [];
  const home = {
    position: new THREE.Vector3(34, 30, 36),
    target: new THREE.Vector3(-2, 0, 2),
  };

  const resize = () => {
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };

  const applyHome = () => {
    camera.position.copy(home.position);
    controls.target.copy(home.target);
    controls.update();
  };

  const disposeObject = (object: THREE.Object3D) => {
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((item) => item.dispose());
      else material?.dispose();
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

  const showProxy = (layoutId: string, vehicles: VehicleVisual[]) => {
    const layout = getLayout(layoutId);
    if (!layout) return;
    clearSplat();
    clearProxy();
    layout.build(proxy);
    proxy.visible = true;

    for (const vehicle of vehicles) {
      const motion = layout.vehicles.find((item) => item.id === vehicle.id);
      if (!motion) continue;
      const car = makeCar(vehicle.color);
      car.scale.setScalar(motion.scale ?? 1);
      proxy.add(car);
      movers.push({ object: car, poseAt: motion.poseAt });
    }

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

  const showSplat = async (bytes: Uint8Array, fileName: string) => {
    if (!sparkReady) {
      throw new Error("Spark is not available in this window, so the splat file cannot be rendered.");
    }
    const spark = await import("@sparkjsdev/spark");
    clearSplat();
    clearProxy();
    proxy.visible = false;

    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const mesh = new spark.SplatMesh({ fileBytes: copy, fileName }) as SplatMeshLike;
    mesh.quaternion.set(1, 0, 0, 0);
    scene.add(mesh);
    splatMesh = mesh;
    if (mesh.initialized) await mesh.initialized;
    frameObject(mesh);
  };

  const setTime = (time: number) => {
    for (const mover of movers) {
      const pose = mover.poseAt(time);
      mover.object.position.set(pose.x, 0, pose.z);
      mover.object.rotation.y = pose.yaw;
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
    resetCamera: applyHome,
    resize,
    render: () => {
      if (disposed) return;
      controls.update();
      renderer.render(scene, camera);
    },
    dispose: () => {
      disposed = true;
      observer.disconnect();
      controls.dispose();
      clearProxy();
      clearSplat();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
