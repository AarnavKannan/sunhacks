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
};

export const BUILTIN_SCENES: SceneInfo[] = [
  {
    id: "roundabout",
    title: "Roundabout collision",
    location: "Site reconstruction",
    detail: "Preview · 4 vehicles",
    duration: 25,
    impactTime: 12,
    startTime: 4,
    kind: "proxy",
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
    startTime: 3,
    kind: "proxy",
    vehicles: [
      { id: "silver", label: "Silver sedan", color: "#d5dbe3" },
      { id: "blue", label: "Blue SUV", color: "#1d4e89" },
    ],
  },
];
