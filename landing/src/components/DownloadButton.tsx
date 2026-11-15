import { ArrowUpRight, Download } from "lucide-react";
import { useDownloadTarget } from "@/lib/download";

export function DownloadButton({
  className = "",
  compact = false,
  label = "Download CRASHVZN",
}: {
  className?: string;
  compact?: boolean;
  label?: string;
}) {
  const target = useDownloadTarget();

  return (
    <a
      href={target.url}
      target="_blank"
      rel="noreferrer"
      className={`btn btn-primary ${compact ? "btn-compact" : ""} ${className}`}
      aria-label={`${label} (opens GitHub release)`}
    >
      <Download size={compact ? 15 : 17} strokeWidth={2} />
      <span>{label}</span>
      <ArrowUpRight size={compact ? 14 : 16} className="btn-trailing-icon" />
    </a>
  );
}

export function DownloadMeta() {
  const target = useDownloadTarget();
  return (
    <span className="download-meta">
      v{target.version} · {target.direct ? "latest release" : "GitHub releases"} · free during beta
    </span>
  );
}
