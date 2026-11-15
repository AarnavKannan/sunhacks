import {
  crossSection,
  markingLayout,
  PARKING,
  resolveRoadSpec,
  ROUNDABOUTS,
  VERGE_WIDTH,
  type RoadSpec,
} from "@/road/spec";
import type { VehicleKind } from "@/scene/cars";
import type { Painter } from "@/scene/draw";
import type { Site } from "@/scene/environment";
import { fourWayIntersection } from "@/scene/roads/intersection";
import { parkingLot } from "@/scene/roads/parking";
import { roundabout } from "@/scene/roads/roundabout";
import type { P } from "@/scene/roads/geometry";

export type Pose = { x: number; z: number; yaw: number };

export type VehicleMotion = {
  id: string;
  kind?: VehicleKind;
  scale?: number;
  poseAt: (time: number) => Pose;
};

export type Layout = {
  id: string;
  site: Site;
  camera: { position: [number, number, number]; target: [number, number, number] };
  build: (painter: Painter) => void;
  vehicles: VehicleMotion[];
};

function smoothstep(value: number) {
  const x = Math.min(1, Math.max(0, value));
  return x * x * (3 - 2 * x);
}

/** 0 → 1 easing out over `tau` seconds: how far a car slides after an impact. */
const settle = (after: number, tau: number) => 1 - Math.exp(-Math.max(0, after) / tau);

/** Heading from a velocity in the plan; yaw 0 faces +z, π/2 faces +x. */
const yawOf = (dx: number, dz: number) => Math.atan2(dx, dz);

// ---------------------------------------------------------------------------
// Roundabout: German urban single-lane roundabout (FGSV Merkblatt 2006) joining four
// collector streets, with a car park on either side of the east arm.

const ROUND_CENTER: P = [-6, 2];
const ROUND_STANDARD = ROUNDABOUTS.DE;
const COLLECTOR = resolveRoadSpec({ region: "DE", roadClass: "collector" });
const COLLECTOR_HALF = crossSection(COLLECTOR).pavedHalfWidthForward;
const ROUND_INNER = ROUND_STANDARD.outerRadius - ROUND_STANDARD.circulatoryWidth;
const ROUND_LANE = (ROUND_INNER + ROUND_STANDARD.outerRadius) / 2;
const ENTRY_OFFSET = -(ROUND_STANDARD.splitterWidth / 2 + ROUND_STANDARD.entryWidth / 2);
/** Inbound lane centre on a plain stretch of an arm (left of the outbound direction). */
const ARM_INBOUND = crossSection(COLLECTOR).backwardLaneCenters[0];

/** Arms: east, north (+z), west, south (-z). */
const ARM_ANGLES = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
const EAST: P = [1, 0];

/** Point on an arm at distance s from the centre, t to the right of the outbound direction. */
function armPoint(angle: number, s: number, t: number): P {
  const u: P = [Math.cos(angle), Math.sin(angle)];
  return [ROUND_CENTER[0] + u[0] * s - u[1] * t, ROUND_CENTER[1] + u[1] * s + u[0] * t];
}

const LOT_PLAN = { from: 21, to: 48, drivewayFrom: 37, setback: 5 };

/** Aisle centre of the -z car park (same rule as parkingLot): setback, near row, half the aisle. */
const SOUTH_AISLE_T = -(COLLECTOR_HALF + LOT_PLAN.setback + PARKING.DE.stallDepth + PARKING.DE.aisleWidth / 2);

function whiteAngle(time: number) {
  // Joined from the west arm, circulating anticlockwise in plan (right-hand traffic).
  const impact = 12;
  const omega = 0.26;
  const start = -0.3 + omega * impact;
  if (time <= impact) return start - omega * time;
  return start - omega * impact - omega * 0.7 * settle(time - impact, 0.7);
}

function whitePose(time: number): Pose {
  const angle = whiteAngle(time);
  return {
    x: ROUND_CENTER[0] + Math.cos(angle) * ROUND_LANE,
    z: ROUND_CENTER[1] + Math.sin(angle) * ROUND_LANE,
    yaw: yawOf(Math.sin(angle), -Math.cos(angle)),
  };
}

/** Red enters from the east arm without giving way and strikes the white SUV's side. */
function redPose(time: number): Pose {
  const impact = 12;
  const hit = whitePose(impact);
  const p0 = armPoint(0, 36, ARM_INBOUND);
  const p1 = armPoint(0, ROUND_STANDARD.outerRadius + 3, ENTRY_OFFSET);
  const p2: P = [hit.x + 2.9, hit.z + 0.2];
  const bezier = (u: number): P => {
    const a = (1 - u) * (1 - u);
    const b = 2 * (1 - u) * u;
    const c = u * u;
    return [a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1]];
  };
  // Eases off a little but never stops: the driver misjudges the gap.
  const u = Math.min(time, impact) / impact;
  const eased = u * (1.25 - 0.25 * u);
  const [x, z] = bezier(eased);
  const [nx, nz] = bezier(Math.min(1, eased + 0.01));
  const [px, pz] = bezier(Math.max(0, eased - 0.01));
  let yaw = yawOf(nx - px, nz - pz);
  if (time <= impact) return { x, z, yaw };
  const slide = settle(time - impact, 0.5);
  yaw += 0.35 * slide;
  // Carried along with the white SUV as it is shoved round the circle.
  return { x: x - 0.5 * slide, z: z - 1.4 * slide, yaw };
}

const roundaboutLayout: Layout = {
  id: "roundabout",
  site: { width: 96, depth: 74 },
  camera: { position: [34, 30, 36], target: [-2, 0, 2] },
  build(p) {
    const southLotGeometry = parkingLot(p, ROUND_CENTER, EAST, COLLECTOR, COLLECTOR_HALF, { ...LOT_PLAN, side: -1 });
    const northLotGeometry = parkingLot(p, ROUND_CENTER, EAST, COLLECTOR, COLLECTOR_HALF, { ...LOT_PLAN, side: 1 });
    roundabout(
      p,
      ROUND_CENTER,
      ROUND_STANDARD,
      ARM_ANGLES.map((angle, index) => ({
        angle,
        spec: COLLECTOR,
        notches:
          index === 0
            ? [
                { side: -1 as const, points: southLotGeometry.notch, radii: southLotGeometry.notchRadii },
                { side: 1 as const, points: northLotGeometry.notch, radii: northLotGeometry.notchRadii },
              ]
            : undefined,
      })),
    );
    p.finish();
  },
  vehicles: [
    { id: "white", scale: 1.08, poseAt: whitePose },
    { id: "red", poseAt: redPose },
    {
      id: "orange",
      scale: 0.94,
      // Approaches on the west arm and waits at the give-way line.
      poseAt: (time) => {
        const from = armPoint(Math.PI, 40, ARM_INBOUND);
        const to = armPoint(Math.PI, ROUND_STANDARD.outerRadius + 3.2, ENTRY_OFFSET);
        const u = smoothstep(time / 14);
        return { x: from[0] + (to[0] - from[0]) * u, z: from[1] + (to[1] - from[1]) * u, yaw: yawOf(to[0] - from[0], to[1] - from[1]) };
      },
    },
    {
      id: "green",
      // Creeping along the car-park aisle looking for a space.
      poseAt: (time) => {
        const [x, z] = armPoint(0, 24 + time * 0.42, SOUTH_AISLE_T);
        return { x, z, yaw: Math.PI / 2 };
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Apache Blvd, Tempe AZ: US urban arterial (2 lanes each way, double yellow) crossing a
// collector at a four-way intersection.

const APACHE = resolveRoadSpec({ region: "US", roadClass: "arterial" });
const APACHE_CROSS = resolveRoadSpec({ region: "US", roadClass: "collector" });
const APACHE_LANES = crossSection(APACHE);

const apache: Layout = {
  id: "apache",
  site: { width: 100, depth: 52 },
  camera: { position: [22, 24, 30], target: [0, 0, 0] },
  build(p) {
    fourWayIntersection(p, APACHE, APACHE_CROSS);
    p.finish();
  },
  vehicles: [
    {
      // Eastbound (+x, right side is +z) in the inner lane, drifting over the centre line.
      id: "silver",
      poseAt: (time) => {
        const impact = 8;
        const lane = APACHE_LANES.forwardLaneCenters[0];
        const drift = 1.05 * smoothstep((time - 5.5) / 2.5);
        if (time < impact) {
          const x = -28 + (28 * time) / impact;
          const z = lane - drift;
          return { x, z, yaw: Math.PI / 2 - (time > 5.5 && time < impact ? 0.06 : 0) };
        }
        const slide = settle(time - impact, 0.8);
        return { x: 2.6 * slide, z: lane - 1.05 + 1.6 * slide, yaw: Math.PI / 2 - 0.45 * slide };
      },
    },
    {
      // Westbound (-x) in its inner lane; swerves too late.
      id: "blue",
      scale: 1.08,
      poseAt: (time) => {
        const impact = 8;
        const lane = APACHE_LANES.backwardLaneCenters[0];
        const swerve = -0.35 * smoothstep((time - 7) / 1);
        if (time < impact) {
          return { x: 28 - (28 * time) / impact, z: lane + swerve, yaw: -Math.PI / 2 };
        }
        const slide = settle(time - impact, 0.8);
        return { x: -2.2 * slide, z: lane - 0.35 - 1.3 * slide, yaw: -Math.PI / 2 - 0.35 * slide };
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Divided highway modelled on the r05_s03 camera footage: a German Autobahn (RAA cross
// section, RMS markings) with three lanes and a hard shoulder each way, a concrete
// median barrier, W-beam guardrails on gravel verges and an overhead sign gantry.

const AUTOBAHN = resolveRoadSpec({ region: "DE", roadClass: "motorway" });
const AUTOBAHN_SECTION = crossSection(AUTOBAHN);
/** Centre of lane 1 (next to the median) .. 3 (next to the hard shoulder); fractional while changing lanes. */
const laneCenter = (lane: number) => AUTOBAHN_SECTION.forwardLaneCenters[0] + (lane - 1) * AUTOBAHN.laneWidth;
const HIGHWAY_LOOP = 450;

function wrap(x: number) {
  const span = HIGHWAY_LOOP * 2;
  return ((((x + HIGHWAY_LOOP) % span) + span) % span) - HIGHWAY_LOOP;
}

/** Constant-speed travel along the highway; `lane` may change smoothly over time. */
function cruise(x0: number, speed: number, direction: 1 | -1, lane: (time: number) => number) {
  const zAt = (time: number) => direction * laneCenter(lane(time));
  return (time: number): Pose => {
    const x = wrap(x0 + direction * speed * time);
    const z = zAt(time);
    const dz = (zAt(time + 0.05) - zAt(time - 0.05)) / 0.1;
    return { x, z, yaw: Math.atan2(direction * speed, dz) };
  };
}

const steady = (lane: number) => () => lane;
const laneChange = (from: number, to: number, start: number, length: number) => (time: number) =>
  from + (to - from) * smoothstep((time - start) / length);

/** Both carriageways of a divided road along x, with the forward (eastbound) one at +z. */
function motorway(p: Painter, spec: RoadSpec) {
  const section = crossSection(spec);
  const layout = markingLayout(spec);
  const m = spec.markings;
  const west = -p.reach([0, 0], [-1, 0]);
  const east = p.reach([0, 0], [1, 0]);
  const a: P = [west, 0];
  const b: P = [east, 0];
  const paved = section.pavedHalfWidthForward;
  p.paveStrip(a, b, -paved, paved);
  p.verge(a, b, paved, paved + VERGE_WIDTH);
  p.verge(a, b, -paved, -paved - VERGE_WIDTH);
  p.obstacle(a, b, paved + VERGE_WIDTH + 1);

  // Lines are laid out from x = 0 so the 6 m / 12 m pattern is the same on every lane.
  const line = (t: number) => [[west, t], [east, t]] as P[];
  const phase = (style: { dash: number; gap: number }) => (style.dash > 0 ? -west % (style.dash + style.gap) : 0);
  // Positive offsets are right of +x, i.e. +z: the eastbound carriageway.
  for (const t of [...layout.forwardLanes, ...layout.backwardLanes]) p.styled(line(t), m.laneLine, "white", phase(m.laneLine));
  for (const t of [layout.forwardEdge, layout.backwardEdge, layout.forwardInnerEdge, layout.backwardInnerEdge]) {
    if (t !== undefined) p.styled(line(t), m.edgeLine);
  }

  p.barrier(a, b);
  // Guardrail 0.5 m into the verge, rail facing the road (road on the left of a→b).
  const rail = paved + 0.5;
  p.guardrail([east, rail], [west, rail]);
  p.guardrail([west, -rail], [east, -rail]);
  return { paved, rail };
}

const highway: Layout = {
  id: "highway",
  site: { width: 160, depth: 70 },
  camera: { position: [-58, 17, 24], target: [18, 0, 2] },
  build(p) {
    const { rail } = motorway(p, AUTOBAHN);
    const post = rail + 1.2;
    p.gantry(34, -post, post, [
      { z: laneCenter(1) + 1, lines: ["EXIT 21", "→ Riverside"] },
      { z: laneCenter(3), lines: ["Ring Road", "Centre ↑"] },
    ]);
    p.finish();
  },
  vehicles: [
    { id: "e-truck", kind: "truck", poseAt: cruise(-120, 22.5, 1, steady(3)) },
    { id: "e-van", kind: "van", poseAt: cruise(-30, 25, 1, steady(3)) },
    { id: "e-silver", poseAt: cruise(-70, 30, 1, laneChange(2, 1, 6, 4)) },
    { id: "e-graphite", poseAt: cruise(35, 29, 1, steady(2)) },
    { id: "e-black", poseAt: cruise(-160, 37, 1, steady(1)) },
    { id: "e-red", poseAt: cruise(-10, 34, 1, steady(1)) },
    { id: "w-white", poseAt: cruise(120, 35, -1, steady(1)) },
    { id: "w-blue", poseAt: cruise(40, 31, -1, steady(2)) },
    { id: "w-truck", kind: "truck", poseAt: cruise(90, 21.5, -1, steady(3)) },
    { id: "w-van", kind: "van", poseAt: cruise(-20, 26, -1, laneChange(3, 2, 14, 5)) },
  ],
};

const layouts = new Map<string, Layout>([
  [roundaboutLayout.id, roundaboutLayout],
  [apache.id, apache],
  [highway.id, highway],
]);

export function getLayout(id: string) {
  return layouts.get(id);
}
