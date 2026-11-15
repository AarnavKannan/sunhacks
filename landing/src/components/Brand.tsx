type MarkProps = {
  className?: string;
  size?: number;
};

/** Neon warning mark inspired by the CRASHVZN logo triangle. */
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
      <rect width="32" height="32" rx="4" fill="#1d1f23" stroke="currentColor" strokeOpacity=".18" />
      <path
        d="M16 6.2 26.2 24.4H5.8L16 6.2Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M16 13.2v5.2" stroke="#140a00" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="16" cy="21.2" r="1.15" fill="#140a00" />
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
