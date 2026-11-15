import { DownloadButton } from "@/components/DownloadButton";
import { motion, useReducedMotion } from "@/components/Motion";
import { heroItem, heroStagger } from "@/lib/motion";
import { ArrowDown, ArrowUpRight } from "lucide-react";

export function Hero() {
  const reduce = useReducedMotion();

  return (
    <section className="hero" id="top">
      <motion.div className="container-x" variants={heroStagger} initial={reduce ? false : "hidden"} animate="show">
        <motion.h1 className="hero-title" variants={heroItem}>
          Every moment.<br />Every angle.
        </motion.h1>
        <motion.p className="hero-sub" variants={heroItem}>
          Turn incident footage into an explorable 4D reconstruction. Built to investigate,
          understand, and explain.
        </motion.p>
        <motion.div className="hero-action-row" variants={heroItem}>
          <div className="hero-actions">
            <DownloadButton label="Get CRASHVZN" />
            <span className="hero-availability">Free during beta. Runs locally.</span>
          </div>
          <a className="hero-feature-link" href="#assistant">Meet your scene assistant <ArrowUpRight size={16} /></a>
        </motion.div>
        <motion.figure className="hero-preview" variants={heroItem}>
          <iframe
            className="hero-demo-slot"
            src="https://www.youtube-nocookie.com/embed/LqIvZDEZVqY?rel=0"
            title="CRASHVZN demo video"
            width={1280}
            height={720}
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
          <figcaption>
            <span>A new perspective on what happened.</span>
            <a href="#workflow">Explore the workflow <ArrowDown size={14} /></a>
          </figcaption>
        </motion.figure>
      </motion.div>
    </section>
  );
}
