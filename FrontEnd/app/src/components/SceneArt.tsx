type SceneArtProps = {
  sceneId: string;
  large?: boolean;
};

export function SceneArt({ sceneId, large = false }: SceneArtProps) {
  const height = large ? 148 : 64;
  if (sceneId === "apache") {
    // US arterial crossing a collector: sidewalks, crosswalks, stop bars, double yellow.
    const bars = (x: number, y: number, vertical: boolean) =>
      Array.from({ length: 6 }, (_, i) =>
        vertical ? (
          <rect key={`${x}-${y}-${i}`} x={x} y={y + i * 7.4} width="9" height="4" fill="#f2f2ee" />
        ) : (
          <rect key={`${x}-${y}-${i}`} x={x + i * 5.4} y={y} width="3" height="9" fill="#f2f2ee" />
        ),
      );
    return (
      <svg viewBox="0 0 320 180" className="h-full w-full" style={{ height }} aria-hidden>
        <rect width="320" height="180" fill="#cbb79c" />
        <rect x="0" y="58" width="320" height="64" rx="0" fill="#c9c7c2" />
        <rect x="128" y="0" width="64" height="180" fill="#c9c7c2" />
        <rect x="0" y="66" width="320" height="48" fill="#6d6d6d" />
        <rect x="136" y="0" width="48" height="180" fill="#6d6d6d" />
        <line x1="0" y1="89" x2="118" y2="89" stroke="#e0b532" strokeWidth="1.2" />
        <line x1="0" y1="91" x2="118" y2="91" stroke="#e0b532" strokeWidth="1.2" />
        <line x1="202" y1="89" x2="320" y2="89" stroke="#e0b532" strokeWidth="1.2" />
        <line x1="202" y1="91" x2="320" y2="91" stroke="#e0b532" strokeWidth="1.2" />
        {[78, 102].map((y) => (
          <g key={y}>
            <line x1="0" y1={y} x2="118" y2={y} stroke="#f2f2ee" strokeDasharray="6 12" />
            <line x1="202" y1={y} x2="320" y2={y} stroke="#f2f2ee" strokeDasharray="6 12" />
          </g>
        ))}
        {bars(118, 67, true)}
        {bars(193, 67, true)}
        {bars(137, 54, false)}
        {bars(137, 117, false)}
        <rect x="112" y="91" width="3" height="22" fill="#f2f2ee" />
        <rect x="205" y="67" width="3" height="22" fill="#f2f2ee" />
        <rect x="146" y="80" width="16" height="8" rx="2" fill="#d5dbe3" />
        <rect x="160" y="91" width="18" height="9" rx="2" fill="#1d4e89" />
      </svg>
    );
  }

  if (sceneId === "highway") {
    return (
      <svg viewBox="0 0 320 180" className="h-full w-full" style={{ height }} aria-hidden>
        <rect width="320" height="180" fill="#d4d4d4" />
        <rect x="0" y="44" width="320" height="42" fill="#b9b9b9" />
        <rect x="0" y="94" width="320" height="42" fill="#b9b9b9" />
        <rect x="0" y="88" width="320" height="4" fill="#8e8e8e" />
        {[58, 72, 108, 122].map((y) => (
          <line key={y} x1="0" y1={y} x2="320" y2={y} stroke="#2a2a2a" strokeDasharray="10 8" />
        ))}
        <rect x="40" y="76" width="44" height="9" rx="1.5" fill="#e9ecef" stroke="#999" />
        <rect x="130" y="62" width="18" height="8" rx="2" fill="#c4c9cf" />
        <rect x="210" y="48" width="18" height="8" rx="2" fill="#b3202a" />
        <rect x="170" y="112" width="18" height="8" rx="2" fill="#24508f" />
        <rect x="240" y="124" width="44" height="9" rx="1.5" fill="#b4372b" />
      </svg>
    );
  }

  if (!sceneId.startsWith("roundabout") && sceneId !== "roundabout") {
    return (
      <svg viewBox="0 0 320 180" className="h-full w-full" style={{ height }} aria-hidden>
        <rect width="320" height="180" fill="#1b3f86" />
        <circle cx="160" cy="96" r="28" fill="#7ec8ff" opacity="0.85" />
        <circle cx="120" cy="70" r="10" fill="#9ad0ff" />
        <circle cx="200" cy="120" r="14" fill="#d7ecff" />
      </svg>
    );
  }

  // Four-arm roundabout with splitter islands, and car parks either side of the east arm.
  return (
    <svg viewBox="0 0 320 180" className="h-full w-full" style={{ height }} aria-hidden>
      <rect width="320" height="180" fill="#7f9a4c" />
      <rect x="0" y="82" width="320" height="30" fill="#6d6d6d" />
      <rect x="126" y="0" width="30" height="180" fill="#6d6d6d" />
      <circle cx="141" cy="97" r="46" fill="#6d6d6d" />
      <circle cx="141" cy="97" r="27" fill="#c9c7c2" />
      <circle cx="141" cy="97" r="21" fill="#7f9a4c" />
      {[
        [141, 40, 6, 14],
        [141, 140, 6, 14],
        [84, 97, 14, 6],
        [198, 97, 14, 6],
      ].map(([x, y, w, h]) => (
        <rect key={`${x}-${y}`} x={x - w / 2} y={y - h / 2} width={w} height={h} rx="3" fill="#c9c7c2" />
      ))}
      {[
        [212, 12, 82, 54],
        [212, 128, 82, 50],
      ].map(([x, y, w, h]) => (
        <g key={`${x}-${y}`}>
          <rect x={x} y={y} width={w} height={h} rx="5" fill="#6d6d6d" stroke="#c9c7c2" strokeWidth="2" />
          {Array.from({ length: 9 }, (_, i) => (
            <line key={i} x1={x + 6 + i * 8.6} y1={y + 3} x2={x + 6 + i * 8.6} y2={y + 15} stroke="#f2f2ee" strokeWidth="1" />
          ))}
        </g>
      ))}
      <rect x="168" y="70" width="18" height="9" rx="2" fill="#f4f4f4" />
      <rect x="182" y="84" width="18" height="9" rx="2" fill="#d02424" />
      <rect x="64" y="99" width="16" height="8" rx="2" fill="#e07a14" />
      <rect x="236" y="150" width="9" height="16" rx="2" fill="#2f9e4f" />
    </svg>
  );
}
