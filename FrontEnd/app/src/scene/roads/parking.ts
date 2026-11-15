import { JUNCTIONS, PARKING, type RoadSpec } from "@/road/spec";
import type { Painter } from "@/scene/draw";
import { arc, frame, type P } from "@/scene/roads/geometry";

/** Corner radius of the curbs around a car park and where the driveway meets it. */
const LOT_CORNER_RADIUS = 1.0;

export type ParkingLotPlan = {
  /** Lateral side of the street the lot is on: +1 = right of `u`, -1 = left. */
  side: 1 | -1;
  /** Lot extent along the street (distance from the street's origin). */
  from: number;
  to: number;
  /** Driveway span along the street; it must fall inside [from, to]. */
  drivewayFrom: number;
  /** Grass/sidewalk strip between the street curb and the lot's near curb. */
  setback: number;
};

export type ParkingLot = {
  /** Curb points that replace the street edge between drivewayFrom and drivewayTo, in increasing distance. */
  notch: P[];
  notchRadii: number[];
  /** Lateral offset (signed, like `side`) and extent of the aisle centreline, for vehicle paths. */
  aisleOffset: number;
  aisleFrom: number;
  aisleTo: number;
  drivewayCenter: number;
};

/**
 * A surface car park beside a street: one two-way aisle parallel to the street with a
 * row of 90 degree stalls on each side (stall and aisle sizes from PARKING), reached by
 * a driveway through the near row. Paves the lot and paints the stalls; the caller
 * splices `notch` into the street's curb line so curb and sidewalk wrap the driveway.
 */
export function parkingLot(p: Painter, origin: P, u: P, street: RoadSpec, streetHalf: number, plan: ParkingLotPlan): ParkingLot {
  const standard = PARKING[street.region];
  const junction = JUNCTIONS[street.region];
  const { side } = plan;
  const at = frame(origin, u);
  const local = (s: number, d: number) => at(s, side * d);

  const near = streetHalf + plan.setback;
  const aisleNear = near + standard.stallDepth;
  const aisleFar = aisleNear + standard.aisleWidth;
  const back = aisleFar + standard.stallDepth;
  const drivewayTo = plan.drivewayFrom + standard.aisleWidth;

  // Lot surface: rectangle with rounded corners (the curb turns into the lot there).
  const r = LOT_CORNER_RADIUS;
  const corner = (s: number, d: number, a0: number, a1: number) => {
    const [cx, cz] = [s, d];
    return arc([cx, cz], r, a0, a1, 0.3);
  };
  const outlineLocal: P[] = [
    ...corner(plan.from + r, near + r, Math.PI, Math.PI * 1.5),
    ...corner(plan.to - r, near + r, Math.PI * 1.5, Math.PI * 2),
    ...corner(plan.to - r, back - r, 0, Math.PI * 0.5),
    ...corner(plan.from + r, back - r, Math.PI * 0.5, Math.PI),
  ];
  p.pave(outlineLocal.map(([s, d]) => local(s, d)));
  // Driveway, overlapping the street and the aisle.
  p.pave([
    local(plan.drivewayFrom, streetHalf - 0.5),
    local(drivewayTo, streetHalf - 0.5),
    local(drivewayTo, aisleNear + 0.5),
    local(plan.drivewayFrom, aisleNear + 0.5),
  ]);
  p.obstacle(local(plan.from, (near + back) / 2), local(plan.to, (near + back) / 2), (back - near) / 2 + 1.5);

  // Stall lines: separators running from the back of each row to the aisle.
  const lineWidth = street.markings.stallLine ?? 0.12;
  const stalls = (from: number, to: number, d0: number, d1: number) => {
    const count = Math.floor((to - from) / standard.stallWidth);
    if (count < 1) return;
    const start = (from + to) / 2 - (count * standard.stallWidth) / 2;
    for (let i = 0; i <= count; i += 1) {
      const s = start + i * standard.stallWidth;
      p.line([local(s, d0), local(s, d1)], lineWidth);
    }
  };
  const margin = 0.6;
  stalls(plan.from + margin, plan.drivewayFrom - margin, near + 0.3, aisleNear);
  stalls(drivewayTo + margin, plan.to - margin, near + 0.3, aisleNear);
  stalls(plan.from + margin, plan.to - margin, aisleFar, back - 0.3);

  const notchLocal: [number, number, number][] = [
    [plan.drivewayFrom, streetHalf, junction.drivewayRadius],
    [plan.drivewayFrom, near, r],
    [plan.from, near, r],
    [plan.from, back, r],
    [plan.to, back, r],
    [plan.to, near, r],
    [drivewayTo, near, r],
    [drivewayTo, streetHalf, junction.drivewayRadius],
  ];
  return {
    notch: notchLocal.map(([s, d]) => local(s, d)),
    notchRadii: notchLocal.map(([, , radius]) => radius),
    aisleOffset: side * (aisleNear + standard.aisleWidth / 2),
    aisleFrom: plan.from + 1,
    aisleTo: plan.to - 1,
    drivewayCenter: (plan.drivewayFrom + drivewayTo) / 2,
  };
}
