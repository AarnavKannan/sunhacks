import { CURB_WIDTH, crossSection, markingLayout, type RoadSpec, type RoundaboutStandard } from "@/road/spec";
import type { Painter } from "@/scene/draw";
import { crosswalkBars } from "@/scene/roads/intersection";
import {
  add,
  arc,
  arcBetween,
  circleIntersections,
  dir,
  frame,
  mul,
  sub,
  type P,
} from "@/scene/roads/geometry";

/** Central island curb above the apron (DE Hochbord). */
const ISLAND_CURB = 0.12;
/** Splitter islands are raised like a normal curb. */
const SPLITTER_HEIGHT = 0.12;

export type RoundaboutArm = {
  /** Direction of the arm leaving the circle, radians (atan2(z, x)). */
  angle: number;
  spec: RoadSpec;
  /** Car-park driveways along this arm's curb: curb points (increasing distance), side and radii. */
  notches?: { side: 1 | -1; points: P[]; radii: number[] }[];
};

export type RoundaboutGeometry = {
  center: P;
  /** Radius of the centre of the circulatory lane. */
  laneRadius: number;
  /** Per arm: point at distance `s` from the centre, `t` to the right of the outbound direction. */
  armFrame: (index: number) => (s: number, t: number) => P;
  /** Lateral offset of the entry lane centre where it meets the circle (negative = inbound side). */
  entryOffset: number;
  /** Distance from the centre to the give-way line. */
  yieldDistance: number;
};

/**
 * Single-lane roundabout: circulatory roadway, mountable truck apron, grassed central
 * island, approaches that flare from the street into entry and exit lanes either side
 * of a raised splitter island, curb returns tangent to the circle, give-way lines and
 * zebra crossings. Arms must be at least ~80 degrees apart for the default radii.
 */
export function roundabout(p: Painter, center: P, rb: RoundaboutStandard, arms: RoundaboutArm[]): RoundaboutGeometry {
  const outer = rb.outerRadius;
  const inner = outer - rb.circulatoryWidth;
  const apronInner = inner - rb.apronWidth;
  const r = rb.cornerRadius;
  const splitHalf = rb.splitterWidth / 2;
  const taperEnd = outer + rb.splitterLength * 0.6;
  const taperStart = outer + rb.splitterLength + 2;
  const sorted = [...arms].sort((a, b) => a.angle - b.angle);

  type ArmGeometry = {
    arm: RoundaboutArm;
    u: P;
    at: (s: number, t: number) => P;
    far: number;
    half: number;
    /** Curb line on side ±1, from far end inward, ending at the tangent point on the circle. */
    edge: Record<1 | -1, P[]>;
    /** Angle (around the centre) of the circle tangent point on side ±1. */
    tangentAngle: Record<1 | -1, number>;
    filletCenter: Record<1 | -1, P>;
    /** The curb point where the approach starts to widen, on side ±1. */
    taperPoint: Record<1 | -1, P>;
  };

  const geometries: ArmGeometry[] = sorted.map((arm) => {
    const u = dir(arm.angle);
    const at = frame(center, u);
    const far = p.reach(center, u);
    const half = crossSection(arm.spec).pavedHalfWidthForward;
    const edge = {} as Record<1 | -1, P[]>;
    const tangentAngle = {} as Record<1 | -1, number>;
    const filletCenter = {} as Record<1 | -1, P>;
    const taperPoint = {} as Record<1 | -1, P>;
    for (const side of [1, -1] as const) {
      // Exit (outbound) lane is on the right of u, entry on the left.
      const near = splitHalf + (side === 1 ? rb.exitWidth : rb.entryWidth);
      // Curb return: circle of radius r tangent to the edge line and to the outer circle.
      const sc = Math.sqrt((outer + r) ** 2 - (near + r) ** 2);
      const c = at(sc, side * (near + r));
      const onCircle = add(center, mul(sub(c, center), outer / (outer + r)));
      const fillet = arcBetween(c, at(sc, side * near), onCircle, 0.4);
      taperPoint[side] = at(taperStart, side * half);
      const points: P[] = [at(far, side * half), taperPoint[side], at(taperEnd, side * near), ...fillet];
      // Splice car-park driveways into the straight part of the curb (traversed inward here).
      for (const notch of arm.notches ?? []) {
        if (notch.side !== side) continue;
        points.splice(1, 0, ...[...notch.points].reverse());
      }
      edge[side] = points;
      tangentAngle[side] = Math.atan2(onCircle[1] - center[1], onCircle[0] - center[0]);
      filletCenter[side] = c;
    }
    return { arm, u, at, far, half, edge, tangentAngle, filletCenter, taperPoint };
  });

  // Corner between each arm (its right/exit side) and the next arm counter-clockwise in
  // angle (its left/entry side). Traversed with the road on the left: inward along the
  // next arm, round the circle, outward along this arm.
  geometries.forEach((g, index) => {
    const next = geometries[(index + 1) % geometries.length];
    let a0 = next.tangentAngle[-1];
    const a1 = g.tangentAngle[1];
    while (a0 < a1) a0 += Math.PI * 2;
    const circle = arc(center, outer, a0, a1, 0.5);
    const inward = next.edge[-1];
    const outward = [...g.edge[1]].reverse();
    const points = [...inward, ...circle.slice(1, -1), ...outward];
    const radii = points.map(() => 0);
    const notchRadius = (arm: RoundaboutArm, side: 1 | -1, point: P) => {
      for (const notch of arm.notches ?? []) {
        if (notch.side !== side) continue;
        const i = notch.points.findIndex((q) => q[0] === point[0] && q[1] === point[1]);
        if (i >= 0) return notch.radii[i];
      }
      return 0;
    };
    points.forEach((point, i) => {
      radii[i] = Math.max(notchRadius(next.arm, -1, point), notchRadius(g.arm, 1, point));
    });
    // Sidewalk follows the street; the car-park perimeter has a bare curb.
    const isNotch = (point: P) =>
      [next.arm, g.arm].some((arm) => (arm.notches ?? []).some((n) => n.points.some((q) => q[0] === point[0] && q[1] === point[1])));
    const sidewalk = points.slice(0, -1).map((point, i) => {
      const both = isNotch(point) && isNotch(points[i + 1]);
      return both ? 0 : Math.min(next.arm.spec.sidewalk, g.arm.spec.sidewalk);
    });
    p.curb(points, { height: Math.min(next.arm.spec.curbHeight, g.arm.spec.curbHeight), sidewalk, radii });

    // Asphalt wedge from the centre out to where the approach taper starts.
    const wedge = [
      center,
      next.at(taperStart, 0),
      ...points.slice(points.indexOf(next.taperPoint[-1]), points.indexOf(g.taperPoint[1]) + 1),
      g.at(taperStart, 0),
    ];
    p.pave(wedge);
  });

  for (const g of geometries) {
    const spec = g.arm.spec;
    const m = spec.markings;
    p.paveStrip(g.at(taperStart - 0.5, 0), g.at(g.far, 0), -g.half, g.half);
    p.obstacle(g.at(outer, 0), g.at(g.far, 0), g.half + CURB_WIDTH + spec.sidewalk + 2);

    // Splitter island: tapered capsule from the circle out along the approach.
    const tipRadius = 0.3;
    const s1 = outer + 1.2 + splitHalf;
    const s2 = outer + rb.splitterLength;
    const splitterLocal: P[] = [
      ...arc([s1, 0], splitHalf, Math.PI / 2, Math.PI * 1.5, 0.25),
      ...arc([s2, 0], tipRadius, -Math.PI / 2, Math.PI / 2, 0.1),
    ];
    p.raised(
      splitterLocal.map(([s, t]) => g.at(s, t)),
      { height: SPLITTER_HEIGHT, top: "concrete" },
    );

    // Centre line beyond the splitter: solid where overtaking into the island is barred, then broken.
    const layout = markingLayout(spec);
    const solidTo = s2 + tipRadius + 10;
    for (const t of layout.center) {
      p.line([g.at(s2 + tipRadius + 0.5, t), g.at(solidTo, t)], m.centerLine.width, "white");
      p.styled([g.at(solidTo + m.laneLine.gap, t), g.at(g.far, t)], m.centerLine, "white");
    }

    // Give-way line along the circle across the entry lane (left of u).
    const yieldStyle = m.yieldLine ?? m.stopLineWidth;
    const yieldRadius = outer + 0.25 + (typeof yieldStyle === "number" ? yieldStyle : yieldStyle.width) / 2;
    const hits = circleIntersections(center, yieldRadius, g.filletCenter[-1], r);
    const axisAngle = g.arm.angle;
    const angles = hits.map((h) => {
      let a = Math.atan2(h[1] - center[1], h[0] - center[0]) - axisAngle;
      while (a > Math.PI) a -= Math.PI * 2;
      while (a < -Math.PI) a += Math.PI * 2;
      return a;
    });
    const curbAngle = angles.filter((a) => a < 0).sort((a, b) => b - a)[0];
    if (curbAngle !== undefined && typeof yieldStyle !== "number") {
      const startAngle = axisAngle - Math.asin(0.3 / yieldRadius);
      const endAngle = axisAngle + curbAngle + 0.12 / yieldRadius;
      p.styled(arc(center, yieldRadius, startAngle, endAngle, 0.2), yieldStyle);
    }

    // Zebra crossing a few metres back from the circle, interrupted by the splitter island.
    const zebraFrom = outer + 5;
    const zebraTo = zebraFrom + m.crosswalkLength;
    const exitEdge = splitHalf + rb.exitWidth;
    const entryEdge = splitHalf + rb.entryWidth;
    const splitAt = (s: number) => splitHalf + ((tipRadius - splitHalf) * (s - s1)) / (s2 - s1);
    const island = Math.max(splitAt(zebraFrom), splitAt(zebraTo)) + 0.3;
    const width = (exitEdge + entryEdge) / 2;
    for (const t of crosswalkBars(width - 0.3, m.crosswalkBar, m.crosswalkGap)) {
      const w = m.crosswalkBar / 2;
      const shifted = t + (exitEdge - entryEdge) / 2;
      if (Math.abs(shifted) - w < island) continue;
      if (shifted + w > exitEdge - 0.3 || shifted - w < -entryEdge + 0.3) continue;
      p.patch([g.at(zebraFrom, shifted - w), g.at(zebraTo, shifted - w), g.at(zebraTo, shifted + w), g.at(zebraFrom, shifted + w)]);
    }
  }

  // Truck apron and central island.
  const ring = (radius: number) => arc(center, radius, 0, Math.PI * 2, 0.4).slice(0, -1);
  p.raised(ring(inner), { height: rb.apronHeight, top: "concrete", holes: [ring(apronInner)] });
  p.raised(ring(apronInner), { height: ISLAND_CURB, top: "grass" });
  p.obstacle(center, center, outer + CURB_WIDTH + 3);

  return {
    center,
    laneRadius: (inner + outer) / 2,
    armFrame: (index: number) => frame(center, dir(arms[index].angle)),
    entryOffset: -(splitHalf + rb.entryWidth / 2),
    yieldDistance: outer + 0.25,
  };
}
