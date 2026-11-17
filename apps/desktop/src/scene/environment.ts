import * as THREE from "three";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";

/*
 * The environment around a reconstruction: sky and light, ground cover, snow, wet road.
 * It is not picked by hand; it comes from the source footage (see lib/analyzeFootage.ts).
 * Textures and sky HDRIs are CC0 from Poly Haven (see public/textures/CREDITS.md).
 */

export type SkyKind = "clear" | "overcast" | "dusk" | "night";

export type SceneEnvironment = {
  sky: SkyKind;
  /** 0..0.6: share of open ground covered by snow. */
  snow: number;
  vegetation: "green" | "dormant" | "arid";
  /** Road surface. Also feeds the friction used by the kinematics (road/spec.ts). */
  road: "dry" | "wet";
};

export const DEFAULT_ENVIRONMENT: SceneEnvironment = { sky: "clear", snow: 0, vegetation: "green", road: "dry" };

export function environmentKey(environment: SceneEnvironment) {
  return `${environment.sky}/${environment.snow}/${environment.vegetation}/${environment.road}`;
}

export function describeEnvironment(environment: SceneEnvironment) {
  const sky = { clear: "Clear sky", overcast: "Overcast", dusk: "Low sun", night: "Night" }[environment.sky];
  const road = environment.road === "wet" ? " · wet road" : "";
  const snow = environment.snow > 0 ? ` · ${environment.snow >= 0.3 ? "snow cover" : "patchy snow"}` : "";
  const ground = { green: " · green verges", dormant: " · dormant verges", arid: " · dry, sandy ground" }[
    environment.vegetation
  ];
  return sky + road + snow + ground;
}

type Rgb = [number, number, number];

export type EnvPack = {
  /** Basename in public/textures/sky: `<sky>.hdr` lights the scene, `<sky>.jpg` is the visible backdrop. */
  sky: string;
  envIntensity: number;
  sunIntensity: number;
  sunColor: string;
  hemiIntensity: number;
  /** Brightness of the visible sky backdrop (night darkens a daytime-exposed image). */
  backgroundIntensity: number;
  /** 0..1: how bright vehicle head/tail lamps glow. Lamps are on at night, dusk and in grey weather. */
  lamps: number;
  fogDensity: number;
  /** Linear multipliers applied to each texture so it lands on the target colour. */
  asphaltTint: Rgb;
  concreteTint: Rgb;
  ground: { texture: string; tint: Rgb; snow: number; snowTint: Rgb };
  trees: "leafy" | "bare";
  /** 0..1 relative tree count. */
  treeDensity: number;
  wet: boolean;
};

type Lighting = Omit<EnvPack, "ground" | "trees" | "treeDensity" | "wet">;

const LIGHTING: Record<SkyKind, Lighting> = {
  clear: {
    sky: "kloofendal_48d_partly_cloudy_puresky",
    envIntensity: 0.9,
    sunIntensity: 2.6,
    sunColor: "#fff4e0",
    hemiIntensity: 0.25,
    backgroundIntensity: 1,
    lamps: 0.15,
    fogDensity: 0.0016,
    asphaltTint: [1.15, 1.15, 1.15],
    concreteTint: [1.0, 1.0, 1.0],
  },
  // Calibrated on the r05_s03 footage: asphalt averages #837e7a under overcast light.
  overcast: {
    sky: "kloofendal_overcast_puresky",
    envIntensity: 1.15,
    sunIntensity: 0.55,
    sunColor: "#e8eef8",
    hemiIntensity: 0.35,
    backgroundIntensity: 1,
    lamps: 0.5,
    fogDensity: 0.0021,
    asphaltTint: [1.5, 1.5, 1.56],
    // r05_s03 median barrier reads mid-grey (#6f715e, partly shaded).
    concreteTint: [0.8, 0.8, 0.8],
  },
  dusk: {
    sky: "qwantani_dusk_2_puresky",
    envIntensity: 1.1,
    sunIntensity: 1.6,
    sunColor: "#ffb27a",
    hemiIntensity: 0.15,
    backgroundIntensity: 1,
    lamps: 0.8,
    fogDensity: 0.0024,
    asphaltTint: [1.0, 1.0, 1.0],
    concreteTint: [1.0, 1.0, 1.0],
  },
  // Moonlit sky with a warm sodium/LED glow from the city bouncing off the ground.
  night: {
    sky: "kloppenheim_02_puresky",
    envIntensity: 0.12,
    sunIntensity: 0.18,
    sunColor: "#9fb6ff",
    hemiIntensity: 0.32,
    backgroundIntensity: 0.14,
    lamps: 1,
    fogDensity: 0.0028,
    asphaltTint: [1.0, 1.0, 1.0],
    concreteTint: [1.0, 1.0, 1.0],
  },
};

const GROUND: Record<SceneEnvironment["vegetation"], { texture: string; tint: Rgb }> = {
  green: { texture: "leafy_grass", tint: [0.55, 0.95, 0.38] },
  // r05_s03 verge grass averages #727065.
  dormant: { texture: "withered_grass", tint: [0.42, 0.55, 0.62] },
  // Sand in the reference drone footage (19166351) averages #ab9a88.
  arid: { texture: "sandy_gravel", tint: [0.96, 0.92, 0.78] },
};

const TREE_DENSITY: Record<SceneEnvironment["vegetation"], number> = { green: 1, dormant: 1, arid: 0.2 };

/*
 * Base tints that turn each (warm-toned) Poly Haven texture into a neutral material of
 * realistic albedo; the per-sky `concreteTint` then scales them for the lighting.
 * Texture means (sRGB): brushed_concrete #6c6258, concrete_pavement #80746a,
 * gravel_ground_01 #95816a.
 */
const CONCRETE_BASE: Rgb = [2.2, 2.7, 3.2]; // light grey cast concrete (curbs, barriers)
const SIDEWALK_BASE: Rgb = [1.63, 1.95, 2.18]; // pale paving slabs, ~#a09e98
const VERGE_BASE: Rgb = [0.62, 0.78, 0.98]; // grey-brown road gravel, ~#78736a

function times(a: Rgb, b: Rgb): Rgb {
  return [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
}

/** r05_s03 snow averages #b4bbc6. */
const SNOW_TINT: Rgb = [1.15, 1.42, 1.38];

export function resolveEnvironment(environment: SceneEnvironment): EnvPack {
  return {
    ...LIGHTING[environment.sky],
    ground: { ...GROUND[environment.vegetation], snow: environment.snow, snowTint: SNOW_TINT },
    trees: environment.vegetation === "dormant" ? "bare" : "leafy",
    treeDensity: TREE_DENSITY[environment.vegetation],
    wet: environment.road === "wet",
  };
}

// ---------------------------------------------------------------------------
// Texture loading

const BASE = `${import.meta.env.BASE_URL}textures/`;
const textureLoader = new THREE.TextureLoader();
const textureCache = new Map<string, THREE.Texture>();

function loadTexture(path: string, srgb: boolean) {
  let texture = textureCache.get(path);
  if (!texture) {
    texture = textureLoader.load(BASE + path);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.anisotropy = 8;
    textureCache.set(path, texture);
  }
  return texture;
}

function linear([r, g, b]: Rgb) {
  return new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);
}

function pbrMaterial(name: string, tint: Rgb, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({
    map: loadTexture(`${name}/diff.jpg`, true),
    normalMap: loadTexture(`${name}/normal.jpg`, false),
    roughnessMap: loadTexture(`${name}/rough.jpg`, false),
    color: linear(tint),
    roughness: 1,
    ...extra,
  });
}

const NOISE_GLSL = /* glsl */ `
float envHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float envNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(envHash(i), envHash(i + vec2(1.0, 0.0)), u.x),
             mix(envHash(i + vec2(0.0, 1.0)), envHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float envFbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int k = 0; k < 4; k++) { v += a * envNoise(p); p *= 2.03; a *= 0.5; }
  return v;
}
float envSnow = 0.0;
float envWetness = 0.0;
`;

/**
 * Breaks up visible tiling (second sample at another scale + low-frequency brightness
 * variation) and optionally blends in snow patches or a wet film with puddles.
 */
function enhanceTiling(
  material: THREE.MeshStandardMaterial,
  options: { macro: number; snow?: number; snowColor?: THREE.Color; wet?: boolean },
) {
  const snow = options.snow ?? 0;
  const wet = options.wet ?? false;
  const snowMap = loadTexture("snow_02/diff.jpg", true);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.envSnowMap = { value: snowMap };
    shader.uniforms.envSnowAmount = { value: snow };
    shader.uniforms.envSnowColor = { value: options.snowColor ?? new THREE.Color(1, 1, 1) };
    shader.uniforms.envMacro = { value: options.macro };
    shader.uniforms.envWet = { value: wet ? 1 : 0 };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform sampler2D envSnowMap;
uniform float envSnowAmount;
uniform vec3 envSnowColor;
uniform float envMacro;
uniform float envWet;
${NOISE_GLSL}`,
      )
      .replace(
        "#include <map_fragment>",
        `#ifdef USE_MAP
  vec4 envA = texture2D(map, vMapUv);
  vec4 envB = texture2D(map, vMapUv * 0.173 + vec2(0.37, 0.71));
  vec4 sampledDiffuseColor = mix(envA, envB, 0.4);
  sampledDiffuseColor.rgb *= mix(1.0 - envMacro, 1.0 + envMacro * 0.6, envFbm(vMapUv * 0.05));
  if (envSnowAmount > 0.0) {
    float envMask = envFbm(vMapUv * 0.11 + 7.3) + (envA.r - 0.5) * 0.35;
    envSnow = smoothstep(1.0 - envSnowAmount - 0.05, 1.0 - envSnowAmount + 0.05, envMask);
    vec3 envSnowTex = texture2D(envSnowMap, vMapUv * 0.6).rgb * envSnowColor;
    sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, envSnowTex, envSnow);
  }
  if (envWet > 0.0) {
    // Water fills the pores: the whole surface darkens (as in the wet reference photo) and
    // goes semi-gloss; standing water in low spots is near-mirror.
    float puddle = smoothstep(0.56, 0.64, envFbm(vMapUv * 0.32 + 1.7));
    envWetness = puddle;
    sampledDiffuseColor.rgb *= mix(0.42, 0.3, puddle);
  }
  diffuseColor *= sampledDiffuseColor;
#endif`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
  roughnessFactor = mix(roughnessFactor, 0.7, envSnow);
  if (envWet > 0.0) roughnessFactor = mix(min(roughnessFactor, 0.32), 0.04, envWetness);`,
      );
  };
  material.customProgramCacheKey = () => `env-tiling-${snow > 0 ? "snow" : "plain"}-${wet ? "wet" : "dry"}`;
  return material;
}

// ---------------------------------------------------------------------------
// Surface materials used by the painter

export type Surfaces = {
  road: THREE.MeshStandardMaterial;
  island: THREE.Material;
  concrete: THREE.Material;
  /** Paving slabs for sidewalks. */
  sidewalk: THREE.Material;
  /** Gravel for unpaved verges (motorway Bankett, rural shoulders). */
  verge: THREE.Material;
  metal: THREE.Material;
  paintWhite: THREE.Material;
  paintYellow: THREE.Material;
  ground: THREE.Material;
};

export function createSurfaces(pack: EnvPack): Surfaces {
  const groundTint = linear(pack.ground.tint);
  // The material colour multiplies the snow too, so divide it back out.
  const snowColor = linear(pack.ground.snowTint);
  snowColor.r /= groundTint.r;
  snowColor.g /= groundTint.g;
  snowColor.b /= groundTint.b;

  const paint = (color: number) =>
    new THREE.MeshStandardMaterial({
      color,
      roughness: pack.wet ? 0.18 : 0.55,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
  const grass = () =>
    enhanceTiling(pbrMaterial(pack.ground.texture, pack.ground.tint), {
      macro: 0.22,
      snow: pack.ground.snow,
      snowColor,
    });

  return {
    road: enhanceTiling(
      pbrMaterial("asphalt_02", pack.asphaltTint, {
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
      { macro: 0.12, wet: pack.wet },
    ),
    island: grass(),
    concrete: pbrMaterial("brushed_concrete", times(CONCRETE_BASE, pack.concreteTint)),
    sidewalk: pbrMaterial("concrete_pavement", times(SIDEWALK_BASE, pack.concreteTint)),
    verge: enhanceTiling(pbrMaterial("gravel_ground_01", times(VERGE_BASE, pack.concreteTint)), { macro: 0.15 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.85, roughness: 0.38 }),
    paintWhite: paint(0xe9e9e4),
    paintYellow: paint(0xe0b532),
    ground: grass(),
  };
}

/**
 * Gives every mesh flagged with `userData.uvTile` world-space UVs (box projection), so
 * textures keep a constant real-world scale and line up across neighbouring pieces.
 */
export function applyWorldUVs(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const position = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    const tile = mesh.userData?.uvTile as number | undefined;
    if (!mesh.isMesh || !tile) return;
    const geometry = mesh.geometry;
    const positions = geometry.getAttribute("position");
    const normals = geometry.getAttribute("normal");
    normalMatrix.getNormalMatrix(mesh.matrixWorld);
    const uv = new Float32Array(positions.count * 2);
    for (let i = 0; i < positions.count; i += 1) {
      position.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
      if (normals) normal.fromBufferAttribute(normals, i).applyMatrix3(normalMatrix).normalize();
      else normal.set(0, 1, 0);
      const ax = Math.abs(normal.x);
      const ay = Math.abs(normal.y);
      const az = Math.abs(normal.z);
      let u: number;
      let v: number;
      if (ay >= ax && ay >= az) {
        u = position.x;
        v = -position.z;
      } else if (ax >= az) {
        u = position.z;
        v = position.y;
      } else {
        u = position.x;
        v = position.y;
      }
      uv[i * 2] = u / tile;
      uv[i * 2 + 1] = v / tile;
    }
    geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  });
}

// ---------------------------------------------------------------------------
// Sky

export type Sky = {
  backdrop: THREE.Texture;
  lighting: THREE.DataTexture;
  /** Linear colour of the sky just above the horizon, for fog that blends into it. */
  horizon: THREE.Color;
  /** Unit vector toward the brightest point of the HDRI. */
  sunDirection: THREE.Vector3;
};

const skyCache = new Map<string, Promise<Sky>>();

function horizonColor(image: HTMLImageElement) {
  const width = 128;
  const height = 64;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return new THREE.Color(0.6, 0.65, 0.72);
  context.drawImage(image, 0, 0, width, height);
  const data = context.getImageData(0, height / 2 - 3, width, 2).data;
  let r = 0;
  let g = 0;
  let b = 0;
  const count = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  return new THREE.Color().setRGB(r / count / 255, g / count / 255, b / count / 255, THREE.SRGBColorSpace);
}

function brightestDirection(texture: THREE.DataTexture) {
  const { data, width, height } = texture.image as { data: Float32Array; width: number; height: number };
  let best = -1;
  let bestIndex = 0;
  for (let y = 0; y < height / 2; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const luminance = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
      if (luminance > best) {
        best = luminance;
        bestIndex = y * width + x;
      }
    }
  }
  const u = ((bestIndex % width) + 0.5) / width;
  const v = 1 - (Math.floor(bestIndex / width) + 0.5) / height;
  const phi = (u - 0.5) * Math.PI * 2;
  const elevation = Math.max((v - 0.5) * Math.PI, THREE.MathUtils.degToRad(9));
  return new THREE.Vector3(
    Math.cos(elevation) * Math.cos(phi),
    Math.sin(elevation),
    Math.cos(elevation) * Math.sin(phi),
  ).normalize();
}

/** Frees a sky's GPU textures (about 55 MB) once nothing shows it any more. */
export function releaseSky(name: string) {
  const promise = skyCache.get(name);
  if (!promise) return;
  skyCache.delete(name);
  void promise
    .then((sky) => {
      sky.backdrop.dispose();
      sky.lighting.dispose();
    })
    .catch(() => {});
}

export function loadSky(name: string): Promise<Sky> {
  let promise = skyCache.get(name);
  if (!promise) {
    promise = (async () => {
      const [lighting, backdrop] = await Promise.all([
        new HDRLoader().setDataType(THREE.FloatType).loadAsync(`${BASE}sky/${name}.hdr`),
        textureLoader.loadAsync(`${BASE}sky/${name}.jpg`),
      ]);
      lighting.mapping = THREE.EquirectangularReflectionMapping;
      backdrop.mapping = THREE.EquirectangularReflectionMapping;
      backdrop.colorSpace = THREE.SRGBColorSpace;
      return {
        lighting,
        backdrop,
        horizon: horizonColor(backdrop.image as HTMLImageElement),
        sunDirection: brightestDirection(lighting),
      };
    })();
    promise.catch(() => skyCache.delete(name));
    skyCache.set(name, promise);
  }
  return promise;
}

// ---------------------------------------------------------------------------
// Terrain and trees around the site

export type Obstacle = { ax: number; az: number; bx: number; bz: number; halfWidth: number };

export type Site = { width: number; depth: number };

function segmentDistance(px: number, pz: number, o: Obstacle) {
  const dx = o.bx - o.ax;
  const dz = o.bz - o.az;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq > 0 ? Math.min(1, Math.max(0, ((px - o.ax) * dx + (pz - o.az) * dz) / lengthSq)) : 0;
  return Math.hypot(px - (o.ax + dx * t), pz - (o.az + dz * t)) - o.halfWidth;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function valueNoise(x: number, z: number) {
  const hash = (i: number, j: number) => {
    const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz) + (hash(ix + 1, iz) - hash(ix, iz)) * ux;
  const b = hash(ix, iz + 1) + (hash(ix + 1, iz + 1) - hash(ix, iz + 1)) * ux;
  return a + (b - a) * uz;
}

function fbm(x: number, z: number) {
  let value = 0;
  let amplitude = 0.5;
  for (let k = 0; k < 4; k += 1) {
    value += amplitude * valueNoise(x, z);
    x *= 2.03;
    z *= 2.03;
    amplitude *= 0.5;
  }
  return value;
}

const TERRAIN_SIZE = 1400;

export function buildSurroundings(group: THREE.Group, pack: EnvPack, surfaces: Surfaces, site: Site, obstacles: Obstacle[]) {
  const clearance = (x: number, z: number) => {
    const siteDx = Math.abs(x) - site.width / 2;
    const siteDz = Math.abs(z) - site.depth / 2;
    let distance = Math.max(siteDx, siteDz);
    for (const obstacle of obstacles) distance = Math.min(distance, segmentDistance(x, z, obstacle));
    return distance;
  };
  const heightAt = (x: number, z: number) => {
    const ramp = THREE.MathUtils.smoothstep(clearance(x, z), 12, 110);
    return ramp * (fbm(x * 0.007 + 11, z * 0.007 - 4) * 26 - 3) - 0.02;
  };

  const segments = 180;
  const terrainGeometry = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, segments, segments);
  terrainGeometry.rotateX(-Math.PI / 2);
  const positions = terrainGeometry.getAttribute("position");
  for (let i = 0; i < positions.count; i += 1) {
    positions.setY(i, heightAt(positions.getX(i), positions.getZ(i)));
  }
  terrainGeometry.computeVertexNormals();
  const terrain = new THREE.Mesh(terrainGeometry, surfaces.ground);
  terrain.receiveShadow = true;
  terrain.userData.uvTile = 5;
  group.add(terrain);

  // Trees: a mix of broadleaf (bare in winter) and conifers, kept off the roads.
  const random = mulberry32(7919 + Math.round(site.width * 13 + site.depth));
  const broadleaf: THREE.Matrix4[] = [];
  const conifer: THREE.Matrix4[] = [];
  const trunks: THREE.Matrix4[] = [];
  const dummy = new THREE.Object3D();
  for (let attempt = 0; attempt < 6000 && broadleaf.length + conifer.length < 520 * pack.treeDensity; attempt += 1) {
    const x = (random() - 0.5) * TERRAIN_SIZE * 0.8;
    const z = (random() - 0.5) * TERRAIN_SIZE * 0.8;
    const room = clearance(x, z);
    if (room < 7) continue;
    // Denser in clumps, sparse in open fields.
    if (fbm(x * 0.012, z * 0.012) < 0.42 + random() * 0.2) continue;
    const y = heightAt(x, z);
    const scale = 0.75 + random() * 0.7;
    const isConifer = random() < (pack.trees === "bare" ? 0.3 : 0.25);

    dummy.position.set(x, y + 1.6 * scale, z);
    dummy.rotation.set(0, random() * Math.PI * 2, 0);
    dummy.scale.set(scale, scale, scale);
    dummy.updateMatrix();
    trunks.push(dummy.matrix.clone());

    if (isConifer) {
      dummy.position.set(x, y + 5.2 * scale, z);
      dummy.scale.set(scale, scale * (0.9 + random() * 0.4), scale);
      dummy.updateMatrix();
      conifer.push(dummy.matrix.clone());
    } else {
      dummy.position.set(x, y + 5.0 * scale, z);
      dummy.scale.set(scale * (0.9 + random() * 0.3), scale * (0.8 + random() * 0.3), scale * (0.9 + random() * 0.3));
      dummy.updateMatrix();
      broadleaf.push(dummy.matrix.clone());
    }
  }

  const instanced = (geometry: THREE.BufferGeometry, material: THREE.Material, matrices: THREE.Matrix4[]) => {
    if (matrices.length === 0) return;
    const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
    matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  };

  const bare = pack.trees === "bare";
  instanced(
    new THREE.CylinderGeometry(0.18, 0.32, 3.2, 6),
    new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 1 }),
    trunks,
  );
  instanced(
    new THREE.IcosahedronGeometry(2.6, 1),
    new THREE.MeshStandardMaterial({
      color: bare ? 0x6b5f57 : 0x45632e,
      roughness: 1,
      flatShading: true,
      transparent: bare,
      opacity: bare ? 0.78 : 1,
      depthWrite: !bare,
    }),
    broadleaf,
  );
  instanced(
    new THREE.ConeGeometry(2.1, 7.5, 7),
    new THREE.MeshStandardMaterial({ color: bare ? 0x2f3d2c : 0x2d4a26, roughness: 1, flatShading: true }),
    conifer,
  );
}
