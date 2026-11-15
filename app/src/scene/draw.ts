import * as THREE from "three";

const asphaltColor = 0xb9b9b9;
const lineColor = 0x2a2a2a;

export function addSlab(group: THREE.Group, width: number, depth: number) {
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(width, 0.45, depth),
    new THREE.MeshStandardMaterial({ color: 0xd4d4d4, roughness: 0.95 }),
  );
  slab.position.y = -0.225;
  slab.receiveShadow = true;
  group.add(slab);

  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(width, 0.45, depth)),
    new THREE.LineBasicMaterial({ color: 0x9a9a9a }),
  );
  edge.position.y = -0.225;
  group.add(edge);
}

export function addRoad(group: THREE.Group, x0: number, z0: number, x1: number, z1: number, width: number) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const length = Math.hypot(dx, dz);
  const yaw = Math.atan2(dx, dz);
  const pivot = new THREE.Group();
  pivot.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
  pivot.rotation.y = yaw;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, length),
    new THREE.MeshStandardMaterial({
      color: asphaltColor,
      roughness: 0.92,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.03;
  mesh.receiveShadow = true;
  pivot.add(mesh);
  group.add(pivot);
}

export function addDisk(group: THREE.Group, x: number, z: number, radius: number, color: number, y = 0.05) {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 72),
    new THREE.MeshStandardMaterial({ color, roughness: 0.9 }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  group.add(mesh);
}

export function addRing(group: THREE.Group, x: number, z: number, inner: number, outer: number, y = 0.04) {
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(inner, outer, 80),
    new THREE.MeshStandardMaterial({
      color: asphaltColor,
      roughness: 0.92,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  group.add(mesh);
}

export function addCircleLine(group: THREE.Group, x: number, z: number, radius: number, y = 0.09) {
  const points: THREE.Vector3[] = [];
  const segments = 80;
  for (let i = 0; i <= segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    points.push(new THREE.Vector3(x + Math.cos(angle) * radius, y, z + Math.sin(angle) * radius));
  }
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: lineColor })));
}

export function addPolyline(group: THREE.Group, points: [number, number][], y = 0.09, color = lineColor) {
  const vectors = points.map(([x, z]) => new THREE.Vector3(x, y, z));
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(vectors), new THREE.LineBasicMaterial({ color })));
}

export function addDashedPolyline(group: THREE.Group, points: [number, number][], y = 0.09, color = lineColor) {
  const vectors = points.map(([x, z]) => new THREE.Vector3(x, y, z));
  const geometry = new THREE.BufferGeometry().setFromPoints(vectors);
  const material = new THREE.LineDashedMaterial({ color, dashSize: 0.85, gapSize: 0.55 });
  const line = new THREE.Line(geometry, material);
  line.computeLineDistances();
  group.add(line);
}

export function addRectLoop(group: THREE.Group, x: number, z: number, width: number, depth: number, y = 0.09) {
  addPolyline(group, [
    [x, z],
    [x + width, z],
    [x + width, z + depth],
    [x, z + depth],
    [x, z],
  ], y);
}

export function addParking(group: THREE.Group, x: number, z: number, cols: number, rows: number, stallW: number, stallD: number) {
  const width = cols * stallW;
  const depth = rows * stallD;
  addRectLoop(group, x, z, width, depth);
  for (let col = 1; col < cols; col += 1) {
    const px = x + col * stallW;
    addPolyline(group, [
      [px, z],
      [px, z + depth],
    ]);
  }
  for (let row = 1; row < rows; row += 1) {
    const pz = z + row * stallD;
    addPolyline(group, [
      [x, pz],
      [x + width, pz],
    ]);
  }
}
