import { useEffect } from "react";

/**
 * Adds `is-visible` to every element marked with `data-reveal` once it scrolls
 * into view. One observer handles the whole page; reduced-motion users see
 * everything immediately.
 */
export function useReveal() {
  useEffect(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
      elements.forEach((element) => element.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );

    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);
}

/** Tracks whether the page has scrolled away from the very top. */
export function useScrolled(threshold = 12) {
  useEffect(() => {
    const update = () => document.documentElement.dataset.scrolled = window.scrollY > threshold ? "true" : "false";
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [threshold]);
}
