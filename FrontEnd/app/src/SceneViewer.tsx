import { useEffect, useRef } from "react";
import * as THREE from "three";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { useSceneStore } from "./store";

type SceneViewerProps = {
  onRendererError: (message: string) => void;
  cameraPreset: "iso" | "top";
};

function createCar(color: number, accent: number) {
  const car = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.48, 0.82),
    new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.08 }),
  );
  body.position.y = 0.36;
  car.add(body);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(0.82, 0.4, 0.7),
    new THREE.MeshStandardMaterial({
      color: 0x293d4b,
      roughness: 0.22,
      metalness: 0.12,
      transparent: true,
      opacity: 0.93,
    }),
  );
  cabin.position.set(-0.06, 0.77, 0);
  car.add(cabin);

  const bumper = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.12, 0.78),
    new THREE.MeshStandardMaterial({ color: accent, roughness: 0.4 }),
  );
  bumper.position.set(0.88, 0.31, 0);
  car.add(bumper);

  const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x17202b, roughness: 0.8 });
  for (const x of [-0.55, 0.55]) {
    for (const z of [-0.43, 0.43]) {
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.19, 0.19, 0.12, 16),
        wheelMaterial,
      );
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(x, 0.2, z);
      car.add(wheel);
    }
  }
  car.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  return car;
}

function addRoadMarkings(scene: THREE.Scene) {
  const paint = new THREE.MeshStandardMaterial({ color: 0xe7e3d9, roughness: 0.9 });
  for (let i = -4; i <= 4; i += 1) {
    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.012, 0.62), paint);
    dash.position.set(i * 1.15, 0.018, 0);
    scene.add(dash);
  }

  for (let i = -2; i <= 2; i += 1) {
    for (let j = 0; j < 5; j += 1) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.014, 0.13), paint);
      stripe.position.set(-4.2 + j * 0.46, 0.02, 2.5 + i * 0.28);
      scene.add(stripe);
    }
  }
}

function addSplatGround(scene: THREE.Scene) {
  const splats = new SplatMesh();
  const random = (seed: number) => {
    const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
    return value - Math.floor(value);
  };
  const palette = [0x9cae91, 0xb7bd9b, 0xc2b99a, 0x829b85];

  for (let index = 0; index < 620; index += 1) {
    const x = (random(index * 3 + 1) - 0.5) * 28;
    const z = (random(index * 3 + 2) - 0.5) * 22;
    if (Math.abs(z) < 1.35 || (Math.abs(x) < 1.35 && Math.abs(z) < 7)) continue;
    const size = 0.12 + random(index * 3 + 3) * 0.4;
    const color = new THREE.Color(palette[index % palette.length]);
    splats.pushSplat(
      new THREE.Vector3(x, 0.035 + random(index + 19) * 0.08, z),
      new THREE.Vector3(size, size * 0.28, size),
      new THREE.Quaternion(),
      0.34 + random(index + 71) * 0.28,
      color,
    );
  }
  scene.add(splats);
}

export default function SceneViewer({ onRendererError, cameraPreset }: SceneViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneId = useSceneStore((state) => state.sceneId);
  const timeRef = useRef({
    currentTime: useSceneStore.getState().currentTime,
    duration: useSceneStore.getState().duration,
  });

  useEffect(() => useSceneStore.subscribe((state) => {
    timeRef.current = { currentTime: state.currentTime, duration: state.duration };
  }), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        alpha: false,
        powerPreference: "high-performance",
      });
    } catch (error) {
      onRendererError(
        error instanceof Error ? `3D renderer unavailable: ${error.message}` : "3D renderer unavailable.",
      );
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#101b2c");
    scene.fog = new THREE.Fog("#101b2c", 30, 65);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
    const cameraPosition = cameraPreset === "top"
      ? new THREE.Vector3(0, 20, 0.01)
      : new THREE.Vector3(12, 12, 15);
    camera.position.copy(cameraPosition);
    camera.lookAt(0, 0, 0);

    const spark = new SparkRenderer({ renderer });
    scene.add(spark);
    scene.add(new THREE.HemisphereLight(0xe4efff, 0x4b5560, 2.15));
    const sunlight = new THREE.DirectionalLight(0xffefd7, 3.2);
    sunlight.position.set(-7, 13, 7);
    sunlight.castShadow = true;
    sunlight.shadow.mapSize.set(1024, 1024);
    scene.add(sunlight);

    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(32, 0.22, 24),
      new THREE.MeshStandardMaterial({ color: 0xc6c8c0, roughness: 0.94 }),
    );
    ground.position.y = -0.13;
    ground.receiveShadow = true;
    scene.add(ground);

    const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x505762, roughness: 0.95 });
    const eastWestRoad = new THREE.Mesh(new THREE.BoxGeometry(32, 0.1, 2.65), roadMaterial);
    eastWestRoad.position.y = 0.015;
    eastWestRoad.receiveShadow = true;
    const northSouthRoad = new THREE.Mesh(new THREE.BoxGeometry(2.65, 0.105, 24), roadMaterial);
    northSouthRoad.position.y = 0.018;
    northSouthRoad.receiveShadow = true;
    scene.add(eastWestRoad, northSouthRoad);
    addRoadMarkings(scene);

    const buildings = [
      { x: -9.6, z: -5.7, w: 4.2, d: 3.4, h: 1.55, color: 0xb6b8b2 },
      { x: 8.6, z: -6.2, w: 5.2, d: 3.2, h: 1.85, color: 0xd1c7b6 },
      { x: -10.6, z: 6.4, w: 3.1, d: 4.2, h: 1.15, color: 0xd1d0c8 },
      { x: 9.6, z: 6.3, w: 4.4, d: 3.8, h: 1.3, color: 0xb8c3b0 },
    ];
    for (const building of buildings) {
      const block = new THREE.Mesh(
        new THREE.BoxGeometry(building.w, building.h, building.d),
        new THREE.MeshStandardMaterial({ color: building.color, roughness: 0.9 }),
      );
      block.position.set(building.x, building.h / 2 + 0.02, building.z);
      block.castShadow = true;
      block.receiveShadow = true;
      scene.add(block);
    }
    addSplatGround(scene);

    const carA = createCar(sceneId === "intersection" ? 0xb83232 : 0x2d6875, 0xeee9dd);
    const carB = createCar(sceneId === "intersection" ? 0xd6a34d : 0x87964e, 0xf0e9d8);
    scene.add(carA, carB);

    const trailMaterialA = new THREE.LineBasicMaterial({ color: 0xff7770, transparent: true, opacity: 0.7 });
    const trailMaterialB = new THREE.LineBasicMaterial({ color: 0xffc66d, transparent: true, opacity: 0.65 });
    const trailA = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-8, 0.1, -0.72),
        new THREE.Vector3(-4, 0.1, -0.72),
        new THREE.Vector3(-1, 0.1, -0.72),
        new THREE.Vector3(0.4, 0.1, -0.38),
      ]),
      trailMaterialA,
    );
    const trailB = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-1.1, 0.1, 6),
        new THREE.Vector3(-1.1, 0.1, 3),
        new THREE.Vector3(-0.8, 0.1, 1),
        new THREE.Vector3(-0.5, 0.1, 0.3),
      ]),
      trailMaterialB,
    );
    scene.add(trailA, trailB);

    const impact = new THREE.Group();
    const impactRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.7, 0.055, 8, 40),
      new THREE.MeshBasicMaterial({ color: 0xf06b5b }),
    );
    impactRing.rotation.x = Math.PI / 2;
    impactRing.position.y = 0.12;
    const impactStem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.018, 1.4, 8),
      new THREE.MeshBasicMaterial({ color: 0xf06b5b }),
    );
    impactStem.position.y = 0.8;
    impact.add(impactRing, impactStem);
    impact.position.set(0.1, 0, -0.15);
    scene.add(impact);

    const resize = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();

    renderer.setAnimationLoop(() => {
      const { currentTime, duration } = timeRef.current;
      const progress = Math.min(currentTime / duration, 1);
      carA.position.set(-7.3 + progress * 7.7, 0.02, -0.72);
      carA.rotation.y = Math.PI / 2 + Math.max(0, progress - 0.48) * 0.9;
      carB.position.set(-0.95, 0.02, 5.7 - progress * 5.5);
      carB.rotation.y = Math.PI;
      renderer.render(scene, camera);
    });

    return () => {
      resizeObserver.disconnect();
      renderer.setAnimationLoop(null);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          object.geometry.dispose();
          const material = object.material;
          if (Array.isArray(material)) material.forEach((item) => item.dispose());
          else material.dispose();
        }
        if (object instanceof SplatMesh) object.dispose();
      });
      renderer.dispose();
    };
  }, [cameraPreset, onRendererError, sceneId]);

  return <canvas aria-label="Interactive 3D incident reconstruction" className="scene-canvas" ref={canvasRef} />;
}
