/**
 * Shows which providers are installed and signed in.
 *   npm run providers
 */
import { checkAllProviders, pickDefaultProvider } from "../providers/health";

try {
  process.loadEnvFile(new URL("../../.env", import.meta.url));
} catch {}

const health = await checkAllProviders();
for (const h of health) {
  const mark = h.usable ? "✓" : "✗";
  const parts = [h.installed ? `installed${h.version ? ` (${h.version})` : ""}` : "not installed", `auth: ${h.auth}${h.authDetail ? ` — ${h.authDetail}` : ""}`];
  console.log(`${mark} ${h.kind.padEnd(14)} ${parts.join(", ")}${h.hint ? `\n    → ${h.hint}` : ""}`);
}
console.log(`\nDefault provider: ${pickDefaultProvider(health) ?? "none usable"}`);
