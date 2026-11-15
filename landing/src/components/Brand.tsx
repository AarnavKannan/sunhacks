type MarkProps = {
  className?: string;
  size?: number;
};

/** Impact reticle: four crosshair arms around a white-hot center. */
export function Mark({ className = "", size = 28 }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="7.5" fill="#0d1013" stroke="currentColor" strokeOpacity=".18" />
      <g stroke="#d8ff4f" strokeWidth="1.8" strokeLinecap="round">
        <path d="M16 5v5.4M16 21.6V27M5 16h5.4M21.6 16H27" />
        <path d="M8.2 8.2l3.7 3.7M20.1 20.1l3.7 3.7M23.8 8.2l-3.7 3.7M11.9 20.1l-3.7 3.7" opacity=".5" />
      </g>
      <circle cx="16" cy="16" r="3" fill="#ff5c35" />
      <circle cx="16" cy="16" r="1.15" fill="#fff" fillOpacity=".9" />
    </svg>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5" aria-label="CRASHVZN">
      <Mark size={compact ? 25 : 29} />
      <span className={`wordmark ${compact ? "wordmark-compact" : ""}`}>
        CRASH<span className="wordmark-slash">V</span>ZN
      </span>
    </span>
  );
}
