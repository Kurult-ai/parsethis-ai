/**
 * Parse logo — "Total Eclipse" mark (adopted 2026-08-09, succeeds the
 * Event Horizon mark).
 *
 * A solar eclipse at totality: a deep black disc covering the source, a
 * warm orange-yellow corona breathing around the limb, and the diamond-ring
 * flare at the upper-right edge — the one point where light gets through.
 * The reading is the brand: Parse stands between raw power and everything
 * else, and what passes the boundary is deliberate, visible, and receipted.
 *
 * The mark must read on both dark (site, console) and light (email, embeds)
 * grounds: the disc is pure black with a hairline warm rim, and the corona
 * carries the identity on any background.
 */

const CORONA_GOLD = "#ffd9a0";
const CORONA_ORANGE = "#ffb454";
const FLARE_HOT = "#fff3d6";
const DEEP_ORANGE = "#ff8a3d";
const INK = "#111827";

/** Corona + diamond-ring flare gradients. Angles put the flare at ~40deg
 *  upper-right on the limb, the classic totality photograph. */
function eclipseDefs(id: string): string {
  return `<defs>
    <radialGradient id="${id}-corona" cx="50%" cy="50%" r="50%">
      <stop offset="46%" stop-color="${CORONA_ORANGE}" stop-opacity="0"/>
      <stop offset="55%" stop-color="${CORONA_GOLD}" stop-opacity="0.95"/>
      <stop offset="66%" stop-color="${CORONA_ORANGE}" stop-opacity="0.55"/>
      <stop offset="82%" stop-color="${DEEP_ORANGE}" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="${DEEP_ORANGE}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="${id}-flare" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${FLARE_HOT}" stop-opacity="1"/>
      <stop offset="34%" stop-color="${CORONA_GOLD}" stop-opacity="0.85"/>
      <stop offset="70%" stop-color="${CORONA_ORANGE}" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="${CORONA_ORANGE}" stop-opacity="0"/>
    </radialGradient>
  </defs>`;
}

/** Flare center for a disc at (cx, cy) with limb radius r: 40deg above the
 *  horizontal, on the upper-right limb. */
function flareAt(cx: number, cy: number, r: number): { x: number; y: number } {
  const rad = (40 * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
}

export function getLogoMarkSvg(className = "parse-logo-mark", title?: string): string {
  const titleNode = title ? `<title>${escapeSvgText(title)}</title>` : "";
  const f = flareAt(22, 22, 11.2);
  return `<svg class="${className}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44" role="img" aria-hidden="${title ? "false" : "true"}" focusable="false">
  ${titleNode}
  ${eclipseDefs("pa-ecl-mark")}
  <circle cx="22" cy="22" r="21" fill="url(#pa-ecl-mark-corona)"/>
  <circle cx="${f.x}" cy="${f.y}" r="7.5" fill="url(#pa-ecl-mark-flare)"/>
  <circle cx="22" cy="22" r="11" fill="#000"/>
  <circle cx="22" cy="22" r="11.4" fill="none" stroke="${CORONA_GOLD}" stroke-opacity="0.8" stroke-width="1.1"/>
  <circle cx="${f.x}" cy="${f.y}" r="1.7" fill="${FLARE_HOT}"/>
</svg>`;
}

export function getLogoLockupSvg(): string {
  const f = flareAt(38, 36, 17);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 290 72" role="img" aria-labelledby="parse-logo-title">
  <title id="parse-logo-title">Parse</title>
  ${eclipseDefs("pa-ecl-lockup")}
  <circle cx="38" cy="36" r="32" fill="url(#pa-ecl-lockup-corona)"/>
  <circle cx="${f.x}" cy="${f.y}" r="11" fill="url(#pa-ecl-lockup-flare)"/>
  <circle cx="38" cy="36" r="16.6" fill="#000"/>
  <circle cx="38" cy="36" r="17.2" fill="none" stroke="${CORONA_GOLD}" stroke-opacity="0.8" stroke-width="1.6"/>
  <circle cx="${f.x}" cy="${f.y}" r="2.5" fill="${FLARE_HOT}"/>
  <text x="86" y="47" fill="${INK}" font-family="Saira, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif" font-size="32" font-weight="700" letter-spacing="2.5">Parse</text>
</svg>`;
}

export function getLogoIconSvg(): string {
  const f = flareAt(42, 42, 18);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 84 84">
  ${eclipseDefs("pa-ecl-icon")}
  <rect width="84" height="84" rx="18" fill="#050506"/>
  <circle cx="42" cy="42" r="34" fill="url(#pa-ecl-icon-corona)"/>
  <circle cx="${f.x}" cy="${f.y}" r="12" fill="url(#pa-ecl-icon-flare)"/>
  <circle cx="42" cy="42" r="17.6" fill="#000"/>
  <circle cx="42" cy="42" r="18.2" fill="none" stroke="${CORONA_GOLD}" stroke-opacity="0.85" stroke-width="1.9"/>
  <circle cx="${f.x}" cy="${f.y}" r="2.8" fill="${FLARE_HOT}"/>
</svg>`;
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
