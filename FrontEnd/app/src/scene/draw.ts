import { CURB_WIDTH, type LineStyle } from "@/road/spec";
import type { Obstacle, Site, Surfaces } from "@/scene/environment";
import {
  add,
  len,
  MeshBatch,
  mul,
  norm,
  offsetPolyline,
  right,
  roundCorners,
  sub,
  dashes,
  dot,
  type P,
} from "@/scene/roads/geometry";
import * as THREE from "three";

export type { P } from "@/scene/roads/geometry";

/** Height of the asphalt surface. The terrain sits just below 0 around roads. */
export const ROAD_Y = 0.02;
/*
 * Paint is real geometry 8 mm above the asphalt and its material also has a stronger
 * polygon offset than the asphalt, so it wins the depth test at grazing angles and far
 * away without visibly floating.
 */
const PAINT_Y = ROAD_Y + 0.008;
/** Where vertical faces (curb backs, verges) end below ground so no gap shows. */
const BURY_Y = -0.08;

/** How far roads and markings that run off the site are continued. */
export const ROAD_EXTENSION = 650;

export type PaintColor = "white" | "yellow";

export type CurbOptions = {
  /** Curb reveal above the asphalt. */
  height: number;
  /** Sidewalk width behind the curb; one value, or one per input segment. */
  sidewalk?: number | number[];
  /** Corner radius at each input vertex (index-aligned with `points`). */
  radii?: number[];
};

function signTexture(lines: string[]) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#1f4aa8";
    context.fillRect(0, 0, 512, 256);
    context.strokeStyle = "#ffffff";
    context.lineWidth = 10;
    context.strokeRect(14, 14, 484, 228);
    context.fillStyle = "#ffffff";
    context.font = "600 64px system-ui, sans-serif";
    context.textAlign = "center";
    lines.forEach((line, index) => context.fillText(line, 256, 105 + index * 82));
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function polygonCentroid(points: P[]): P {
  let x = 0;
  let z = 0;
  for (const [px, pz] of points) {
    x += px;
    z += pz;
  }
  return [x / points.length, z / points.length];
}

/**
 * Draws a layout into a group. Plan shapes (asphalt, curbs, sidewalks, islands, paint)
 * are collected into one batch per material and turned into a handful of meshes by
 * `finish()`, so overlapping pieces of the same surface share depth and texture
 * exactly and never z-fight. Also records the road footprint for terrain and trees.
 */
export class Painter {
  readonly obstacles: Obstacle[] = [];

  private readonly asphalt = new MeshBatch();
  private readonly concrete = new MeshBatch();
  private readonly sidewalk = new MeshBatch();
  private readonly gravel = new MeshBatch();
  private readonly grass = new MeshBatch();
  private readonly paint: Record<PaintColor, MeshBatch> = { white: new MeshBatch(), yellow: new MeshBatch() };
  private finished = false;

  constructor(
    readonly group: THREE.Group,
    readonly s: Surfaces,
    readonly site: Site,
  ) {}

  // -------------------------------------------------------------------------
  // Site extent

  /** Distance from `origin` along unit `u` to the site boundary. */
  private toEdge(origin: P, u: P) {
    const hx = this.site.width / 2;
    const hz = this.site.depth / 2;
    const tx = u[0] > 1e-9 ? (hx - origin[0]) / u[0] : u[0] < -1e-9 ? (-hx - origin[0]) / u[0] : Infinity;
    const tz = u[1] > 1e-9 ? (hz - origin[1]) / u[1] : u[1] < -1e-9 ? (-hz - origin[1]) / u[1] : Infinity;
    return Math.max(0, Math.min(tx, tz));
  }

  /** How far a road leaving `origin` along `u` runs: past the site edge out to the horizon. */
  reach(origin: P, u: P) {
    return this.toEdge(origin, u) + ROAD_EXTENSION;
  }

  obstacle(a: P, b: P, halfWidth: number) {
    this.obstacles.push({ ax: a[0], az: a[1], bx: b[0], bz: b[1], halfWidth });
  }

  // -------------------------------------------------------------------------
  // Surfaces

  /** Asphalt polygon. */
  pave(outline: P[], holes: P[][] = []) {
    this.asphalt.floor(outline, ROAD_Y, holes);
  }

  /** Asphalt band along a→b covering lateral offsets tMin..tMax (positive = right of a→b). */
  paveStrip(a: P, b: P, tMin: number, tMax: number) {
    const n = right(norm(sub(b, a)));
    this.asphalt.ribbon([add(a, mul(n, tMin)), add(b, mul(n, tMin))], [add(a, mul(n, tMax)), add(b, mul(n, tMax))], ROAD_Y);
  }

  /** Unpaved gravel verge along a→b from lateral offset `inner` (at the pavement) to `outer`. */
  verge(a: P, b: P, inner: number, outer: number) {
    const n = right(norm(sub(b, a)));
    const edge = (t: number) => [add(a, mul(n, t)), add(b, mul(n, t))];
    // Falls ~6 cm across its width, the way a verge drains away from the pavement.
    this.gravel.ribbon(edge(inner), edge(outer), ROAD_Y - 0.005, ROAD_Y - 0.06);
    this.gravel.wall(edge(outer), BURY_Y, ROAD_Y - 0.06, Math.sign(outer - inner) as 1 | -1);
  }

  /**
   * Curb along a polyline that has the roadway on its LEFT, with an optional sidewalk
   * behind it. Corners are rounded with `radii`; where the curb turns away from the
   * road the asphalt is filled out to the new curb line.
   */
  curb(points: P[], options: CurbOptions) {
    const { height } = options;
    const rounded = roundCorners(points, options.radii ?? []);
    for (const corner of rounded.corners) {
      if (corner.turn > 0) this.asphalt.floor([corner.corner, ...corner.arc], ROAD_Y);
    }
    const line = rounded.points;
    const top = ROAD_Y + height;
    this.concrete.wall(line, BURY_Y, top, -1);
    const back = offsetPolyline(line, CURB_WIDTH);
    this.concrete.ribbon(line, back, top);

    const widthOf = (segment: number) => {
      const sidewalk = options.sidewalk ?? 0;
      return typeof sidewalk === "number" ? sidewalk : (sidewalk[segment] ?? 0);
    };
    // Group consecutive output segments with the same sidewalk width.
    let start = 0;
    for (let k = 1; k <= line.length - 1; k += 1) {
      const width = widthOf(rounded.segment[start]);
      if (k < line.length - 1 && widthOf(rounded.segment[k]) === width) continue;
      const run = line.slice(start, k + 1);
      if (width > 0) {
        const inner = offsetPolyline(run, CURB_WIDTH);
        const outer = offsetPolyline(run, CURB_WIDTH + width);
        this.sidewalk.ribbon(inner, outer, top);
        this.concrete.wall(outer, BURY_Y, top, 1);
      } else {
        this.concrete.wall(offsetPolyline(run, CURB_WIDTH), BURY_Y, top, 1);
      }
      start = k;
    }
  }

  /** Raised island (splitter, central island, apron) with a curb face all round. */
  raised(outline: P[], options: { height: number; base?: number; top: "concrete" | "grass"; holes?: P[][] }) {
    const base = options.base ?? ROAD_Y;
    const top = base + options.height;
    (options.top === "grass" ? this.grass : this.concrete).floor(outline, top, options.holes ?? []);
    const ring = (points: P[], outward: boolean) => {
      const closed = [...points, points[0]];
      const center = polygonCentroid(points);
      const d = norm(sub(closed[1], closed[0]));
      const rightIsOut = dot(right(d), sub(closed[0], center)) > 0;
      this.concrete.wall(closed, base - 0.02, top, (rightIsOut === outward ? 1 : -1) as 1 | -1);
    };
    ring(outline, true);
    for (const hole of options.holes ?? []) ring(hole, false);
  }

  // -------------------------------------------------------------------------
  // Paint

  /** A painted line; dashed when `pattern` is given (`phase` = position in the pattern at the first point). */
  line(points: P[], width: number, color: PaintColor = "white", pattern?: { dash: number; gap: number; phase?: number }) {
    const pieces = pattern && pattern.dash > 0 ? dashes(points, pattern.dash, pattern.gap, pattern.phase ?? 0) : [points];
    for (const piece of pieces) {
      if (piece.length < 2) continue;
      this.paint[color].ribbon(offsetPolyline(piece, -width / 2), offsetPolyline(piece, width / 2), PAINT_Y);
    }
  }

  /** A painted line following a marking standard (solid or broken). */
  styled(points: P[], style: LineStyle, color: PaintColor = "white", phase = 0) {
    this.line(points, style.width, color, style.dash > 0 ? { dash: style.dash, gap: style.gap, phase } : undefined);
  }

  /** A painted polygon (crosswalk bar, stop line). */
  patch(outline: P[], color: PaintColor = "white") {
    this.paint[color].floor(outline, PAINT_Y);
  }

  // -------------------------------------------------------------------------
  // Roadside furniture

  /** Concrete median barrier (New Jersey profile) along a straight line. */
  barrier(a: P, b: P) {
    const shape = new THREE.Shape();
    shape.moveTo(-0.3, 0);
    shape.lineTo(-0.25, 0.08);
    shape.lineTo(-0.1, 0.33);
    shape.lineTo(-0.08, 0.85);
    shape.lineTo(0.08, 0.85);
    shape.lineTo(0.1, 0.33);
    shape.lineTo(0.25, 0.08);
    shape.lineTo(0.3, 0);
    shape.closePath();
    this.extruded(shape, a, b, this.s.concrete, 2);
  }

  /** W-beam guardrail on posts; the rail faces the LEFT of a→b, where the road is. */
  guardrail(a: P, b: P) {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.5);
    shape.lineTo(0.08, 0.5);
    shape.lineTo(0.14, 0.58);
    shape.lineTo(0.08, 0.66);
    shape.lineTo(0.14, 0.74);
    shape.lineTo(0.08, 0.82);
    shape.lineTo(0, 0.82);
    shape.closePath();
    this.extruded(shape, a, b, this.s.metal, 0);

    // Posts every 4 m (common W-beam spacing), shown up to 1.6 km.
    const length = len(sub(b, a));
    const count = Math.min(400, Math.floor(length / 4));
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.8, 0.14), this.s.metal, count);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i += 1) {
      const t = (i + 0.5) / count;
      dummy.position.set(a[0] + (b[0] - a[0]) * t, 0.4, a[1] + (b[1] - a[1]) * t);
      dummy.rotation.y = Math.atan2(b[0] - a[0], b[1] - a[1]);
      dummy.updateMatrix();
      posts.setMatrixAt(i, dummy.matrix);
    }
    posts.castShadow = true;
    this.group.add(posts);
  }

  private extruded(shape: THREE.Shape, a: P, b: P, material: THREE.Material, tile: number) {
    const length = len(sub(b, a));
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false, steps: 1 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(a[0], ROAD_Y, a[1]);
    mesh.rotation.y = Math.atan2(b[0] - a[0], b[1] - a[1]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (tile) mesh.userData.uvTile = tile;
    this.group.add(mesh);
  }

  /** Overhead sign gantry spanning across the road at a given x. */
  gantry(x: number, z0: number, z1: number, signs: { z: number; lines: string[] }[]) {
    const height = 6.6;
    const steel = this.s.metal;
    for (const z of [z0, z1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, height + 0.6, 12), steel);
      post.position.set(x, (height + 0.6) / 2, z);
      post.castShadow = true;
      this.group.add(post);
    }
    for (const dy of [0, 0.9]) {
      const chord = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, Math.abs(z1 - z0)), steel);
      chord.position.set(x, height + dy, (z0 + z1) / 2);
      chord.castShadow = true;
      this.group.add(chord);
    }
    for (const sign of signs) {
      const face = new THREE.MeshStandardMaterial({ map: signTexture(sign.lines), roughness: 0.5 });
      const back = new THREE.MeshStandardMaterial({ color: 0x6d7378, roughness: 0.7 });
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.0, 4.0), [back, face, back, back, back, back]);
      panel.position.set(x - 0.2, height + 0.45, sign.z);
      panel.castShadow = true;
      this.group.add(panel);
    }
  }

  // -------------------------------------------------------------------------

  /** Turns the collected batches into meshes. Call once at the end of a layout's build. */
  finish() {
    if (this.finished) return;
    this.finished = true;
    const add = (batch: MeshBatch, material: THREE.Material, tile: number, castShadow = false) => {
      const mesh = batch.build(material);
      if (!mesh) return;
      if (tile) mesh.userData.uvTile = tile;
      mesh.receiveShadow = true;
      mesh.castShadow = castShadow;
      this.group.add(mesh);
    };
    add(this.asphalt, this.s.road, 7);
    add(this.gravel, this.s.verge, 3);
    add(this.concrete, this.s.concrete, 2, true);
    add(this.sidewalk, this.s.sidewalk, 2.5);
    add(this.grass, this.s.island, 5);
    add(this.paint.white, this.s.paintWhite, 0);
    add(this.paint.yellow, this.s.paintYellow, 0);
  }
}
