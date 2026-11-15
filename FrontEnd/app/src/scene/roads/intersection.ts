import { CURB_WIDTH, crossSection, JUNCTIONS, markingLayout, type RoadClass, type RoadSpec } from "@/road/spec";
import type { Painter } from "@/scene/draw";
import { frame, right, type P } from "@/scene/roads/geometry";

const CLASS_RANK: Record<RoadClass, number> = { local: 0, collector: 1, arterial: 2, motorway: 3 };

/** Bars of a continental (ladder) crosswalk across lateral span [-half, half], centred. */
export function crosswalkBars(half: number, bar: number, gap: number) {
  const usable = half * 2;
  const count = Math.max(1, Math.floor((usable + gap) / (bar + gap)));
  const total = count * bar + (count - 1) * gap;
  return Array.from({ length: count }, (_, i) => -total / 2 + i * (bar + gap) + bar / 2);
}

/**
 * Paints one approach (arm) of a junction: crosswalk, stop line on the inbound side, and
 * lane, centre and edge lines that start where the junction box ends. The arm runs
 * from `origin` along `u`; its forward (outbound) lanes are on the right of `u`.
 */
export function paintArm(
  p: Painter,
  origin: P,
  u: P,
  spec: RoadSpec,
  options: { boxEdge: number; cornerEnd: number; crosswalkSetback: number; stopLineSetback: number },
) {
  const m = spec.markings;
  const layout = markingLayout(spec);
  const section = crossSection(spec);
  const at = frame(origin, u);
  const far = p.reach(origin, u);
  const half = section.pavedHalfWidthForward;

  const crosswalkStart = options.boxEdge + options.crosswalkSetback;
  const crosswalkEnd = crosswalkStart + m.crosswalkLength;
  for (const t of crosswalkBars(half - 0.4, m.crosswalkBar, m.crosswalkGap)) {
    const w = m.crosswalkBar / 2;
    p.patch([at(crosswalkStart, t - w), at(crosswalkEnd, t - w), at(crosswalkEnd, t + w), at(crosswalkStart, t + w)]);
  }

  // Stop line across the inbound (backward, left-of-u) lanes, from the curb to the centre line.
  const centerInner = layout.center.length ? Math.min(...layout.center) - m.centerLine.width / 2 : 0;
  const stopNear = crosswalkEnd + options.stopLineSetback;
  const stopFar = stopNear + m.stopLineWidth;
  p.patch([at(stopNear, -half), at(stopFar, -half), at(stopFar, centerInner), at(stopNear, centerInner)]);

  const run = (t: number, from: number) => [at(from, t), at(far, t)];
  const centerColor = m.centerLine.color;
  for (const t of layout.center) p.styled(run(t, stopNear), m.centerLine, centerColor);
  for (const t of layout.backwardLanes) p.styled(run(t, stopFar), m.laneLine);
  for (const t of layout.forwardLanes) p.styled(run(t, crosswalkEnd + 1), m.laneLine);
  const edgeStart = Math.max(crosswalkEnd, options.cornerEnd);
  if (layout.forwardEdge !== undefined) p.styled(run(layout.forwardEdge, edgeStart), m.edgeLine);
  if (layout.backwardEdge !== undefined) p.styled(run(layout.backwardEdge, edgeStart), m.edgeLine);
}

/**
 * Four-way urban intersection at the origin: `main` runs along x, `cross` along z.
 * Curb returns use the corner radius for the higher road class; each quadrant's curb
 * and sidewalk is one continuous run around the corner.
 */
export function fourWayIntersection(p: Painter, main: RoadSpec, cross: RoadSpec) {
  const junction = JUNCTIONS[main.region];
  const higher = CLASS_RANK[main.roadClass] >= CLASS_RANK[cross.roadClass] ? main.roadClass : cross.roadClass;
  const radius = junction.cornerRadius[higher];
  const hm = crossSection(main).pavedHalfWidthForward;
  const hc = crossSection(cross).pavedHalfWidthForward;
  const origin: P = [0, 0];

  const arms: { u: P; spec: RoadSpec; half: number; other: number }[] = [
    { u: [1, 0], spec: main, half: hm, other: hc },
    { u: [-1, 0], spec: main, half: hm, other: hc },
    { u: [0, 1], spec: cross, half: hc, other: hm },
    { u: [0, -1], spec: cross, half: hc, other: hm },
  ];
  for (const arm of arms) {
    const far = p.reach(origin, arm.u);
    const end: P = [arm.u[0] * far, arm.u[1] * far];
    p.paveStrip(origin, end, -arm.half, arm.half);
    p.obstacle(origin, end, arm.half + CURB_WIDTH + arm.spec.sidewalk);
  }

  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      const farX = p.reach(origin, [sx, 0]);
      const farZ = p.reach(origin, [0, sz]);
      let points: P[] = [
        [sx * hc, sz * farZ],
        [sx * hc, sz * hm],
        [sx * farX, sz * hm],
      ];
      let sidewalk = [cross.sidewalk, main.sidewalk];
      // The road must be on the curb's left: flip when the first leg has the road on its right.
      const firstRight = right([0, -sz]);
      if (Math.sign(firstRight[0]) !== sx) {
        points = points.reverse();
        sidewalk = sidewalk.reverse();
      }
      p.curb(points, { height: Math.max(main.curbHeight, cross.curbHeight), sidewalk, radii: [0, radius, 0] });
    }
  }

  for (const arm of arms) {
    paintArm(p, origin, arm.u, arm.spec, {
      boxEdge: arm.other,
      cornerEnd: arm.other + radius,
      crosswalkSetback: junction.crosswalkSetback,
      stopLineSetback: junction.stopLineSetback,
    });
  }
}
