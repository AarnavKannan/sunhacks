import { DownloadButton, DownloadMeta } from "@/components/DownloadButton";
import { InstallCommands } from "@/components/InstallCommands";
import { Reveal } from "@/components/Motion";
import { ArrowUpRight, Check, Github, HardDrive, LockKeyhole, Monitor, Terminal } from "lucide-react";
import { useDownloadTarget } from "@/lib/download";

const requirements = [
  { icon: Monitor, label: "Desktop", value: "macOS 13+ · Windows 10/11 · Linux x64" },
  { icon: HardDrive, label: "Graphics", value: "WebGL2-capable GPU · 8 GB RAM" },
  { icon: LockKeyhole, label: "Privacy", value: "Local files, local export, no account" },
  { icon: Terminal, label: "Assistant", value: "Optional Claude Code, Codex, or Gemini CLI" },
];

export function DownloadSection() {
  const target = useDownloadTarget();

  return (
    <section className="download-section" id="download">
      <div className="download-backdrop" aria-hidden="true">
        <div className="download-glow" />
        <div className="download-grid" />
      </div>

      <div className="container-x">
        <Reveal className="download-card">
          <div className="download-copy">
            <div className="section-kicker">
              <span className="section-index">03</span>
              <span>GET THE APP</span>
              <span className="section-rule" />
            </div>
            <h2 className="neon-title">
              Bring the scene
              <span className="neon-accent"> into focus.</span>
            </h2>
            <p>
              One download for every desktop. When a GitHub release ships an installer, this button
              picks it up automatically.
            </p>

            <div className="download-actions">
              <DownloadButton />
              <a
                className="btn btn-outline"
                href="https://github.com/AarnavKannan/sunhacks"
                target="_blank"
                rel="noreferrer"
              >
                <Github size={16} />
                Build from source
                <ArrowUpRight size={14} className="btn-trailing-icon" />
              </a>
            </div>

            <div className="download-notes">
              <DownloadMeta />
              <span className="download-note-dot" />
              <span>
                {target.direct ? "Release asset available" : "No installer attached yet — use the CLI below or watch Releases"}
              </span>
            </div>

            <div className="download-install">
              <InstallCommands />
            </div>

            <div className="download-checks">
              <span><Check size={13} /> No account required</span>
              <span><Check size={13} /> Free during beta</span>
              <span><Check size={13} /> Runs locally</span>
            </div>
          </div>

          <aside className="download-panel">
            <div className="download-panel-head">
              <span className="download-panel-badge">LATEST BUILD</span>
              <span className="download-panel-version">v{target.version}</span>
            </div>
            <div className="download-panel-name">
              <span className="download-panel-mark">CV</span>
              <div>
                <strong>CRASHVZN</strong>
                <span>Reconstruction workspace</span>
              </div>
            </div>

            <div className="download-requirements">
              {requirements.map(({ icon: Icon, label, value }) => (
                <div className="download-requirement" key={label}>
                  <span className="download-requirement-icon"><Icon size={14} /></span>
                  <div>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                </div>
              ))}
            </div>

            <a
              className="download-releases-link"
              href="https://github.com/AarnavKannan/sunhacks/releases"
              target="_blank"
              rel="noreferrer"
            >
              View all releases
              <ArrowUpRight size={14} />
            </a>
            <p className="download-panel-note">
              Publishing a build? Attach a <code>.dmg</code>, <code>.exe</code>, or{" "}
              <code>.AppImage</code> to the latest release and this page picks it up automatically.
            </p>
          </aside>
        </Reveal>
      </div>
    </section>
  );
}
