import * as THREE from "three";

/** Vehicle classes, matching the car / van / truck labels in the tracking footage. */
export type VehicleKind = "car" | "van" | "truck";

/** Passenger-car body styles seen in the reference traffic photos. */
export type CarStyle = "sedan" | "hatchback" | "suv";

/**
 * A vehicle built for animation: the scene moves and yaws `root`; `body` tilts on the
 * suspension; `wheels` spin; lamp materials glow (bright enough to bloom) when lit or braking.
 */
export type VehicleRig = {
  root: THREE.Group;
  body: THREE.Group;
  wheels: THREE.Object3D[];
  wheelRadius: number;
  head: THREE.MeshStandardMaterial;
  tail: THREE.MeshStandardMaterial;
  /** Accumulated wheel rotation (rad). */
  wheelAngle: number;
  lastPosition: THREE.Vector3 | null;
};

/** Motion of a vehicle at an instant, derived from its trajectory. */
export type VehicleMotionState = {
  /** Signed speed along the heading (m/s). */
  speed: number;
  /** Longitudinal acceleration (m/s^2); negative is braking. */
  accel: number;
  /** Heading rate (rad/s); positive turns left. */
  yawRate: number;
  /** 0..1 ambient lamp level from the environment (night, dusk, grey weather). */
  lamps: number;
};

type Profile = [number, number][];

/** Extrudes a side profile (z forward, y up) across the vehicle's width, centred on x = 0. */
function sideExtrude(profile: Profile, width: number, bevel = 0.05) {
  const shape = new THREE.Shape();
  profile.forEach(([z, y], index) => (index === 0 ? shape.moveTo(z, y) : shape.lineTo(z, y)));
  shape.closePath();
  const depth = Math.max(0.01, width - bevel * 2);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    steps: 1,
  });
  geometry.translate(0, 0, -depth / 2);
  geometry.rotateY(-Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

type Materials = {
  paint: THREE.Material;
  glass: THREE.Material;
  rubber: THREE.Material;
  rim: THREE.Material;
  trim: THREE.Material;
  plate: THREE.Material;
  head: THREE.MeshStandardMaterial;
  tail: THREE.MeshStandardMaterial;
  cargo: THREE.Material;
};

function materials(color: string): Materials {
  return {
    // Automotive paint: metallic base under a glossy clear coat (reflects the sky HDRI).
    paint: new THREE.MeshPhysicalMaterial({
      color,
      metalness: 0.5,
      roughness: 0.38,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
    }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0b1015, metalness: 0.1, roughness: 0.03, clearcoat: 1 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 }),
    rim: new THREE.MeshStandardMaterial({ color: 0xaab0b6, metalness: 0.9, roughness: 0.28 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x1d1f21, roughness: 0.65 }),
    plate: new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.4 }),
    head: new THREE.MeshStandardMaterial({ color: 0xf2f4f5, emissive: 0xfff1d6, emissiveIntensity: 0.3 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x5a0a0c, emissive: 0xff1a1a, emissiveIntensity: 0.4 }),
    cargo: new THREE.MeshStandardMaterial({ color: 0xe8e9ea, roughness: 0.55, metalness: 0.1 }),
  };
}

function shadowed<T extends THREE.Object3D>(object: T) {
  object.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  return object;
}

function addWheels(rig: VehicleRig, m: Materials, radius: number, track: number, axles: number[], tireWidth = 0.24) {
  const tire = new THREE.CylinderGeometry(radius, radius, tireWidth, 28);
  const rim = new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, tireWidth + 0.02, 5);
  for (const z of axles) {
    for (const side of [-1, 1]) {
      const wheel = new THREE.Group();
      wheel.position.set((side * track) / 2, radius, z);
      const tyre = new THREE.Mesh(tire, m.rubber);
      tyre.rotation.z = Math.PI / 2;
      // Five-spoke rim so the spin is visible.
      const hub = new THREE.Mesh(rim, m.rim);
      hub.rotation.z = Math.PI / 2;
      wheel.add(tyre, hub);
      rig.root.add(shadowed(wheel));
      rig.wheels.push(wheel);
    }
  }
  rig.wheelRadius = radius;
}

function addLamps(body: THREE.Group, m: Materials, front: number, back: number, height: number, spread: number, wide = 0.42) {
  const headGeometry = new THREE.BoxGeometry(wide, 0.12, 0.06);
  const tailGeometry = new THREE.BoxGeometry(wide, 0.14, 0.06);
  for (const x of [-spread, spread]) {
    const head = new THREE.Mesh(headGeometry, m.head);
    head.position.set(x, height, front);
    const tail = new THREE.Mesh(tailGeometry, m.tail);
    tail.position.set(x, height + 0.06, back);
    body.add(head, tail);
  }
}

function addPlates(body: THREE.Group, m: Materials, front: number, back: number, height: number) {
  const geometry = new THREE.BoxGeometry(0.52, 0.12, 0.02);
  const plateFront = new THREE.Mesh(geometry, m.plate);
  plateFront.position.set(0, height, front);
  const plateBack = new THREE.Mesh(geometry, m.plate);
  plateBack.position.set(0, height + 0.12, back);
  body.add(plateFront, plateBack);
}

function addMirrors(body: THREE.Group, m: Materials, z: number, y: number, halfWidth: number) {
  const geometry = new THREE.BoxGeometry(0.2, 0.12, 0.1);
  for (const side of [-1, 1]) {
    const mirror = new THREE.Mesh(geometry, m.paint);
    mirror.position.set(side * (halfWidth + 0.08), y, z);
    body.add(mirror);
  }
}

function newRig(): VehicleRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  return {
    root,
    body,
    wheels: [],
    wheelRadius: 0.33,
    head: undefined as unknown as THREE.MeshStandardMaterial,
    tail: undefined as unknown as THREE.MeshStandardMaterial,
    wheelAngle: 0,
    lastPosition: null,
  };
}

const CAR_STYLES: Record<CarStyle, { body: Profile; glass: Profile; roof: Profile; width: number; cabinWidth: number; wheel: number; axles: [number, number] }> = {
  sedan: {
    width: 1.82,
    cabinWidth: 1.58,
    wheel: 0.33,
    axles: [1.38, -1.38],
    body: [
      [-2.25, 0.3],
      [2.25, 0.3],
      [2.33, 0.56],
      [2.2, 0.78],
      [1.0, 0.93],
      [-1.5, 0.98],
      [-2.18, 0.96],
      [-2.32, 0.62],
    ],
    glass: [
      [1.02, 0.92],
      [0.05, 1.4],
      [-0.98, 1.42],
      [-1.62, 0.98],
    ],
    roof: [
      [0.12, 1.39],
      [-0.98, 1.41],
      [-1.02, 1.46],
      [0.07, 1.45],
    ],
  },
  hatchback: {
    width: 1.78,
    cabinWidth: 1.56,
    wheel: 0.32,
    axles: [1.28, -1.25],
    body: [
      [-1.98, 0.3],
      [2.05, 0.3],
      [2.12, 0.56],
      [1.98, 0.8],
      [0.95, 0.94],
      [-1.86, 0.98],
      [-2.02, 0.6],
    ],
    glass: [
      [0.98, 0.93],
      [0.0, 1.44],
      [-1.55, 1.44],
      [-1.9, 0.98],
    ],
    roof: [
      [0.06, 1.43],
      [-1.55, 1.43],
      [-1.6, 1.49],
      [0.02, 1.49],
    ],
  },
  suv: {
    width: 1.92,
    cabinWidth: 1.7,
    wheel: 0.38,
    axles: [1.45, -1.42],
    body: [
      [-2.3, 0.38],
      [2.3, 0.38],
      [2.38, 0.72],
      [2.22, 1.02],
      [1.1, 1.14],
      [-2.2, 1.16],
      [-2.36, 0.78],
    ],
    glass: [
      [1.12, 1.13],
      [0.3, 1.7],
      [-2.05, 1.72],
      [-2.25, 1.16],
    ],
    roof: [
      [0.36, 1.69],
      [-2.05, 1.71],
      [-2.08, 1.77],
      [0.32, 1.76],
    ],
  },
};

export function carHitboxDimensions(style: CarStyle) {
  const spec = CAR_STYLES[style];
  const profile = [...spec.body, ...spec.glass, ...spec.roof];
  const front = Math.max(...profile.map(([z]) => z));
  const back = Math.min(...profile.map(([z]) => z));
  const height = Math.max(...profile.map(([, y]) => y));
  const padding = style === "suv" ? 0.2 : 0.12;
  return {
    radiusX: (spec.width + padding * 2) / 2,
    radiusY: (height + padding) / 2,
    radiusZ: (front - back + padding * 2) / 2,
    centerZ: (front + back) / 2,
  };
}

function makeCar(m: Materials, style: CarStyle) {
  const spec = CAR_STYLES[style];
  const rig = newRig();
  const body = new THREE.Mesh(sideExtrude(spec.body, spec.width, 0.07), m.paint);
  const glass = new THREE.Mesh(sideExtrude(spec.glass, spec.cabinWidth, 0.04), m.glass);
  const roof = new THREE.Mesh(sideExtrude(spec.roof, spec.cabinWidth + 0.02, 0.03), m.paint);
  const front = spec.body[2][0];
  const back = spec.body[spec.body.length - 1][0];
  const sill = new THREE.Mesh(new THREE.BoxGeometry(spec.width - 0.06, 0.16, front - back + 0.06), m.trim);
  sill.position.set(0, spec.body[0][1] + 0.08, (front + back) / 2);
  rig.body.add(body, glass, roof, sill);
  addLamps(rig.body, m, front + 0.02, back - 0.02, spec.body[2][1] + 0.12, spec.width / 2 - 0.3);
  addPlates(rig.body, m, front + 0.04, back - 0.04, spec.body[0][1] + 0.18);
  addMirrors(rig.body, m, spec.glass[0][0] - 0.25, spec.glass[0][1] + 0.08, spec.width / 2);
  shadowed(rig.body);
  addWheels(rig, m, spec.wheel, spec.width - 0.24, spec.axles);

  const { radiusX, radiusY, radiusZ, centerZ } = carHitboxDimensions(style);
  const hitbox = new THREE.Group();
  hitbox.name = "vehicle-hitbox";
  hitbox.position.set(0, radiusY, centerZ);
  const material = new THREE.LineBasicMaterial({
    color: style === "suv" ? 0xffa726 : 0x00d8ff,
    depthTest: false,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const ellipses = [
    (angle: number) => new THREE.Vector3(radiusX * Math.cos(angle), radiusY * Math.sin(angle), 0),
    (angle: number) => new THREE.Vector3(radiusX * Math.cos(angle), 0, radiusZ * Math.sin(angle)),
    (angle: number) => new THREE.Vector3(0, radiusY * Math.cos(angle), radiusZ * Math.sin(angle)),
  ];
  for (const pointAt of ellipses) {
    const points = Array.from({ length: 64 }, (_, i) => pointAt((i / 64) * Math.PI * 2));
    const ellipse = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), material);
    ellipse.renderOrder = 10;
    hitbox.add(ellipse);
  }
  rig.root.add(hitbox);
  return rig;
}

function makeVan(m: Materials) {
  const rig = newRig();
  const width = 2.0;
  const body = new THREE.Mesh(
    sideExtrude(
      [
        [-2.55, 0.34],
        [2.5, 0.34],
        [2.58, 0.78],
        [2.35, 1.12],
        [1.95, 1.18],
        [1.2, 2.05],
        [-2.55, 2.08],
      ],
      width,
      0.07,
    ),
    m.paint,
  );
  const glass = new THREE.Mesh(
    sideExtrude(
      [
        [1.98, 1.21],
        [1.26, 2.02],
        [0.35, 2.02],
        [0.35, 1.22],
      ],
      width + 0.04,
      0,
    ),
    m.glass,
  );
  // The body's bevel pushes its outline out ~7 cm, so sit the windscreen just proud of it.
  glass.position.z = 0.11;
  rig.body.add(body, glass);
  addLamps(rig.body, m, 2.62, -2.6, 0.86, 0.68);
  addPlates(rig.body, m, 2.64, -2.62, 0.5);
  addMirrors(rig.body, m, 1.55, 1.45, width / 2);
  shadowed(rig.body);
  addWheels(rig, m, 0.36, 1.72, [1.75, -1.6]);
  return rig;
}

function makeTruck(m: Materials) {
  const rig = newRig();
  const width = 2.5;
  const cab = new THREE.Mesh(
    sideExtrude(
      [
        [3.95, 0.6],
        [5.9, 0.6],
        [5.95, 2.0],
        [5.8, 3.25],
        [3.95, 3.35],
      ],
      width,
      0.09,
    ),
    m.paint,
  );
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(width - 0.3, 0.95, 0.05), m.glass);
  windshield.position.set(0, 2.55, 5.95);
  windshield.rotation.x = -0.06;
  const trailer = new THREE.Mesh(new THREE.BoxGeometry(width, 2.9, 9.6), m.cargo);
  trailer.position.set(0, 2.45, -1.15);
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.35, 12.5), m.trim);
  chassis.position.set(0, 0.75, -0.05);
  rig.body.add(cab, windshield, trailer, chassis);
  addLamps(rig.body, m, 5.97, -5.97, 1.0, 0.95);
  addPlates(rig.body, m, 5.99, -5.99, 0.75);
  addMirrors(rig.body, m, 5.6, 2.4, width / 2 + 0.1);
  shadowed(rig.body);
  addWheels(rig, m, 0.52, 2.0, [4.95, 1.75, -4.05, -5.35], 0.42);
  return rig;
}

function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function carStyle(label: string, id: string): CarStyle {
  const text = label.toLowerCase();
  if (text.includes("suv")) return "suv";
  if (text.includes("hatch")) return "hatchback";
  if (text.includes("sedan")) return "sedan";
  return (["sedan", "hatchback", "suv"] as const)[hash(id) % 3];
}

/**
 * Builds a vehicle. The label (e.g. "Blue SUV" from the tracker's description) picks the
 * body style; otherwise `id` picks a stable one.
 */
export function makeVehicle(kind: VehicleKind, color: string, id = "", label = ""): VehicleRig {
  const m = materials(color);
  let rig: VehicleRig;
  if (kind === "van") rig = makeVan(m);
  else if (kind === "truck") rig = makeTruck(m);
  else rig = makeCar(m, carStyle(label, id));
  rig.head = m.head;
  rig.tail = m.tail;
  return rig;
}

const BRAKING = -0.8;

/**
 * Applies the motion state to the rig: wheels roll with distance travelled, brake lamps
 * flare under braking, the body dives/squats with longitudinal acceleration and rolls
 * outward in turns (a few degrees, as on a real suspension).
 */
export function driveVehicle(rig: VehicleRig, motion: VehicleMotionState) {
  const position = rig.root.position;
  if (rig.lastPosition) {
    const moved = position.distanceTo(rig.lastPosition);
    // Skip jumps (scrubbing far, or wrapping round a looped road).
    if (moved < 8) rig.wheelAngle += (Math.sign(motion.speed) * moved) / rig.wheelRadius;
    rig.lastPosition.copy(position);
  } else {
    rig.lastPosition = position.clone();
  }
  for (const wheel of rig.wheels) wheel.rotation.x = rig.wheelAngle;

  const braking = motion.accel < BRAKING && Math.abs(motion.speed) > 0.3;
  rig.tail.emissiveIntensity = 0.5 + motion.lamps * 4 + (braking ? 14 : 0);
  rig.head.emissiveIntensity = 0.4 + motion.lamps * 9;

  const lateral = motion.speed * motion.yawRate;
  rig.body.rotation.x = THREE.MathUtils.clamp(-motion.accel * 0.005, -0.045, 0.035);
  rig.body.rotation.z = THREE.MathUtils.clamp(lateral * 0.006, -0.05, 0.05);
}
