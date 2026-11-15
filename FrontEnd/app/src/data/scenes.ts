import type { SceneEnvironment } from "@/scene/environment";

export type VehicleInfo = {
  id: string;
  label: string;
  color: string;
};

export type SceneInfo = {
  id: string;
  title: string;
  location: string;
  detail: string;
  duration: number;
  impactTime: number | null;
  startTime: number;
  kind: "proxy" | "splat";
  vehicles: VehicleInfo[];
  /** Sky, ground cover and snow, as detected from the scene's source footage. */
  environment: SceneEnvironment;
  /** The footage the environment was read from, when known. */
  environmentSource?: string;
};

const R05_ENVIRONMENT: SceneEnvironment = { sky: "overcast", snow: 0.44, vegetation: "dormant", road: "dry" };

export const BUILTIN_SCENES: SceneInfo[] = [
  {
    id: "roundabout",
    title: "Roundabout collision",
    location: "Site reconstruction",
    detail: "Preview · 4 vehicles",
    duration: 25,
    impactTime: 12,
    startTime: 10.86,
    kind: "proxy",
    // No source footage bundled for this preview yet; analysed uploads will replace this.
    environment: { sky: "clear", snow: 0, vegetation: "green", road: "dry" },
    vehicles: [
      { id: "white", label: "White SUV", color: "#f4f4f4" },
      { id: "red", label: "Red sedan", color: "#d02424" },
      { id: "orange", label: "Orange hatchback", color: "#e07a14" },
      { id: "green", label: "Green sedan", color: "#2f9e4f" },
    ],
  },
  {
    id: "apache",
    title: "Apache Blvd eastbound",
    location: "Apache Blvd, Tempe, AZ",
    detail: "Preview · 2 vehicles",
    duration: 16,
    impactTime: 8,
    startTime: 6.5,
    kind: "proxy",
    // No source footage bundled for this preview yet; analysed uploads will replace this.
    environment: { sky: "clear", snow: 0, vegetation: "arid", road: "dry" },
    vehicles: [
      { id: "silver", label: "Silver sedan", color: "#d5dbe3" },
      { id: "blue", label: "Blue SUV", color: "#1d4e89" },
    ],
  },
  {
    id: "highway",
    title: "Divided highway traffic",
    location: "r05 · camera set s03",
    detail: "Preview · 10 vehicles",
    duration: 30,
    impactTime: null,
    startTime: 0,
    kind: "proxy",
    // Output of analyzeFootage() on r05_s03_labels_visualization.mp4.
    environment: R05_ENVIRONMENT,
    environmentSource: "r05_s03_labels_visualization.mp4",
    vehicles: [
      { id: "e-truck", label: "White truck", color: "#e9ecef" },
      { id: "e-van", label: "White van", color: "#f2f2f0" },
      { id: "e-silver", label: "Silver sedan", color: "#c4c9cf" },
      { id: "e-graphite", label: "Graphite sedan", color: "#4a4f57" },
      { id: "e-black", label: "Black sedan", color: "#1c1e22" },
      { id: "e-red", label: "Red sedan", color: "#b3202a" },
      { id: "w-white", label: "White sedan", color: "#eceff1" },
      { id: "w-blue", label: "Blue sedan", color: "#24508f" },
      { id: "w-truck", label: "Red-cab truck", color: "#b4372b" },
      { id: "w-van", label: "Beige van", color: "#d8d4c8" },
    ],
  },
];
