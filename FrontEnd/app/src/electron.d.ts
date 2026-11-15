export type StagedVideo = {
  fileName: string;
  sizeBytes: number;
  sha256: string;
};

export type StagedIncident = {
  incidentId: string;
  videos: StagedVideo[];
};

declare global {
  interface Window {
    reconstruct?: {
      isDesktop: boolean;
      stageVideos: (files: File[]) => Promise<StagedIncident>;
    };
  }
}

export {};
