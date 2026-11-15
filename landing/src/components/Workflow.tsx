import { motion, Reveal, useReducedMotion } from "@/components/Motion";
import { chipItem, stagger } from "@/lib/motion";
import { Film, FolderSearch, MessagesSquare, Video } from "lucide-react";

const steps = [
  {
    number: "01",
    icon: Film,
    title: "Stage footage",
    copy: "Drop in a camera or mosaic. Hashed into a local workspace.",
  },
  {
    number: "02",
    icon: FolderSearch,
    title: "Build the scene",
    copy: "Background splat, vehicle fits, per-frame kinematics.",
  },
  {
    number: "03",
    icon: MessagesSquare,
    title: "Ask the moment",
    copy: "Orbit, scrub, and query measured answers through the assistant.",
  },
  {
    number: "04",
    icon: Video,
    title: "Export the view",
    copy: "Render the camera path as MP4. Annotate and share.",
  },
];

export function Workflow() {
  const reduce = useReducedMotion();

  return (
    <section className="section-pad workflow-section" id="workflow">
      <div className="container-x">
        <Reveal className="section-head workflow-head">
          <div className="section-kicker">
            <span className="section-index">01</span>
            <span>WORKFLOW</span>
            <span className="section-rule" />
          </div>
          <h2 className="neon-title">
            Footage in.
            <span className="neon-accent"> Scene out.</span>
          </h2>
          <p>Four steps from raw video to a room you can stand in.</p>
        </Reveal>

        <motion.div
          className="workflow-rail"
          variants={stagger}
          initial={reduce ? false : "hidden"}
          whileInView="show"
          viewport={{ once: true, amount: 0.25 }}
        >
          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <motion.article
                className="workflow-chip"
                key={step.number}
                variants={chipItem}
                whileHover={reduce ? undefined : { y: -4, scale: 1.015 }}
                transition={{ type: "spring", stiffness: 320, damping: 22 }}
              >
                <span className="workflow-number">{step.number}</span>
                <span className="workflow-icon"><Icon size={15} /></span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.copy}</p>
                </div>
              </motion.article>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}
