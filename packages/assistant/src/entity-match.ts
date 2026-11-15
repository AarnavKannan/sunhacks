import type { Entity, EntityMatch } from "./types";

const STOP_WORDS = new Set(["the", "a", "an", "car", "vehicle", "one", "on", "in", "at", "that", "this"]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOP_WORDS.has(t));
}

/**
 * Ranks entities against a free-text reference like "red toyota".
 * Pure function so the app can use the same matcher for its own search box.
 */
export function matchEntities(entities: Entity[], query: string): EntityMatch[] {
  const q = tokens(query);
  const qRaw = query.trim().toLowerCase();
  const out: EntityMatch[] = [];

  for (const e of entities) {
    if (qRaw === e.id.toLowerCase()) {
      out.push({ id: e.id, label: e.label, score: 1 });
      continue;
    }
    const haystack = new Set(
      tokens([e.label, e.color, e.type, e.make, e.model, ...(e.aliases ?? [])].filter(Boolean).join(" ")),
    );
    if (q.length === 0) continue;
    const hits = q.filter((t) => haystack.has(t)).length;
    const aliasExact = (e.aliases ?? []).some((a) => a.toLowerCase() === qRaw);
    const score = aliasExact ? 0.95 : hits / q.length;
    if (score > 0) out.push({ id: e.id, label: e.label, score: Math.round(score * 100) / 100 });
  }

  return out.sort((a, b) => b.score - a.score);
}
