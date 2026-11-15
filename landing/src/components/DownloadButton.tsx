import { ArrowUpRight, Apple, Download, Monitor, Terminal } from "lucide-react";
import { platformLabel, useDownloadTarget, type Platform } from "@/lib/download";

const platformIcon: Record<Platform, typeof Apple> = {
  mac: Apple,
  win: Monitor,
  linux: Terminal,
  other: Download,
};

export function DownloadButton({
  className = "",
  compact = false,
  label,
}: {
  className?: string;
  compact?: boolean;
  label?: string;
}) {
  const target = useDownloadTarget();
  const Icon = platformIcon[target.platform];
  const text = label ?? (target.platform === "other" ? "Download CRASHVZN" : `Download for ${platformLabel[target.platform]}`);

  return (
    <a
      href={target.url}
      target="_blank"
      rel="noreferrer"
      className={`btn btn-primary ${compact ? "btn-compact" : ""} ${className}`}
      aria-label={`${text} (opens download)`}
    >
      <Icon size={compact ? 15 : 17} strokeWidth={2} />
      <span>{text}</span>
      <ArrowUpRight size={compact ? 14 : 16} className="btn-trailing-icon" />
    </a>
  );
}

export function DownloadMeta() {
  const target = useDownloadTarget();
  return (
    <span className="download-meta">
      v{target.version} · {target.direct ? "installer" : "source preview"} · free during beta
    </span>
  );
}
