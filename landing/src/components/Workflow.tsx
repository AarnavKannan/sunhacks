import { motion, Reveal, useReducedMotion } from "@/components/Motion";
import { useState } from "react";

const views = [
  { label: "Full workspace", scale: 1, x: "0%", y: "0%" },
  { label: "Camera controls", scale: 2.5, x: "75%", y: "75%" },
  { label: "Scene assistant", scale: 2.5, x: "-75%", y: "-75%" },
];

const steps = [
  { title: "Start with the footage", copy: "Stage a camera recording or mosaic in a local workspace. Your source files stay on your machine." },
  { title: "Build the scene", copy: "Bring the background, fitted vehicles, and per-frame kinematics together in one reconstruction." },
  { title: "Explore every angle", copy: "Orbit the scene, scrub the timeline, and inspect vehicle paths with the source footage alongside." },
  { title: "Share what you see", copy: "Choose a viewpoint and export a video to explain the incident. Reconstruction estimates stay identified." },
];

export function Workflow() {
  const [view, setView] = useState(0);
  const reduce = useReducedMotion();

  return (
    <section className="section-pad workflow-section" id="workflow">
      <div className="container-x">
        <Reveal className="workflow-intro">
          <h2>Make sense of<br />the whole scene.</h2>
          <p>Go beyond a single camera angle. Follow the vehicles, revisit the timeline, and put each moment in context.</p>
        </Reveal>
        <Reveal className="workflow-media">
          <div className="workflow-image-viewport" id="workspace-preview">
            <motion.img
              src="/media/reconstruction-workspace.png"
              alt="CRASHVZN desktop workspace showing the A9 motorway reconstruction, camera controls, timeline, and scene assistant"
              loading="lazy"
              width={1706}
              height={1038}
              initial={false}
              animate={{ scale: views[view].scale, x: views[view].x, y: views[view].y }}
              transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 180, damping: 30 }}
            />
          </div>
          <div className="workflow-media-caption">
            <span>The CRASHVZN reconstruction workspace</span>
            <div className="workflow-focus" role="group" aria-label="Inspect the workspace">
              {views.map((item, index) => (
                <button key={item.label} type="button" aria-pressed={view === index} aria-controls="workspace-preview" onClick={() => setView(index)}>{item.label}</button>
              ))}
            </div>
          </div>
        </Reveal>
        <ol className="workflow-steps">
          {steps.map((step) => (
            <li key={step.title}><h3>{step.title}</h3><p>{step.copy}</p></li>
          ))}
        </ol>
      </div>
    </section>
  );
}
