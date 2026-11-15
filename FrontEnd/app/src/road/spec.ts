/*
 * Road physical model: one source of truth for road geometry (graphics) and road physics
 * (kinematics). A RoadSpec is resolved from:
 *   1. design standards for the region and road class (STANDARDS below),
 *   2. map data for the location (OpenStreetMap-style tags, see fromOsmTags), and
 *   3. what computer vision measured in the footage (lane count, lane width, dashes).
 * Later sources override earlier ones, field by field, so a measured lane count always
 * wins over a database guess, and a database width wins over the textbook default.
 *
 * All lengths are metres, speeds m/s, angles radians unless a name says otherwise.
 */

export type Region = "US" | "DE" | "EU";

export type RoadClass = "motorway" | "arterial" | "collector" | "local";

export type SurfaceCondition = "dry" | "wet" | "snow" | "ice";

/** A broken (dashed) or continuous painted line. */
export type LineStyle = { width: number; dash: number; gap: number } | { width: number; dash: 0; gap: 0 };

export type MarkingStandard = {
  /** Line between lanes travelling the same way. */
  laneLine: LineStyle;
  /** Line between opposing directions on an undivided road. */
  centerLine: LineStyle & { color: "white" | "yellow"; double: boolean };
  /** Continuous line at the outer edge of the travelled way. */
  edgeLine: LineStyle;
  stopLineWidth: number;
  /** Width of each crosswalk (zebra) bar and the gap between bars. */
  crosswalkBar: number;
  crosswalkGap: number;
  crosswalkLength: number;
  /** Clear space between the two lines of a double line (e.g. US double yellow). */
  doubleLineSpacing?: number;
  /** Give-way line across an entry (DE Zeichen 341 "Wartelinie": broken 0.5 m / 0.25 m). */
  yieldLine?: LineStyle;
  /** Width of the painted stall lines in car parks. */
  stallLine?: number;
};

export type ClassStandard = {
  laneWidth: number;
  /** Paved shoulder on the outside (right in right-hand traffic). */
  outerShoulder: number;
  /** Paved strip between the inner lane and the median / centre line. */
  innerShoulder: number;
  /** Divided by a physical median (barrier or verge) rather than paint. */
  divided: boolean;
  medianWidth: number;
  /** Raised curb at the edge (urban) instead of a soft verge. */
  curb: boolean;
  curbHeight: number;
  sidewalk: number;
  /** Typical posted limit when nothing better is known. */
  speedLimit: number;
  /** Cross slope of each lane (crown), as a fraction (0.02 = 2 %). */
  crossSlope: number;
  markings: MarkingStandard;
};

const ft = (feet: number) => feet * 0.3048;
const inch = (inches: number) => inches * 0.0254;
const kmh = (value: number) => value / 3.6;
const mph = (value: number) => value * 0.44704;

const solid = (width: number): LineStyle => ({ width, dash: 0, gap: 0 });

/*
 * Values follow common design practice. Where the standard gives a range we take the
 * typical value; CV and map data refine it per site.
 *
 * US: AASHTO "A Policy on Geometric Design of Highways and Streets" (lane widths,
 *     shoulders, 2 % cross slope) and the MUTCD Part 3 (10 ft lines / 30 ft gaps,
 *     4-6 in lines, yellow centre lines, 12-24 in stop lines).
 * DE: RAA (Autobahn), RAL (rural), RASt (urban) cross-sections and RMS markings
 *     (Autobahn 6 m / 12 m dashes, 0.15 m lane lines, 0.30 m edge lines;
 *     urban 3 m / 6 m, 0.12 m).
 * EU: generic fallback modelled on DE.
 */
const US_MARKINGS: MarkingStandard = {
  laneLine: { width: inch(6), dash: ft(10), gap: ft(30) },
  centerLine: { width: inch(6), dash: 0, gap: 0, color: "yellow", double: true },
  edgeLine: solid(inch(6)),
  stopLineWidth: inch(24),
  crosswalkBar: inch(24),
  crosswalkGap: inch(36),
  crosswalkLength: ft(10),
  // MUTCD 3A.06: the two lines of a double line are separated by a discernible space; 4-6 in is usual.
  doubleLineSpacing: inch(6),
  stallLine: inch(4),
};

const DE_MOTORWAY_MARKINGS: MarkingStandard = {
  laneLine: { width: 0.15, dash: 6, gap: 12 },
  centerLine: { width: 0.15, dash: 6, gap: 12, color: "white", double: false },
  edgeLine: solid(0.3),
  stopLineWidth: 0.5,
  crosswalkBar: 0.5,
  crosswalkGap: 0.5,
  crosswalkLength: 4,
  doubleLineSpacing: 0.15,
  yieldLine: { width: 0.5, dash: 0.5, gap: 0.25 },
  stallLine: 0.12,
};

const DE_URBAN_MARKINGS: MarkingStandard = {
  laneLine: { width: 0.12, dash: 3, gap: 6 },
  centerLine: { width: 0.12, dash: 3, gap: 6, color: "white", double: false },
  edgeLine: solid(0.25),
  stopLineWidth: 0.5,
  crosswalkBar: 0.5,
  crosswalkGap: 0.5,
  crosswalkLength: 4,
  doubleLineSpacing: 0.12,
  yieldLine: { width: 0.5, dash: 0.5, gap: 0.25 },
  stallLine: 0.12,
};

export const STANDARDS: Record<Region, Record<RoadClass, ClassStandard>> = {
  US: {
    motorway: {
      laneWidth: ft(12),
      outerShoulder: ft(10),
      innerShoulder: ft(4),
      divided: true,
      medianWidth: 0.6,
      curb: false,
      curbHeight: 0,
      sidewalk: 0,
      speedLimit: mph(65),
      crossSlope: 0.02,
      markings: US_MARKINGS,
    },
    arterial: {
      laneWidth: ft(11),
      outerShoulder: 0,
      innerShoulder: 0,
      divided: false,
      medianWidth: 0,
      curb: true,
      curbHeight: inch(6),
      sidewalk: ft(6),
      speedLimit: mph(40),
      crossSlope: 0.02,
      markings: US_MARKINGS,
    },
    collector: {
      laneWidth: ft(11),
      outerShoulder: ft(4),
      innerShoulder: 0,
      divided: false,
      medianWidth: 0,
      curb: true,
      curbHeight: inch(6),
      sidewalk: ft(5),
      speedLimit: mph(35),
      crossSlope: 0.02,
      markings: US_MARKINGS,
    },
    local: {
      laneWidth: ft(10),
      outerShoulder: 0,
      innerShoulder: 0,
      divided: false,
      medianWidth: 0,
      curb: true,
      curbHeight: inch(6),
      sidewalk: ft(5),
      speedLimit: mph(25),
      crossSlope: 0.02,
      markings: US_MARKINGS,
    },
  },
  DE: {
    motorway: {
      laneWidth: 3.75,
      outerShoulder: 2.5,
      innerShoulder: 0.75,
      divided: true,
      medianWidth: 0.6,
      curb: false,
      curbHeight: 0,
      sidewalk: 0,
      speedLimit: kmh(130),
      crossSlope: 0.025,
      markings: DE_MOTORWAY_MARKINGS,
    },
    arterial: {
      laneWidth: 3.25,
      outerShoulder: 0,
      innerShoulder: 0,
      divided: false,
      medianWidth: 0,
      curb: true,
      curbHeight: 0.12,
      sidewalk: 2.5,
      speedLimit: kmh(50),
      crossSlope: 0.025,
      markings: DE_URBAN_MARKINGS,
    },
    collector: {
      laneWidth: 3.0,
      outerShoulder: 0,
      innerShoulder: 0,
      divided: false,
      medianWidth: 0,
      curb: true,
      curbHeight: 0.12,
      sidewalk: 2.5,
      speedLimit: kmh(50),
      crossSlope: 0.025,
      markings: DE_URBAN_MARKINGS,
    },
    local: {
      laneWidth: 2.75,
      outerShoulder: 0,
      innerShoulder: 0,
      divided: false,
      medianWidth: 0,
      curb: true,
      curbHeight: 0.12,
      sidewalk: 2.0,
      speedLimit: kmh(30),
      crossSlope: 0.025,
      markings: DE_URBAN_MARKINGS,
    },
  },
  EU: {} as Record<RoadClass, ClassStandard>,
};
STANDARDS.EU = STANDARDS.DE;

/** Typical lane counts per direction when neither CV nor map data says otherwise. */
const DEFAULT_LANES_PER_DIRECTION: Record<RoadClass, number> = {
  motorway: 3,
  arterial: 2,
  collector: 1,
  local: 1,
};

/*
 * Tyre-road friction (peak, passenger car tyres) by surface. Typical values used in
 * collision reconstruction; real values vary with tyre, speed and pavement.
 */
export const FRICTION: Record<SurfaceCondition, { mu: number; range: [number, number] }> = {
  dry: { mu: 0.75, range: [0.65, 0.9] },
  wet: { mu: 0.5, range: [0.4, 0.65] },
  snow: { mu: 0.25, range: [0.15, 0.35] },
  ice: { mu: 0.1, range: [0.05, 0.15] },
};

export const GRAVITY = 9.81;

// ---------------------------------------------------------------------------
// Inputs from map data and computer vision

/** What map data (e.g. OpenStreetMap tags) knows about the road at a location. */
export type DatabaseRoad = {
  roadClass?: RoadClass;
  /** Total lanes, both directions. */
  lanes?: number;
  lanesForward?: number;
  lanesBackward?: number;
  oneway?: boolean;
  /** Total carriageway width, if mapped. */
  width?: number;
  speedLimit?: number;
  divided?: boolean;
};

/** What computer vision measured in the footage. */
export type ObservedRoad = {
  /** Lanes counted per direction. */
  lanesForward?: number;
  lanesBackward?: number;
  /** Mean measured lane width (needs metric calibration of the camera). */
  laneWidth?: number;
  /** Measured dash and gap of the lane lines, if visible. */
  laneDash?: number;
  laneGap?: number;
  surface?: SurfaceCondition;
  /** 0..1, how far to trust the measured lane width over the standard. */
  widthConfidence?: number;
};

export type RoadContext = {
  region: Region;
  roadClass: RoadClass;
  /** Driving side. Right-hand traffic in US and continental Europe. */
  drivesOn?: "right" | "left";
  database?: DatabaseRoad;
  observed?: ObservedRoad;
};

/** Converts OpenStreetMap way tags (highway, lanes, width, maxspeed, ...) to DatabaseRoad. */
export function fromOsmTags(tags: Record<string, string>): DatabaseRoad {
  const number = (value?: string) => {
    if (!value) return undefined;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const classByHighway: Record<string, RoadClass> = {
    motorway: "motorway",
    trunk: "motorway",
    primary: "arterial",
    secondary: "arterial",
    tertiary: "collector",
    unclassified: "local",
    residential: "local",
    service: "local",
  };
  const highway = tags.highway?.replace(/_link$/, "");
  let speedLimit: number | undefined;
  const maxspeed = tags.maxspeed;
  if (maxspeed) {
    const value = number(maxspeed);
    if (value !== undefined) speedLimit = maxspeed.includes("mph") ? mph(value) : kmh(value);
  }
  return {
    roadClass: highway ? classByHighway[highway] : undefined,
    lanes: number(tags.lanes),
    lanesForward: number(tags["lanes:forward"]),
    lanesBackward: number(tags["lanes:backward"]),
    oneway: tags.oneway === "yes" || tags.highway === "motorway",
    width: number(tags.width),
    speedLimit,
    divided: tags.dual_carriageway === "yes" || tags.highway === "motorway" ? true : undefined,
  };
}

// ---------------------------------------------------------------------------
// Resolved spec

export type RoadSpec = {
  region: Region;
  roadClass: RoadClass;
  drivesOn: "right" | "left";
  lanesForward: number;
  lanesBackward: number;
  laneWidth: number;
  innerShoulder: number;
  outerShoulder: number;
  divided: boolean;
  medianWidth: number;
  curb: boolean;
  curbHeight: number;
  sidewalk: number;
  crossSlope: number;
  speedLimit: number;
  surface: SurfaceCondition;
  markings: MarkingStandard;
  /** Where each value came from, for the UI and for audit. */
  provenance: Partial<Record<keyof Omit<RoadSpec, "provenance">, "standard" | "database" | "observed">>;
};

export function resolveRoadSpec(context: RoadContext): RoadSpec {
  const standard = STANDARDS[context.region][context.roadClass];
  const database = context.database ?? {};
  const observed = context.observed ?? {};
  const provenance: RoadSpec["provenance"] = {};

  const divided = database.divided ?? standard.divided;
  let lanesForward = DEFAULT_LANES_PER_DIRECTION[context.roadClass];
  let lanesBackward = database.oneway ? 0 : lanesForward;
  provenance.lanesForward = "standard";
  if (database.lanesForward !== undefined || database.lanes !== undefined) {
    if (database.lanesForward !== undefined) lanesForward = database.lanesForward;
    else if (database.oneway) lanesForward = database.lanes!;
    else lanesForward = Math.ceil(database.lanes! / 2);
    if (database.lanesBackward !== undefined) lanesBackward = database.lanesBackward;
    else if (!database.oneway && database.lanes !== undefined) lanesBackward = database.lanes - lanesForward;
    provenance.lanesForward = "database";
  }
  if (observed.lanesForward !== undefined) {
    lanesForward = observed.lanesForward;
    if (observed.lanesBackward !== undefined) lanesBackward = observed.lanesBackward;
    provenance.lanesForward = "observed";
  }
  provenance.lanesBackward = provenance.lanesForward;

  let laneWidth = standard.laneWidth;
  provenance.laneWidth = "standard";
  const totalLanes = lanesForward + lanesBackward;
  if (database.width !== undefined && totalLanes > 0) {
    // OSM width is the whole carriageway; take shoulders out before dividing.
    const shoulders = (standard.outerShoulder + standard.innerShoulder) * (lanesBackward > 0 ? 2 : 1);
    const perLane = (database.width - shoulders - (divided ? standard.medianWidth : 0)) / totalLanes;
    if (perLane > 2.3 && perLane < 4.6) {
      laneWidth = perLane;
      provenance.laneWidth = "database";
    }
  }
  if (observed.laneWidth !== undefined) {
    const trust = Math.min(1, Math.max(0, observed.widthConfidence ?? 0.5));
    laneWidth = laneWidth + (observed.laneWidth - laneWidth) * trust;
    provenance.laneWidth = "observed";
  }

  const markings: MarkingStandard = {
    ...standard.markings,
    laneLine:
      observed.laneDash !== undefined && observed.laneGap !== undefined
        ? { ...standard.markings.laneLine, dash: observed.laneDash, gap: observed.laneGap }
        : standard.markings.laneLine,
  };

  const speedLimit = database.speedLimit ?? standard.speedLimit;
  provenance.speedLimit = database.speedLimit !== undefined ? "database" : "standard";
  const surface = observed.surface ?? "dry";
  provenance.surface = observed.surface ? "observed" : "standard";

  return {
    region: context.region,
    roadClass: context.roadClass,
    drivesOn: context.drivesOn ?? "right",
    lanesForward,
    lanesBackward,
    laneWidth,
    innerShoulder: standard.innerShoulder,
    outerShoulder: standard.outerShoulder,
    divided,
    medianWidth: divided ? standard.medianWidth : 0,
    curb: standard.curb,
    curbHeight: standard.curbHeight,
    sidewalk: standard.sidewalk,
    crossSlope: standard.crossSlope,
    speedLimit,
    surface,
    markings,
    provenance,
  };
}

// ---------------------------------------------------------------------------
// Cross-section: lateral offsets used by both the renderer and the simulator.
// Offsets are measured from the road centreline; positive is to the right of the
// forward direction of travel.

export type CrossSection = {
  /** Centre of each forward lane, innermost first. */
  forwardLaneCenters: number[];
  /** Centre of each backward lane, innermost first (negative offsets). */
  backwardLaneCenters: number[];
  /** Outer edge of the paved surface on each side. */
  pavedHalfWidthForward: number;
  pavedHalfWidthBackward: number;
  /** Half the median (0 when undivided). */
  medianHalf: number;
  /** Total width including curbs and sidewalks. */
  totalWidth: number;
};

export function crossSection(spec: RoadSpec): CrossSection {
  const medianHalf = spec.divided ? spec.medianWidth / 2 : 0;
  const side = (lanes: number, sign: 1 | -1) => {
    const start = medianHalf + (spec.divided ? spec.innerShoulder : 0);
    const centers = Array.from({ length: lanes }, (_, i) => sign * (start + spec.laneWidth * (i + 0.5)));
    const paved = lanes > 0 ? start + spec.laneWidth * lanes + spec.outerShoulder : medianHalf;
    return { centers, paved };
  };
  const forward = side(spec.lanesForward, 1);
  const backward = side(spec.lanesBackward, -1);
  const extra = (spec.curb ? 0.15 : 0) + spec.sidewalk;
  return {
    forwardLaneCenters: forward.centers,
    backwardLaneCenters: backward.centers,
    pavedHalfWidthForward: forward.paved,
    pavedHalfWidthBackward: backward.paved,
    medianHalf,
    totalWidth: forward.paved + backward.paved + extra * 2,
  };
}

// ---------------------------------------------------------------------------
// Junctions, roundabouts, car parks, bus stops

export type JunctionStandard = {
  /** Curb return radius at a street corner, by the larger of the two road classes. */
  cornerRadius: Record<RoadClass, number>;
  /** Clear distance between a stop line and the near edge of the crosswalk. */
  stopLineSetback: number;
  /** Distance from the crossing road's paved edge to the near edge of the crosswalk. */
  crosswalkSetback: number;
  /** Curb return radius where a driveway or car-park aisle meets the street. */
  drivewayRadius: number;
};

/*
 * US: AASHTO Green Book ch. 9 (15-30 ft curb returns on urban streets, ~25 ft on
 *     arterials), MUTCD 3B.16 (stop line 4 ft ahead of the crosswalk).
 * DE: RASt 06 (corner radii 6-10 m; three-centred curves where trucks turn).
 */
export const JUNCTIONS: Record<Region, JunctionStandard> = {
  US: {
    cornerRadius: { motorway: ft(40), arterial: ft(25), collector: ft(20), local: ft(15) },
    stopLineSetback: ft(4),
    crosswalkSetback: ft(3),
    drivewayRadius: ft(10),
  },
  DE: {
    cornerRadius: { motorway: 15, arterial: 10, collector: 8, local: 6 },
    stopLineSetback: 1.0,
    crosswalkSetback: 1.0,
    drivewayRadius: 3,
  },
  EU: {} as JunctionStandard,
};
JUNCTIONS.EU = JUNCTIONS.DE;

export type RoundaboutStandard = {
  /** Outer (inscribed circle) radius. */
  outerRadius: number;
  /** Width of the circulatory roadway, excluding the truck apron. */
  circulatoryWidth: number;
  /** Mountable truck apron around the central island, and its height above the roadway. */
  apronWidth: number;
  apronHeight: number;
  /** Entry and exit lane widths between splitter island and curb. */
  entryWidth: number;
  exitWidth: number;
  /** Curb radius from the approach into the circle (same for entry and exit here). */
  cornerRadius: number;
  /** Splitter island width where it meets the circle, and its length along the approach. */
  splitterWidth: number;
  splitterLength: number;
};

/*
 * DE: single-lane urban roundabout after FGSV "Merkblatt fuer die Anlage von
 *     Kreisverkehren" (2006): outer diameter 26-40 m, circulatory roadway 6.5-9 m,
 *     apron 1.5-4 m raised 4-5 cm, entry 3.25-3.75 m, exit 3.5-4.0 m, entry radius
 *     10-14 m, splitter island >= 1.6 m (2.5 m where pedestrians wait on it).
 * US: FHWA / NCHRP Report 672 single-lane: inscribed diameter 90-180 ft, circulatory
 *     roadway 16-20 ft, entry 14-18 ft.
 */
export const ROUNDABOUTS: Record<Region, RoundaboutStandard> = {
  US: {
    outerRadius: ft(55),
    circulatoryWidth: ft(18),
    apronWidth: ft(10),
    apronHeight: inch(2),
    entryWidth: ft(14),
    exitWidth: ft(15),
    cornerRadius: ft(50),
    splitterWidth: ft(10),
    splitterLength: ft(50),
  },
  DE: {
    outerRadius: 14,
    circulatoryWidth: 6.5,
    apronWidth: 2.0,
    apronHeight: 0.05,
    entryWidth: 3.5,
    exitWidth: 3.75,
    cornerRadius: 10,
    splitterWidth: 2.5,
    splitterLength: 16,
  },
  EU: {} as RoundaboutStandard,
};
ROUNDABOUTS.EU = ROUNDABOUTS.DE;

export type ParkingStandard = {
  stallWidth: number;
  stallDepth: number;
  /** Two-way aisle serving 90 degree stalls. */
  aisleWidth: number;
};

/*
 * US: ITE / ULI "Dimensions of Parking" (9 ft x 18 ft stalls, 24 ft two-way aisle at 90 deg).
 * DE: EAR 05 (2.50 m x 5.00 m stalls, 6.50 m aisle at 90 deg).
 */
export const PARKING: Record<Region, ParkingStandard> = {
  US: { stallWidth: ft(9), stallDepth: ft(18), aisleWidth: ft(24) },
  DE: { stallWidth: 2.5, stallDepth: 5.0, aisleWidth: 6.5 },
  EU: {} as ParkingStandard,
};
PARKING.EU = PARKING.DE;

export type BusBayStandard = { depth: number; stopLength: number; entryTaper: number; exitTaper: number };

/** Bus bay (Busbucht) after FGSV EAÖ 2013: 3.0 m deep, ~15 m stop for one standard bus, tapers either end. */
export const BUS_BAY: BusBayStandard = { depth: 3.0, stopLength: 15, entryTaper: 12, exitTaper: 10 };

/** Unpaved verge (Bankett) beside rural roads and motorways; RAA 2008 / RAL 2012 use 1.5 m. */
export const VERGE_WIDTH = 1.5;

/** Width of the top of a standard curb stone (DE Hochbord 15 cm; US 6 in curb). */
export const CURB_WIDTH = 0.15;

/** Lateral offsets of the painted lines on one road, from the centreline (positive = forward side). */
export type MarkingLayout = {
  /** Centre line(s) between directions (undivided roads only), one offset per painted line. */
  center: number[];
  /** Lines between same-direction lanes. */
  forwardLanes: number[];
  backwardLanes: number[];
  /** Edge lines at the outside of the travelled way (left out on curbed roads with no shoulder). */
  forwardEdge?: number;
  backwardEdge?: number;
  /** Edge lines along the median on divided roads. */
  forwardInnerEdge?: number;
  backwardInnerEdge?: number;
};

/**
 * Where each painted line sits. Edge lines lie on the shoulder side of the lane edge so
 * the full lane width stays clear (RMS / MUTCD practice).
 */
export function markingLayout(spec: RoadSpec): MarkingLayout {
  const m = spec.markings;
  const medianHalf = spec.divided ? spec.medianWidth / 2 : 0;
  const start = medianHalf + (spec.divided ? spec.innerShoulder : 0);
  const between = (lanes: number) =>
    Array.from({ length: Math.max(0, lanes - 1) }, (_, i) => start + spec.laneWidth * (i + 1));
  const layout: MarkingLayout = {
    center: [],
    forwardLanes: between(spec.lanesForward),
    backwardLanes: between(spec.lanesBackward).map((offset) => -offset),
  };
  if (!spec.divided && spec.lanesForward > 0 && spec.lanesBackward > 0) {
    if (m.centerLine.double) {
      const half = (m.doubleLineSpacing ?? m.centerLine.width) / 2 + m.centerLine.width / 2;
      layout.center = [-half, half];
    } else {
      layout.center = [0];
    }
  }
  if (spec.divided) {
    layout.forwardInnerEdge = start - m.edgeLine.width / 2;
    layout.backwardInnerEdge = -layout.forwardInnerEdge;
  }
  const outer = (lanes: number) => start + spec.laneWidth * lanes + m.edgeLine.width / 2;
  if (!spec.curb || spec.outerShoulder > 0) {
    if (spec.lanesForward > 0) layout.forwardEdge = outer(spec.lanesForward);
    if (spec.lanesBackward > 0) layout.backwardEdge = -outer(spec.lanesBackward);
  }
  return layout;
}


// ---------------------------------------------------------------------------
// Physics helpers for the kinematics simulator

export function friction(spec: Pick<RoadSpec, "surface">) {
  return FRICTION[spec.surface].mu;
}

/** Maximum braking deceleration on this surface (m/s^2), assuming locked or ABS-limited tyres. */
export function maxDeceleration(spec: Pick<RoadSpec, "surface">, gradeFraction = 0) {
  return GRAVITY * (friction(spec) + gradeFraction);
}

/** Distance to stop from `speed`: perception-reaction travel plus braking distance. */
export function stoppingDistance(speed: number, spec: Pick<RoadSpec, "surface">, reactionTime = 1.5, gradeFraction = 0) {
  return speed * reactionTime + (speed * speed) / (2 * maxDeceleration(spec, gradeFraction));
}

/** Speed implied by a skid of `length` metres to a stop: v = sqrt(2 * mu * g * d). */
export function speedFromSkid(length: number, spec: Pick<RoadSpec, "surface">, gradeFraction = 0) {
  return Math.sqrt(2 * maxDeceleration(spec, gradeFraction) * length);
}

/** Highest speed a car can hold on a curve of `radius` before sliding (point-mass model). */
export function criticalCurveSpeed(radius: number, spec: Pick<RoadSpec, "surface">, superelevation = 0) {
  const mu = friction(spec);
  return Math.sqrt((GRAVITY * radius * (superelevation + mu)) / Math.max(1e-6, 1 - mu * superelevation));
}
