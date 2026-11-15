import { AppPreview } from "@/components/AppPreview";
import { DownloadButton, DownloadMeta } from "@/components/DownloadButton";
import { ArrowDown, CirclePlay } from "lucide-react";

const stats = [
  { value: "155", label: "vehicles tracked in one pass" },
  { value: "5,355", label: "per-frame kinematics samples" },
  { value: "21.76 s", label: "impact timestamp, T+0" },
  { value: "12.5 fps", label: "measured from burned-in tracks" },
];

export function Hero() {
  return (
    <section className="hero" id="top">
      <div className="hero-backdrop" aria-hidden="true">
        <div className="hero-glow" />
        <div className="hero-grid" />
        <div className="hero-reticle hero-reticle-a" />
        <div className="hero-reticle hero-reticle-b" />
        <div className="hero-hazard" />
      </div>

      <div className="container-x hero-inner">
        <div className="hero-eyebrow">
          <span className="hero-eyebrow-dot" />
          <span>SUNHACKS 2026</span>
          <span className="hero-eyebrow-sep" />
          <span className="hero-eyebrow-muted">Forensic reconstruction, reimagined</span>
        </div>

        <h1 className="hero-title">
          <span>The crash is over.</span>
          <span className="hero-title-accent">The scene isn’t.</span>
        </h1>

        <p className="hero-sub">
          CRASHVZN turns traffic-incident footage into an explorable 4D scene — with every vehicle’s
          path, speed, and heading measured frame by frame.
        </p>

        <div className="hero-actions">
          <DownloadButton />
          <a href="#evidence" className="btn btn-secondary">
            <CirclePlay size={17} />
            <span>Watch the evidence</span>
          </a>
        </div>

        <div className="hero-note">
          <DownloadMeta />
          <span className="hero-note-dot" />
          <span>macOS · Windows · Linux</span>
          <span className="hero-note-dot" />
          <span>No account. No upload.</span>
        </div>

        <div className="hero-preview-wrap">
          <div className="hero-preview-glow" aria-hidden="true" />
          <AppPreview />
          <div className="hero-preview-caption">
            <span>REFERENCE INCIDENT · FREEWAY, CARRIAGEWAY B</span>
            <span className="hero-preview-caption-right">Reconstructed from <code>demo.mp4</code></span>
          </div>
        </div>

        <div className="hero-stats">
          {stats.map((stat) => (
            <div key={stat.label} className="hero-stat">
              <strong>{stat.value}</strong>
              <span>{stat.label}</span>
            </div>
          ))}
        </div>

        <a className="hero-scroll" href="#product">
          <ArrowDown size={14} />
          <span>Explore the reconstruction</span>
        </a>
      </div>
    </section>
  );
}
