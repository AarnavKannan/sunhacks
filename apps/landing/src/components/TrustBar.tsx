import { Cpu, Layers, LockKeyhole, Orbit, ScanLine, Waypoints } from "lucide-react";

const items = [
  { icon: Orbit, label: "OpenSplat" },
  { icon: Layers, label: "Spark" },
  { icon: Waypoints, label: "Three.js" },
  { icon: Cpu, label: "Electron" },
  { icon: ScanLine, label: "MCP" },
  { icon: LockKeyhole, label: "Local-first" },
];

export function TrustBar() {
  return (
    <div className="trust-bar" aria-label="Technologies and principles behind CRASHVZN">
      <div className="container-x trust-inner">
        <span className="trust-label">Built on the shoulders of</span>
        <div className="trust-items">
          {items.map(({ icon: Icon, label }) => (
            <span className="trust-item" key={label}>
              <Icon size={14} />
              {label}
            </span>
          ))}
        </div>
        <span className="trust-end">Open source underneath. Evidence-grade on top.</span>
      </div>
    </div>
  );
}

export function Marquee() {
  const content = (
    <>
      <span>4D Gaussian splats</span>
      <i />
      <span>Per-vehicle kinematics</span>
      <i />
      <span>Source-synced playback</span>
      <i />
      <span>Natural-language scene control</span>
      <i />
      <span>Measure &amp; annotate</span>
      <i />
      <span>Export the camera path</span>
      <i />
      <span>Local by default</span>
      <i />
    </>
  );

  return (
    <div className="marquee" aria-hidden="true">
      <div className="marquee-track">
        {content}
        {content}
      </div>
    </div>
  );
}
