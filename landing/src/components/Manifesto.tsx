import type { CSSProperties } from "react";

const facts = [
  { value: "4D", label: "scene, not a slide deck", detail: "3D space plus a scrubbable timeline." },
  { value: "1", label: "source of truth", detail: "Every answer resolves back to a track sample." },
  { value: "0", label: "uploads by default", detail: "Footage and reconstructions stay on your machine." },
];

export function Manifesto() {
  return (
    <section className="section-pad manifesto" id="product">
      <div className="container-x">
        <div className="section-kicker" data-reveal>
          <span className="section-index">01</span>
          <span>THE RECONSTRUCTION LAYER</span>
          <span className="section-rule" />
        </div>

        <div className="manifesto-grid">
          <div className="manifesto-copy" data-reveal>
            <h2>
              Footage shows you what happened.
              <span className="serif"> CRASHVZN shows you how.</span>
            </h2>
          </div>
          <div className="manifesto-side" data-reveal style={{ "--delay": "120ms" } as CSSProperties}>
            <p>
              A dashcam hands you a flattened story — four small panes and a timestamp. CRASHVZN
              lifts that footage into a navigable reconstruction where the geometry and the motion
              are separate, queryable things.
            </p>
            <p>
              Orbit the scene. Follow a vehicle’s velocity curve. Ask what happened three seconds
              before impact. Every answer points back to a measured sample, not a guess dressed up
              as a conclusion.
            </p>
            <div className="manifesto-tag-row">
              <span>Reconstruction</span>
              <span>Kinematics</span>
              <span>Evidence</span>
            </div>
          </div>
        </div>

        <div className="manifesto-facts" data-reveal>
          {facts.map((fact) => (
            <article className="fact-card" key={fact.label}>
              <span className="fact-value">{fact.value}</span>
              <div>
                <strong>{fact.label}</strong>
                <span>{fact.detail}</span>
              </div>
            </article>
          ))}
          <article className="fact-card fact-card-accent">
            <span className="fact-icon" aria-hidden="true">↳</span>
            <div>
              <strong>Start with the incident you already have.</strong>
              <span>Load a scene package and start asking questions in under a minute.</span>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
