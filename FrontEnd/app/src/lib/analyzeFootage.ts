import type { SceneEnvironment } from "@/scene/environment";

/*
 * Works out what the scene around an incident looks like from the footage itself:
 * sky and light (clear, overcast, dusk, night), snow cover, ground type (green,
 * dormant, arid) and whether the road is wet.
 * It samples a handful of frames, shrinks them, and classifies pixels by colour.
 * Footage is often a grid of several cameras, so it relies on colour statistics
 * rather than on finding a single horizon.
 */

const SAMPLE_FRAMES = 10;
const WIDTH = 192;
const HEIGHT = 120;

export type FootageStats = {
  brightness: number;
  /** Share of the upper quarter that is blue sky. */
  blueSky: number;
  /** Share of the upper quarter with sunset/sunrise tones. */
  warmSky: number;
  /** Share of the lower part that is snow: bright, neutral-to-cool, unsaturated, and part of a
   * large uniform patch (so white cars and lane paint don't count). */
  snow: number;
  /** Share of the lower part that is green vegetation. */
  green: number;
  /** Hasler–Süsstrunk colourfulness of the whole frame. Overcast light flattens it. */
  colorfulness: number;
  /** Share of the lower part that is lit lamps (tail/brake lights, signals): saturated, bright red-orange. */
  lights: number;
  /** Share of the lower part that is sand/dust/dry soil (warm beige, moderately saturated). */
  tan: number;
  /** Mean brightness of the lower part (mostly road). */
  groundBrightness: number;
  /** Mean strength of sharp light-to-dark edges in the lower part. Direct sun casts hard shadows. */
  edges: number;
};

export type FootageAnalysis = { environment: SceneEnvironment; stats: FootageStats };

/*
 * Thresholds are calibrated on a labelled reference set (listed under "Footage and data" in CREDITS.md):
 * r05_s03 overcast snowy highway, a night city jam, a hazy daytime jam, a sunny top-down
 * street, a sunny aerial junction, a wet overcast queue, a sunny arid drone shot, and
 * clear/dusk/winter renders of this viewer. It is a heuristic: expect misses on footage
 * unlike these, and treat it as a stand-in for a learned classifier.
 */
export function classifyFootage(stats: FootageStats): SceneEnvironment {
  let sky: SceneEnvironment["sky"] = "overcast";
  if (stats.brightness < 0.16 || (stats.lights > 0.03 && stats.brightness < 0.4)) {
    // Dark frame, or a dim frame full of lit lamps.
    sky = "night";
  } else if (stats.warmSky > 0.12 && stats.brightness < 0.45 && stats.tan < 0.25) {
    // Warm upper frame that isn't just sand-coloured rooftops.
    sky = "dusk";
  } else if (
    stats.blueSky > 0.12 ||
    stats.edges > 0.028 ||
    (stats.colorfulness > 0.11 && stats.green > 0.2) ||
    (stats.tan > 0.25 && stats.brightness > 0.4)
  ) {
    // Sun shows as blue sky, hard shadow edges, vivid sunlit vegetation, or bright dry ground.
    sky = "clear";
  }

  const snow = Math.round(Math.min(0.6, Math.max(0, (stats.snow - 0.035) * 22)) * 100) / 100;
  const vegetation = stats.tan > 0.25 ? "arid" : stats.green > 0.06 ? "green" : "dormant";
  // Under grey skies a wet road reads much darker than a dry one.
  const road = sky === "overcast" && stats.groundBrightness < 0.35 ? "wet" : "dry";
  return { sky, snow, vegetation, road };
}

type Totals = {
  brightness: number;
  blueSky: number;
  warmSky: number;
  snow: number;
  green: number;
  lights: number;
  tan: number;
  ground: number;
  edges: number;
  top: number;
  bottom: number;
  pixels: number;
  rg: number;
  yb: number;
  rg2: number;
  yb2: number;
};

function snowy(r: number, _g: number, b: number, saturation: number, luminance: number) {
  return luminance > 0.6 && saturation < 0.13 && b >= r - 0.01;
}

const SNOW_NEIGHBOURS = 7;
const snowMask = new Uint8Array(WIDTH * HEIGHT);
const luminanceRow = new Float32Array(WIDTH);

function accumulate(data: Uint8ClampedArray, totals: Totals) {
  snowMask.fill(0);
  for (let y = 0; y < HEIGHT; y += 1) {
    const inTop = y < HEIGHT * 0.25;
    const inBottom = y >= HEIGHT * 0.35;
    for (let x = 0; x < WIDTH; x += 1) {
      const i = (y * WIDTH + x) * 4;
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const saturation = max > 0 ? (max - min) / max : 0;
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      totals.brightness += luminance;
      totals.pixels += 1;
      const rg = r - g;
      const yb = 0.5 * (r + g) - b;
      totals.rg += rg;
      totals.yb += yb;
      totals.rg2 += rg * rg;
      totals.yb2 += yb * yb;

      if (inTop) {
        totals.top += 1;
        // Saturated, clearly blue (not the cyan of overlay boxes, not grey-blue overcast).
        if (b > r * 1.25 && b > g * 1.05 && saturation > 0.25 && luminance > 0.3) totals.blueSky += 1;
        if (r > b * 1.2 && r >= g && saturation > 0.2 && luminance > 0.25) totals.warmSky += 1;
      }
      if (inBottom) {
        totals.bottom += 1;
        if (g > r * 1.05 && g > b * 1.08 && saturation > 0.18 && luminance > 0.1) totals.green += 1;
        if (r > 0.55 && r > g * 1.6 && saturation > 0.55) totals.lights += 1;
        if (r > g && g > b && r - b > 0.08 && saturation > 0.12 && saturation < 0.45 && luminance > 0.45) totals.tan += 1;
        totals.ground += luminance;
        if (snowy(r, g, b, saturation, luminance)) snowMask[y * WIDTH + x] = 1;
        luminanceRow[x] = luminance;
        if (x >= 2) totals.edges += Math.max(0, Math.abs(luminance - luminanceRow[x - 2]) - 0.12);
      }
    }
  }
  // Count a snow pixel only when most of its 3x3 neighbourhood is snow too, so small white
  // things (cars, lane paint) drop out but speckled snow fields survive.
  for (let y = Math.ceil(HEIGHT * 0.35) + 1; y < HEIGHT - 1; y += 1) {
    for (let x = 1; x < WIDTH - 1; x += 1) {
      if (!snowMask[y * WIDTH + x]) continue;
      let neighbours = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) neighbours += snowMask[(y + dy) * WIDTH + x + dx];
      }
      if (neighbours >= SNOW_NEIGHBOURS) totals.snow += 1;
    }
  }
}

function colorfulness(totals: Totals) {
  const n = totals.pixels;
  const meanRg = totals.rg / n;
  const meanYb = totals.yb / n;
  const sdRg = Math.sqrt(Math.max(0, totals.rg2 / n - meanRg * meanRg));
  const sdYb = Math.sqrt(Math.max(0, totals.yb2 / n - meanYb * meanYb));
  return Math.hypot(sdRg, sdYb) + 0.3 * Math.hypot(meanRg, meanYb);
}

function once(target: EventTarget, event: string) {
  return new Promise<void>((resolve, reject) => {
    const done = () => {
      target.removeEventListener(event, done);
      target.removeEventListener("error", fail);
      resolve();
    };
    const fail = () => {
      target.removeEventListener(event, done);
      target.removeEventListener("error", fail);
      reject(new Error("The video could not be decoded."));
    };
    target.addEventListener(event, done);
    target.addEventListener("error", fail);
  });
}

export async function analyzeFootage(source: Blob | string): Promise<FootageAnalysis> {
  const url = typeof source === "string" ? source : URL.createObjectURL(source);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  try {
    const loaded = once(video, "loadeddata");
    video.src = url;
    await loaded;

    const canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas is unavailable.");

    const totals: Totals = {
      brightness: 0,
      blueSky: 0,
      warmSky: 0,
      snow: 0,
      green: 0,
      lights: 0,
      tan: 0,
      ground: 0,
      edges: 0,
      top: 0,
      bottom: 0,
      pixels: 0,
      rg: 0,
      yb: 0,
      rg2: 0,
      yb2: 0,
    };
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const frames = duration > 0 ? SAMPLE_FRAMES : 1;
    for (let k = 0; k < frames; k += 1) {
      if (duration > 0) {
        const seeked = once(video, "seeked");
        video.currentTime = ((k + 0.5) / frames) * duration;
        await seeked;
      }
      context.drawImage(video, 0, 0, WIDTH, HEIGHT);
      accumulate(context.getImageData(0, 0, WIDTH, HEIGHT).data, totals);
    }

    const stats: FootageStats = {
      brightness: totals.brightness / totals.pixels,
      blueSky: totals.blueSky / totals.top,
      warmSky: totals.warmSky / totals.top,
      snow: totals.snow / totals.bottom,
      green: totals.green / totals.bottom,
      colorfulness: colorfulness(totals),
      lights: totals.lights / totals.bottom,
      tan: totals.tan / totals.bottom,
      groundBrightness: totals.ground / totals.bottom,
      edges: totals.edges / totals.bottom,
    };
    return { environment: classifyFootage(stats), stats };
  } finally {
    video.removeAttribute("src");
    video.load();
    if (typeof source !== "string") URL.revokeObjectURL(url);
  }
}
