type SceneArtProps = {
  sceneId: string;
  large?: boolean;
};

export function SceneArt({ sceneId, large = false }: SceneArtProps) {
  const height = large ? 148 : 64;
  if (sceneId === "apache") {
    return (
      <svg viewBox="0 0 320 180" className="h-full w-full" style={{ height }} aria-hidden>
        <rect width="320" height="180" fill="#d5d8dc" />
        <rect x="0" y="68" width="320" height="44" fill="#b7b7b7" />
        <rect x="138" y="0" width="44" height="180" fill="#b7b7b7" />
        <line x1="20" y1="90" x2="300" y2="90" stroke="#c6a21e" strokeDasharray="8 6" />
        <rect x="46" y="82" width="28" height="14" rx="2" fill="#d5dbe3" />
        <rect x="214" y="86" width="30" height="16" rx="2" fill="#1d4e89" />
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

  return (
    <svg viewBox="0 0 320 180" className="h-full w-full" style={{ height }} aria-hidden>
      <rect width="320" height="180" fill="#d4d4d4" />
      <rect x="70" y="78" width="220" height="28" fill="#b9b9b9" />
      <rect x="132" y="20" width="28" height="140" fill="#b9b9b9" />
      <circle cx="146" cy="92" r="34" fill="#8e8e8e" />
      <circle cx="146" cy="92" r="46" fill="none" stroke="#2a2a2a" />
      <rect x="210" y="112" width="78" height="42" fill="none" stroke="#333" />
      <rect x="188" y="84" width="22" height="12" rx="2" fill="#f4f4f4" stroke="#bbb" />
      <rect x="214" y="86" width="20" height="11" rx="2" fill="#d02424" />
      <rect x="78" y="118" width="18" height="10" rx="2" fill="#e07a14" />
      <rect x="236" y="128" width="18" height="10" rx="2" fill="#2f9e4f" />
    </svg>
  );
}
