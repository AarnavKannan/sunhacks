import * as THREE from "three";

export function makeCar(color: string) {
  const group = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.28 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x1b2838,
    roughness: 0.12,
    metalness: 0.55,
  });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
  const lamp = new THREE.MeshStandardMaterial({
    color: 0xfff3cc,
    emissive: 0xffcc66,
    emissiveIntensity: 0.35,
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.52, 4.25), paint);
  body.position.y = 0.58;
  body.castShadow = true;

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.58, 0.4, 1.95), paint);
  cabin.position.set(0, 0.98, -0.28);
  cabin.castShadow = true;

  const windows = new THREE.Mesh(new THREE.BoxGeometry(1.46, 0.26, 1.65), glass);
  windows.position.set(0, 1.04, -0.22);

  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 18);
  for (const [x, z] of [
    [-0.82, 1.28],
    [0.82, 1.28],
    [-0.82, -1.28],
    [0.82, -1.28],
  ] as const) {
    const wheel = new THREE.Mesh(wheelGeo, rubber);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, 0.34, z);
    wheel.castShadow = true;
    group.add(wheel);
  }

  const lampGeo = new THREE.BoxGeometry(0.28, 0.12, 0.08);
  for (const x of [-0.55, 0.55]) {
    const light = new THREE.Mesh(lampGeo, lamp);
    light.position.set(x, 0.62, 2.12);
    group.add(light);
  }

  group.add(body, cabin, windows);
  return group;
}
