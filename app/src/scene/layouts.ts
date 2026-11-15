import {
  addCircleLine,
  addDashedPolyline,
  addDisk,
  addParking,
  addPolyline,
  addRectLoop,
  addRing,
  addRoad,
  addSlab,
} from "@/scene/draw";
import * as THREE from "three";

export type Pose = { x: number; z: number; yaw: number };

export type VehicleMotion = {
  id: string;
  scale?: number;
  poseAt: (time: number) => Pose;
};

export type Layout = {
  id: string;
  camera: { position: [number, number, number]; target: [number, number, number] };
  build: (group: THREE.Group) => void;
  vehicles: VehicleMotion[];
};

const ROUND_X = -6;
const ROUND_Z = 2;
const ROUND_R = 11;

function smoothstep(value: number) {
  const x = Math.min(1, Math.max(0, value));
  return x * x * (3 - 2 * x);
}

function whitePose(time: number): Pose {
  const angle = -0.35 - time * 0.145;
  const x = ROUND_X + Math.cos(angle) * ROUND_R;
  const z = ROUND_Z + Math.sin(angle) * ROUND_R;
  const yaw = Math.atan2(Math.sin(angle), -Math.cos(angle));
  return { x, z, yaw };
}

function approach(time: number, duration: number, from: Pose, to: Pose, drift: number): Pose {
  const u = smoothstep(Math.min(time, duration) / duration);
  const after = Math.max(0, time - duration);
  return {
    x: from.x + (to.x - from.x) * u + drift * after,
    z: from.z + (to.z - from.z) * u,
    yaw: Math.atan2(to.x - from.x, to.z - from.z),
  };
}

const roundabout: Layout = {
  id: "roundabout",
  camera: { position: [34, 30, 36], target: [-2, 0, 2] },
  build(group) {
    addSlab(group, 96, 74);
    addRoad(group, -8, 2, 40, 4, 12);
    addRoad(group, -6, -28, -6, 18, 11);
    addRoad(group, -32, 20, -8, 8, 8);
    addRing(group, ROUND_X, ROUND_Z, 8.1, 14.2);
    addDisk(group, ROUND_X, ROUND_Z, 7.7, 0x8e8e8e, 0.055);
    addCircleLine(group, ROUND_X, ROUND_Z, 7.7);
    addCircleLine(group, ROUND_X, ROUND_Z, 11.1);
    addDashedPolyline(
      group,
      Array.from({ length: 18 }, (_, index) => {
        const x = -4 + index * 2.3;
        return [x, 3.2] as [number, number];
      }),
    );
    addParking(group, 18, -24, 8, 3, 2.7, 5.1);
    addParking(group, -34, 14, 5, 2, 2.7, 5);
    addRectLoop(group, 22, -33, 20, 7);
    addPolyline(group, [
      [24, -31.5],
      [40, -31.5],
    ]);
    addPolyline(group, [
      [24, -29.2],
      [40, -29.2],
    ]);
    addRectLoop(group, -46, -35, 92, 70);
  },
  vehicles: [
    { id: "white", scale: 1.08, poseAt: whitePose },
    {
      id: "red",
      poseAt: (time) => approach(time, 12, { x: 30, z: 6.2, yaw: 0 }, whitePose(12), -0.55),
    },
    {
      id: "orange",
      scale: 0.94,
      poseAt: (time) => approach(time, 16, { x: -30, z: 22, yaw: 0 }, { x: -14, z: 9, yaw: 0 }, 0.2),
    },
    {
      id: "green",
      poseAt: (time) => ({
        x: 20 + time * 0.42,
        z: -8.5,
        yaw: Math.PI / 2,
      }),
    },
  ],
};

const apache: Layout = {
  id: "apache",
  camera: { position: [22, 24, 30], target: [0, 0, 0] },
  build(group) {
    addSlab(group, 100, 52);
    addRoad(group, -46, 0, 46, 0, 14);
    addRoad(group, 0, -22, 0, 22, 12);
    addDashedPolyline(
      group,
      [
        [-40, 0],
        [40, 0],
      ],
      0.09,
      0xc6a21e,
    );
    addDashedPolyline(group, [
      [-40, -3.4],
      [40, -3.4],
    ]);
    addDashedPolyline(group, [
      [-40, 3.4],
      [40, 3.4],
    ]);
    addRectLoop(group, -48, -24, 96, 48);
  },
  vehicles: [
    {
      id: "silver",
      poseAt: (time) => {
        const impact = 8;
        const x = time < impact ? -28 + (28 * time) / impact : (time - impact) * 3.2;
        const z = time < impact ? -1.15 : -1.15 - (time - impact) * 0.28;
        const yaw = Math.PI / 2 - (time < impact ? 0 : 0.18);
        return { x, z, yaw };
      },
    },
    {
      id: "blue",
      scale: 1.08,
      poseAt: (time) => {
        const impact = 8;
        const x = time < impact ? 28 - (28 * time) / impact : -(time - impact) * 2.6;
        const z = time < impact ? 1.15 : 1.15 + (time - impact) * 0.22;
        const yaw = -Math.PI / 2 + (time < impact ? 0 : 0.12);
        return { x, z, yaw };
      },
    },
  ],
};

const layouts = new Map<string, Layout>([
  [roundabout.id, roundabout],
  [apache.id, apache],
]);

export function getLayout(id: string) {
  return layouts.get(id);
}
