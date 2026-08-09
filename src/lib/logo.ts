/**
 * Parse logo — "Event Horizon" mark (adopted 2026-08-09).
 *
 * A black-hole pupil ringed by an accretion glow: the event horizon as the
 * trust boundary, the eye that watches everything that crosses it, and — per
 * the holographic principle — the surface where the record lives. Amber is
 * the accretion tone (matter approaching the boundary); the faint blue outer
 * glow ties back to Parse Blue.
 *
 * The mark must read on both dark (landing, console) and light (docs) grounds:
 * the pupil is pure black with a hairline keyline, and the accretion ring
 * carries the identity on any background.
 */

const HORIZON_GOLD = "#ffd9a0";
const ACCRETION_AMBER = "#ffb454";
const PARSE_BLUE = "#3d7bff";
const INK = "#111827";

function accretionDefs(id: string): string {
  return `<defs>
    <radialGradient id="${id}" cx="50%" cy="50%" r="50%">
      <stop offset="52%" stop-color="${ACCRETION_AMBER}" stop-opacity="0"/>
      <stop offset="68%" stop-color="${ACCRETION_AMBER}" stop-opacity="0.9"/>
      <stop offset="82%" stop-color="${PARSE_BLUE}" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="${PARSE_BLUE}" stop-opacity="0"/>
    </radialGradient>
  </defs>`;
}

export function getLogoMarkSvg(className = "parse-logo-mark", title?: string): string {
  const titleNode = title ? `<title>${escapeSvgText(title)}</title>` : "";
  return `<svg class="${className}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44" role="img" aria-hidden="${title ? "false" : "true"}" focusable="false">
  ${titleNode}
  ${accretionDefs("pa-acc-mark")}
  <circle cx="22" cy="22" r="21" fill="url(#pa-acc-mark)"/>
  <circle cx="22" cy="22" r="10" fill="#000"/>
  <circle cx="22" cy="22" r="10.6" fill="none" stroke="${HORIZON_GOLD}" stroke-opacity="0.85" stroke-width="1.3"/>
</svg>`;
}

export function getLogoLockupSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 290 72" role="img" aria-labelledby="parse-logo-title">
  <title id="parse-logo-title">Parse</title>
  ${accretionDefs("pa-acc-lockup")}
  <circle cx="38" cy="36" r="32" fill="url(#pa-acc-lockup)"/>
  <circle cx="38" cy="36" r="15" fill="#000"/>
  <circle cx="38" cy="36" r="15.9" fill="none" stroke="${HORIZON_GOLD}" stroke-opacity="0.85" stroke-width="1.8"/>
  <text x="86" y="49" fill="${INK}" font-family="Schibsted Grotesk, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif" font-size="44" font-weight="700" letter-spacing="-0.5">Parse</text>
</svg>`;
}

export function getLogoIconSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 84 84">
  ${accretionDefs("pa-acc-icon")}
  <rect width="84" height="84" rx="18" fill="#050506"/>
  <circle cx="42" cy="42" r="34" fill="url(#pa-acc-icon)"/>
  <circle cx="42" cy="42" r="16" fill="#000"/>
  <circle cx="42" cy="42" r="17" fill="none" stroke="${HORIZON_GOLD}" stroke-opacity="0.9" stroke-width="2"/>
</svg>`;
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
