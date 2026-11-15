import { Suspense, useEffect, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { useSceneStore } from "./store";

type SceneViewerProps = {
  onRendererError: (message: string) => void;
  cameraPreset: "iso" | "top";
  splatFile: File | null;
};

function SparkLayer() {
  const { gl, scene } = useThree();

  useEffect(() => {
    const spark = new SparkRenderer({ renderer: gl });
    scene.add(spark);
    return () => {
      scene.remove(spark);
      spark.geometry.dispose();
      const material = spark.material;
      if (Array.isArray(material)) material.forEach((item) => item.dispose());
      else material.dispose();
    };
  }, [gl, scene]);

  return null;
}

function SplatLayer({ file, onError }: { file: File; onError: (message: string) => void }) {
  const { scene } = useThree();

  useEffect(() => {
    let active = true;
    const splat = new SplatMesh({
      fileName: file.name,
      stream: file.stream(),
      streamLength: file.size,
    });

    scene.add(splat);
    splat.initialized.catch((error: unknown) => {
      if (!active) return;
      scene.remove(splat);
      splat.dispose();
      onError(error instanceof Error ? `Could not load ${file.name}: ${error.message}` : `Could not load ${file.name}.`);
    });

    return () => {
      active = false;
      scene.remove(splat);
      splat.dispose();
    };
  }, [file, onError, scene]);

  return null;
}

function CameraPreset({ preset }: { preset: "iso" | "top" }) {
  const { camera } = useThree();

  useEffect(() => {
    if (preset === "top") {
      camera.position.set(0, 20, 0.01);
      camera.up.set(0, 0, -1);
    } else {
      camera.position.set(12, 12, 15);
      camera.up.set(0, 1, 0);
    }
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [camera, preset]);

  return null;
}

function RoadMarkings() {
  return (
    <group>
      {Array.from({ length: 9 }, (_, index) => (
        <mesh key={`dash-${index}`} position={[(index - 4) * 1.15, 0.022, 0]}>
          <boxGeometry args={[0.12, 0.012, 0.62]} />
          <meshStandardMaterial color="#e7e3d9" roughness={0.9} />
        </mesh>
      ))}
      {Array.from({ length: 25 }, (_, index) => (
        <mesh
          key={`crosswalk-${index}`}
          position={[-4.2 + (index % 5) * 0.46, 0.024, 2.5 + Math.floor(index / 5) * 0.28]}
        >
          <boxGeometry args={[0.48, 0.014, 0.13]} />
          <meshStandardMaterial color="#e7e3d9" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

function Car({ color, accent }: { color: string; accent: string }) {
  return (
    <group>
      <mesh position={[0, 0.36, 0]} castShadow>
        <boxGeometry args={[1.7, 0.48, 0.82]} />
        <meshStandardMaterial color={color} roughness={0.42} metalness={0.08} />
      </mesh>
      <mesh position={[-0.06, 0.77, 0]} castShadow>
        <boxGeometry args={[0.82, 0.4, 0.7]} />
        <meshStandardMaterial color="#293d4b" roughness={0.22} metalness={0.12} transparent opacity={0.93} />
      </mesh>
      <mesh position={[0.88, 0.31, 0]} castShadow>
        <boxGeometry args={[0.12, 0.12, 0.78]} />
        <meshStandardMaterial color={accent} roughness={0.4} />
      </mesh>
      {[-0.55, 0.55].flatMap((x) =>
        [-0.43, 0.43].map((z) => (
          <mesh key={`${x}-${z}`} position={[x, 0.2, z]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.19, 0.19, 0.12, 16]} />
            <meshStandardMaterial color="#17202b" roughness={0.8} />
          </mesh>
        )),
      )}
    </group>
  );
}

function DemoVehicles({ parking }: { parking: boolean }) {
  const redCar = useRef<THREE.Group>(null);
  const goldCar = useRef<THREE.Group>(null);
  const time = useSceneStore((state) => state.currentTime);
  const duration = useSceneStore((state) => state.duration);

  useFrame(() => {
    const progress = Math.min(time / duration, 1);
    if (redCar.current) {
      redCar.current.position.set(-7.3 + progress * 7.7, 0.02, -0.72);
      redCar.current.rotation.y = Math.PI / 2 + Math.max(0, progress - 0.48) * 0.9;
    }
    if (goldCar.current) goldCar.current.position.set(-0.95, 0.02, 5.7 - progress * 5.5);
  });

  return (
    <>
      <group ref={redCar}>
        <Car color={parking ? "#2d6875" : "#b83232"} accent="#eee9dd" />
      </group>
      <group ref={goldCar} rotation-y={Math.PI}>
        <Car color={parking ? "#87964e" : "#d6a34d"} accent="#f0e9d8" />
      </group>
      <line>
        <bufferGeometry
          attach="geometry"
          onUpdate={(geometry) =>
            geometry.setFromPoints([
              new THREE.Vector3(-8, 0.1, -0.72),
              new THREE.Vector3(-4, 0.1, -0.72),
              new THREE.Vector3(-1, 0.1, -0.72),
              new THREE.Vector3(0.4, 0.1, -0.38),
            ])
          }
        />
        <lineBasicMaterial color="#ff7770" transparent opacity={0.7} />
      </line>
      <line>
        <bufferGeometry
          attach="geometry"
          onUpdate={(geometry) =>
            geometry.setFromPoints([
              new THREE.Vector3(-1.1, 0.1, 6),
              new THREE.Vector3(-1.1, 0.1, 3),
              new THREE.Vector3(-0.8, 0.1, 1),
              new THREE.Vector3(-0.5, 0.1, 0.3),
            ])
          }
        />
        <lineBasicMaterial color="#ffc66d" transparent opacity={0.65} />
      </line>
      <group position={[0.1, 0, -0.15]}>
        <mesh rotation-x={Math.PI / 2} position-y={0.12}>
          <torusGeometry args={[0.7, 0.055, 8, 40]} />
          <meshBasicMaterial color="#f06b5b" />
        </mesh>
        <mesh position-y={0.8}>
          <cylinderGeometry args={[0.018, 0.018, 1.4, 8]} />
          <meshBasicMaterial color="#f06b5b" />
        </mesh>
      </group>
    </>
  );
}

function DemoScene({ parking }: { parking: boolean }) {
  const buildings = [
    { x: -9.6, z: -5.7, w: 4.2, d: 3.4, h: 1.55, color: "#b6b8b2" },
    { x: 8.6, z: -6.2, w: 5.2, d: 3.2, h: 1.85, color: "#d1c7b6" },
    { x: -10.6, z: 6.4, w: 3.1, d: 4.2, h: 1.15, color: "#d1d0c8" },
    { x: 9.6, z: 6.3, w: 4.4, d: 3.8, h: 1.3, color: "#b8c3b0" },
  ];

  return (
    <>
      <color attach="background" args={["#101b2c"]} />
      <fog attach="fog" args={["#101b2c", 30, 65]} />
      <hemisphereLight args={["#e4efff", "#4b5560", 2.15]} />
      <directionalLight position={[-7, 13, 7]} intensity={3.2} castShadow shadow-mapSize={[1024, 1024]} />
      <mesh position-y={-0.13} receiveShadow>
        <boxGeometry args={[32, 0.22, 24]} />
        <meshStandardMaterial color="#c6c8c0" roughness={0.94} />
      </mesh>
      <mesh position-y={0.015} receiveShadow>
        <boxGeometry args={[32, 0.1, 2.65]} />
        <meshStandardMaterial color="#505762" roughness={0.95} />
      </mesh>
      <mesh position-y={0.018} receiveShadow>
        <boxGeometry args={[2.65, 0.105, 24]} />
        <meshStandardMaterial color="#505762" roughness={0.95} />
      </mesh>
      <RoadMarkings />
      {buildings.map((building) => (
        <mesh
          key={`${building.x}-${building.z}`}
          position={[building.x, building.h / 2 + 0.02, building.z]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[building.w, building.h, building.d]} />
          <meshStandardMaterial color={building.color} roughness={0.9} />
        </mesh>
      ))}
      <DemoVehicles parking={parking} />
    </>
  );
}

function SceneContent({
  cameraPreset,
  splatFile,
  parking,
  onRendererError,
}: SceneViewerProps & { parking: boolean }) {
  return (
    <>
      <CameraPreset preset={cameraPreset} />
      <SparkLayer />
      {splatFile ? (
        <Suspense fallback={null}>
          <SplatLayer file={splatFile} onError={onRendererError} />
        </Suspense>
      ) : (
        <DemoScene parking={parking} />
      )}
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
    </>
  );
}

export default function SceneViewer({ onRendererError, cameraPreset, splatFile }: SceneViewerProps) {
  const sceneId = useSceneStore((state) => state.sceneId);

  return (
    <Canvas
      aria-label="Interactive 3D incident reconstruction"
      className="scene-canvas"
      camera={{ position: [12, 12, 15], fov: 42, near: 0.1, far: 120 }}
      dpr={[1, 1.75]}
      gl={{ antialias: false, powerPreference: "high-performance" }}
      shadows
      onCreated={({ gl }) => {
        gl.outputColorSpace = THREE.SRGBColorSpace;
        gl.shadowMap.type = THREE.PCFSoftShadowMap;
      }}
      fallback={<div className="viewer-error">WebGL is unavailable on this device.</div>}
    >
      <SceneContent
        cameraPreset={cameraPreset}
        onRendererError={onRendererError}
        parking={sceneId === "parking"}
        splatFile={splatFile}
      />
    </Canvas>
  );
}
