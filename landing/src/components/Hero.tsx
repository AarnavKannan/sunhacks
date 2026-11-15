import { DownloadButton, DownloadMeta } from "@/components/DownloadButton";
import { InstallCommands } from "@/components/InstallCommands";
import { motion, useReducedMotion } from "@/components/Motion";
import { heroItem, heroStagger } from "@/lib/motion";
import { ArrowDown } from "lucide-react";

export function Hero() {
  const reduce = useReducedMotion();

  return (
    <section className="hero" id="top">
      <div className="hero-backdrop" aria-hidden="true">
        <div className="hero-glow" />
        <div className="hero-ring" />
        <div className="hero-grid" />
        <div className="hero-hazard" />
      </div>

      <motion.div
        className="container-x hero-inner"
        variants={heroStagger}
        initial={reduce ? false : "hidden"}
        animate="show"
      >
        <motion.div className="hero-brand-lockup" variants={heroItem}>
          <div className="hero-logo-bloom" aria-hidden="true" />
          <img
            className="hero-logo"
            src="/logo-neon.png"
            alt="CRASHVZN"
            width={220}
            height={220}
          />
        </motion.div>

        <motion.p className="hero-sub" variants={heroItem}>
          Traffic-incident footage becomes an explorable 4D scene — every vehicle path, speed, and
          heading measured frame by frame. Local-first. Built for investigators.
        </motion.p>

        <motion.div className="hero-actions" variants={heroItem}>
          <motion.div whileHover={reduce ? undefined : { scale: 1.03, y: -2 }} whileTap={reduce ? undefined : { scale: 0.98 }}>
            <DownloadButton label="Download CRASHVZN" />
          </motion.div>
        </motion.div>

        <motion.div className="hero-note" variants={heroItem}>
          <DownloadMeta />
          <span className="hero-note-dot" />
          <span>macOS · Windows · Linux</span>
          <span className="hero-note-dot" />
          <span>No account. No upload.</span>
        </motion.div>

        <motion.div className="hero-install" variants={heroItem}>
          <InstallCommands />
          <motion.img
            className="hero-mini"
            src="/mini.png"
            alt=""
            aria-hidden="true"
            width={88}
            height={88}
            animate={
              reduce
                ? undefined
                : {
                    y: [0, -6, 0],
                    rotate: [-8, -4, -8],
                  }
            }
            transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
          />
        </motion.div>

        <motion.a className="hero-scroll" href="#workflow" variants={heroItem}>
          <ArrowDown size={14} />
          <span>See how it works</span>
        </motion.a>
      </motion.div>
    </section>
  );
}
