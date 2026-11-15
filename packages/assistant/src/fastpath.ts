/**
 * Fast path (requirements §5.6): turns trivial commands into tool calls with
 * no LLM round trip, so "pause" or "zoom in" responds in well under 100 ms.
 *
 * Deliberately conservative: anything that names a vehicle, asks a question,
 * or chains actions goes to the LLM. A false miss costs ~2 s; a false hit
 * does the wrong thing, so when in doubt, return null.
 */

export interface FastPathAction {
  tool: string;
  args: Record<string, unknown>;
  /** What to show/say in the chat, e.g. "Zooming in." */
  reply: string;
}

type Rule = { re: RegExp; build: (m: RegExpMatchArray) => FastPathAction };

const NUM_WORDS: Record<string, number> = {
  fifteen: 15, thirty: 30, "forty five": 45, "forty-five": 45, sixty: 60, ninety: 90, "one eighty": 180, "one hundred eighty": 180,
};

function num(s: string): number {
  return NUM_WORDS[s] ?? Number(s);
}

const DEG = String.raw`(\d+(?:\.\d+)?|fifteen|thirty|forty[ -]five|sixty|ninety|one eighty|one hundred eighty)`;

const RULES: Rule[] = [
  { re: /^(?:play|resume|start(?: playback)?|go)$/, build: () => ({ tool: "timeline_play", args: {}, reply: "Playing." }) },
  { re: /^(?:pause|stop|hold(?: on)?|freeze)$/, build: () => ({ tool: "timeline_pause", args: {}, reply: "Paused." }) },
  {
    re: /^(?:play )?(?:at )?(half|quarter|normal|double|\d+(?:\.\d+)?x?) speed$|^(?:play )?(?:at )?(\d+(?:\.\d+)?)x$/,
    build: (m) => {
      const raw = m[1] ?? m[2]!;
      const speed = raw === "half" ? 0.5 : raw === "quarter" ? 0.25 : raw === "normal" ? 1 : raw === "double" ? 2 : parseFloat(raw);
      return { tool: "timeline_play", args: { speed }, reply: `Playing at ${speed}×.` };
    },
  },
  { re: /^slow(?: it)? (?:down|motion)$/, build: () => ({ tool: "timeline_play", args: { speed: 0.25 }, reply: "Playing in slow motion." }) },
  { re: /^zoom in(?: a bit| a little)?$/, build: (m) => ({ tool: "camera_zoom", args: { factor: m[0].includes("bit") || m[0].includes("little") ? 1.3 : 2 }, reply: "Zooming in." }) },
  { re: /^zoom out(?: a bit| a little)?$/, build: (m) => ({ tool: "camera_zoom", args: { factor: m[0].includes("bit") || m[0].includes("little") ? 0.77 : 0.5 }, reply: "Zooming out." }) },
  { re: /^(?:reset(?: the)?(?: view| camera)?|start over|overview)$/, build: () => ({ tool: "camera_reset", args: {}, reply: "Back to the overview." }) },
  {
    re: /^(?:(?:show|view|look)(?: it| me)? )?from (above|the top|overhead)$|^(?:top|bird'?s[- ]eye|overhead) view$/,
    build: () => ({ tool: "camera_preset", args: { preset: "top" }, reply: "Showing it from above." }),
  },
  {
    // Side words need "view" or a verb ("back" alone means leave the viewer); the CAD names can stand alone.
    re: /^(?:(?:show|switch to|go to|give me)(?: me)? (?:the |an? )?(front|back|rear|left|right|side|top|bottom|iso|isometric|dimetric|trimetric)(?: view)?|(front|back|rear|left|right|side|top|bottom|iso|isometric|dimetric|trimetric) view|(iso|isometric|dimetric|trimetric))$/,
    build: (m) => {
      const w = (m[1] ?? m[2] ?? m[3])!;
      const preset = w === "isometric" ? "iso" : w === "side" ? "left" : w === "rear" ? "back" : w;
      const name = preset === "iso" ? "isometric" : preset;
      return { tool: "camera_preset", args: { preset }, reply: `Switching to the ${name} view.` };
    },
  },
  {
    re: new RegExp(String.raw`^(?:orbit|rotate|turn|spin)(?: the camera| the view)?(?: by)? ${DEG}(?: degrees?|°)?(?: to the)? (left|right)$`),
    build: (m) => {
      const deg = num(m[1]!);
      const yaw = m[2] === "left" ? -deg : deg;
      return { tool: "camera_orbit", args: { yaw_deg: yaw, pitch_deg: 0 }, reply: `Orbiting ${deg}° ${m[2]}.` };
    },
  },
  {
    re: /^(?:orbit|rotate|turn|spin)(?: the camera| the view)?(?: to the)? (left|right)$/,
    build: (m) => ({ tool: "camera_orbit", args: { yaw_deg: m[1] === "left" ? -30 : 30, pitch_deg: 0 }, reply: `Orbiting ${m[1]}.` }),
  },
  {
    re: /^(?:jump|go|skip|seek)(?: back)? to (?:the )?(?:moment of |start of the |beginning of the )?(?:impact|crash|collision)$/,
    build: () => ({ tool: "timeline_seek", args: { event: "crash_start" }, reply: "Jumping to the start of the crash." }),
  },
  {
    re: /^(?:jump|go|skip|seek) to (?:the )?end of the (?:crash|collision|impact)$/,
    build: () => ({ tool: "timeline_seek", args: { event: "crash_end" }, reply: "Jumping to the end of the crash." }),
  },
  { re: /^(?:go to the |jump to the |back to the )?(?:start|beginning)$/, build: () => ({ tool: "timeline_seek", args: { t_s: 0 }, reply: "Back to the start." }) },
  {
    // "go back" alone means leave the viewer (LLM), so "go" needs an explicit number of seconds.
    re: /^(?:(?:step|skip|jump) (forward|back|backward|ahead)(?: (\d+(?:\.\d+)?|one|a|two|half a) seconds?)?|go (forward|back|backward|ahead) (\d+(?:\.\d+)?|one|a|two|half a) seconds?)$/,
    build: (m) => {
      const dir = m[1] ?? m[3];
      const word = m[2] ?? m[4];
      const n = word === undefined || word === "one" || word === "a" ? 1 : word === "two" ? 2 : word === "half a" ? 0.5 : parseFloat(word);
      const s = dir === "back" || dir === "backward" ? -n : n;
      return { tool: "timeline_seek", args: { relative_s: s }, reply: `${s < 0 ? "Back" : "Forward"} ${Math.abs(s)} second${Math.abs(s) === 1 ? "" : "s"}.` };
    },
  },
  { re: /^(?:show|turn on) (?:the )?(?:trails|paths)$/, build: () => ({ tool: "ui_toggle", args: { target: "trails", visible: true }, reply: "Showing vehicle paths." }) },
  { re: /^(?:hide|turn off) (?:the )?(?:trails|paths)$/, build: () => ({ tool: "ui_toggle", args: { target: "trails", visible: false }, reply: "Hiding vehicle paths." }) },
  {
    re: /^(?:show|turn on|open)(?: me)? (?:the )?(?:original|source|real) (?:video|footage)$/,
    build: () => ({ tool: "ui_toggle", args: { target: "source_video", visible: true }, reply: "Showing the original footage." }),
  },
  {
    re: /^(?:hide|turn off|close) (?:the )?(?:original|source|real) (?:video|footage)$/,
    build: () => ({ tool: "ui_toggle", args: { target: "source_video", visible: false }, reply: "Hiding the original footage." }),
  },
  {
    re: /^(?:pan|move|slide)(?: the camera| the view)? (left|right|up|down|forward|back|backward)(?: (\d+(?:\.\d+)?) ?(?:meters?|metres?|m))?$/,
    build: (m) => {
      const d = m[2] ? parseFloat(m[2]) : 5;
      const dir = m[1] === "backward" ? "back" : m[1]!;
      const args = { left: { right_m: -d }, right: { right_m: d }, up: { up_m: d }, down: { up_m: -d }, forward: { forward_m: d }, back: { forward_m: -d } }[dir]!;
      return { tool: "camera_move", args, reply: `Moving ${dir} ${d} m.` };
    },
  },
  {
    re: new RegExp(String.raw`^look (left|right|up|down)(?: ${DEG}(?: degrees?|°))?$`),
    build: (m) => {
      const deg = m[2] ? num(m[2]) : 30;
      const args = m[1] === "left" ? { yaw_deg: -deg, pitch_deg: 0 } : m[1] === "right" ? { yaw_deg: deg, pitch_deg: 0 } : { yaw_deg: 0, pitch_deg: m[1] === "up" ? deg : -deg };
      return { tool: "camera_rotate", args, reply: `Looking ${m[1]}.` };
    },
  },
  { re: /^(?:leave|exit) (?:the )?(?:pov|point of view|driver'?s? view)$/, build: () => ({ tool: "camera_pov", args: { entity_id: null }, reply: "Leaving the point-of-view camera." }) },
  { re: /^(?:stop following|unlock(?: the)? camera|unfollow)$/, build: () => ({ tool: "camera_follow", args: { entity_id: null }, reply: "Camera unlocked." }) },
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.!?,]+/g, " ")
    .replace(/^(?:ok(?:ay)?|hey|um+|uh+|so|now|and|please|can you|could you)\s+/g, "")
    .replace(/^(?:please|can you|could you)\s+/g, "")
    .replace(/\s+please$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Returns the action for a trivial command, or null to send it to the LLM. */
export function matchFastPath(text: string): FastPathAction | null {
  const t = normalize(text);
  if (!t || t.length > 60) return null;
  for (const rule of RULES) {
    const m = t.match(rule.re);
    if (m) return rule.build(m);
  }
  return null;
}
