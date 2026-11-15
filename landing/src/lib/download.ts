import { useEffect, useState } from "react";

export type Platform = "mac" | "win" | "linux" | "other";

export type DownloadTarget = {
  platform: Platform;
  url: string;
  version: string;
  /** True when a matching installer asset was found (rather than the releases page). */
  direct: boolean;
};

const DEFAULT_REPO = "AarnavKannan/sunhacks";
const repo = import.meta.env.VITE_GITHUB_REPO?.trim() || DEFAULT_REPO;
const version = import.meta.env.VITE_DOWNLOAD_VERSION?.trim() || "0.1.0";

const overrides: Record<Platform, string | undefined> = {
  mac: import.meta.env.VITE_DOWNLOAD_URL_MAC?.trim(),
  win: import.meta.env.VITE_DOWNLOAD_URL_WIN?.trim(),
  linux: import.meta.env.VITE_DOWNLOAD_URL_LINUX?.trim(),
  other: undefined,
};

const releasesPage = `https://github.com/${repo}/releases`;
// `/releases/latest` returns 404 until the first release exists, which logs a
// console error on every page load. The collection endpoint returns an empty
// array instead, so an unpublished repo falls back cleanly.
const apiUrl = `https://api.github.com/repos/${repo}/releases?per_page=1`;
const cacheKey = `crashvzn:latest-release:${repo}`;

export const platformLabel: Record<Platform, string> = {
  mac: "macOS",
  win: "Windows",
  linux: "Linux",
  other: "your desktop",
};

export function detectPlatform(): Platform {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const hint = `${nav.userAgentData?.platform ?? ""} ${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`.toLowerCase();
  // The app is desktop-only; phones and tablets get the generic release link.
  // iPadOS reports a Mac platform, so fall back to the touch-point check.
  const touchMac = hint.includes("mac") && navigator.maxTouchPoints > 1;
  if (touchMac || hint.includes("iphone") || hint.includes("ipad") || hint.includes("android")) return "other";
  if (hint.includes("win")) return "win";
  if (hint.includes("linux") || hint.includes("x11")) return "linux";
  if (hint.includes("mac")) return "mac";
  return "other";
}

function extensionScore(name: string, platform: Platform) {
  if (platform === "other") return -1;
  const lower = name.toLowerCase();
  const foreign =
    platform === "mac"
      ? /win|windows|linux|appimage|\.deb|\.rpm/
      : platform === "win"
        ? /mac|darwin|osx|apple|linux|appimage|\.deb|\.rpm/
        : /mac|darwin|osx|apple|win|windows/;
  if (foreign.test(lower)) return -1;
  const preferred =
    platform === "mac"
      ? [".dmg", ".pkg", ".zip"]
      : platform === "win"
        ? [".exe", ".msi", ".zip"]
        : platform === "linux"
          ? [".appimage", ".deb", ".rpm", ".tar.gz"]
          : [];

  const index = preferred.findIndex((extension) => lower.endsWith(extension));
  if (index >= 0) return 100 - index;

  // A release may include a universal archive; it's better than the releases page.
  if (lower.endsWith(".zip") || lower.endsWith(".tar.gz")) return 20;
  return -1;
}

type GithubAsset = { name: string; browser_download_url: string };
type GithubRelease = { tag_name?: string; assets?: GithubAsset[] };

// Every download CTA mounts its own hook; share one request (and one promise
// during StrictMode's double effect) instead of hitting the API per button.
let releaseRequest: Promise<GithubRelease | null> | null = null;

function latestRelease(): Promise<GithubRelease | null> {
  if (releaseRequest) return releaseRequest;

  releaseRequest = (async () => {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as GithubRelease;
      } catch {
        sessionStorage.removeItem(cacheKey);
      }
    }

    try {
      const response = await fetch(apiUrl, { headers: { Accept: "application/vnd.github+json" } });
      if (!response.ok) return null;
      const releases = (await response.json()) as GithubRelease[];
      const release = Array.isArray(releases) ? releases[0] ?? null : null;
      if (release) sessionStorage.setItem(cacheKey, JSON.stringify(release));
      return release;
    } catch {
      return null;
    }
  })();

  return releaseRequest;
}

export function useDownloadTarget() {
  const [target, setTarget] = useState<DownloadTarget>(() => {
    const platform = detectPlatform();
    const override = overrides[platform];
    return {
      platform,
      url: override || releasesPage,
      version,
      direct: Boolean(override),
    };
  });

  useEffect(() => {
    const platform = detectPlatform();
    const override = overrides[platform];
    if (override) return;

    let cancelled = false;
    void latestRelease().then((release) => {
      if (cancelled || !release?.assets?.length) return;
      const best = release.assets
        .map((asset) => ({ asset, score: extensionScore(asset.name, platform) }))
        .filter((entry) => entry.score >= 0)
        .sort((a, b) => b.score - a.score)[0];

      if (!best) return;
      setTarget({
        platform,
        url: best.asset.browser_download_url,
        version: (release.tag_name ?? version).replace(/^v/i, ""),
        direct: true,
      });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return target;
}
