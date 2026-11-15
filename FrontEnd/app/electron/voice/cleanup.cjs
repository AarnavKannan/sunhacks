/**
 * Transcript cleanup after recognition: filler words out, word remapping, tidy spacing.
 *
 * The filler list and its rules (whole words only, lowercase or first-letter capital only, the
 * comma or ellipsis that comes with a filler goes too, a sentence-initial filler hands its
 * capital to the next word) follow Hex's src/dictation/filler_words.rs, and the
 * case-insensitive whole-phrase replacements follow src/dictation/text_replacements.rs
 * (https://github.com/anomalyco/hex, MIT, Copyright (c) 2026 Christopher Langton). Our code is a
 * regex-based reimplementation, not a port; see CREDITS.md.
 */

const FILLERS = ["um", "umm", "uh", "uhh", "erm", "er", "ah"];

/**
 * Word remapping: phrases the recognizer tends to get wrong for this app, and what to write
 * instead. Matched case-insensitively as whole words. Add entries as needed.
 * @type {{ from: string, to: string }[]}
 */
const DEFAULT_REPLACEMENTS = [];

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const FILLER_PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}'’-])(${FILLERS.join("|")})(?![\\p{L}\\p{N}'’-])(\\s*(?:,|\\.\\.\\.|…))?`,
  "giu",
);

function isFillerCase(word) {
  const lower = word.toLowerCase();
  return word === lower || word === lower[0].toUpperCase() + lower.slice(1);
}

/** Marks where a sentence-initial filler was, so the next word can take its capital. */
const CAPITAL = "\u0000";

function removeFillers(text) {
  let out = "";
  let last = 0;
  let removed = false;
  for (const match of text.matchAll(FILLER_PATTERN)) {
    const word = match[1];
    if (!isFillerCase(word)) continue;
    out += text.slice(last, match.index);
    last = match.index + match[0].length;
    removed = true;
    const before = out.replaceAll(CAPITAL, "").trimEnd();
    if (word[0] !== word[0].toLowerCase() && (before === "" || /[.!?]["”’)]?$/.test(before))) out += CAPITAL;
  }
  if (!removed) return text;
  out += text.slice(last);
  return (
    out
      // A capital handed on passes over spaces and the punctuation that came with the filler.
      .replace(new RegExp(`${CAPITAL}[\\s,.…]*(\\p{Ll})`, "gu"), (_whole, letter) => letter.toUpperCase())
      .replaceAll(CAPITAL, "")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/[ \t]+([,.!?;:…)\]}])/g, "$1")
      .replace(/,(\s*[.!?])/g, "$1")
      .replace(/(^|[.!?]\s+)[,.]\s*/g, "$1")
      .replace(/,\s*$/g, "")
      .trim()
  );
}

function applyReplacements(text, replacements) {
  let out = text;
  for (const { from, to } of replacements) {
    const phrase = from.trim();
    if (!phrase) continue;
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(phrase)}(?![\\p{L}\\p{N}])`, "giu"), () => to);
  }
  return out;
}

/**
 * The text to hand to the composer, or "" when nothing is left. Options:
 * `removeFillers` (default true), `replacements` (added to the defaults).
 */
function cleanTranscript(raw, { removeFillers: strip = true, replacements = [] } = {}) {
  let text = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (strip) text = removeFillers(text);
  text = applyReplacements(text, [...DEFAULT_REPLACEMENTS, ...replacements]);
  text = text.replace(/\s+/g, " ").trim();
  // Nothing but punctuation is nothing.
  if (!/[\p{L}\p{N}]/u.test(text)) return "";
  return text;
}

module.exports = { cleanTranscript, removeFillers, applyReplacements, DEFAULT_REPLACEMENTS };
