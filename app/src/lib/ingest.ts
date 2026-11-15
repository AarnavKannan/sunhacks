import { analyzeFootage } from "@/lib/analyzeFootage";
import { isSplatFile } from "@/lib/splatFiles";
import { useAppStore } from "@/store/useAppStore";

export async function ingestFiles(fileList: FileList | File[]) {
  const files = [...fileList];
  const videos: { id: string; name: string; size: number; file: File }[] = [];

  for (const file of files) {
    if (isSplatFile(file.name)) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      useAppStore.getState().addSplatScene({ fileName: file.name, bytes });
    } else {
      videos.push({ id: crypto.randomUUID(), name: file.name, size: file.size, file });
    }
  }

  if (videos.length > 0) {
    useAppStore.getState().addUploads(videos);
    useAppStore.getState().setPanelOpen(true);
    // Read the environment (sky, snow, vegetation) straight from each video.
    for (const video of videos) {
      analyzeFootage(video.file)
        .then((result) => useAppStore.getState().setUploadAnalysis(video.id, { state: "done", result }))
        .catch((error: unknown) =>
          useAppStore.getState().setUploadAnalysis(video.id, {
            state: "failed",
            error: error instanceof Error ? error.message : "Could not read the video.",
          }),
        );
    }
  }
}
