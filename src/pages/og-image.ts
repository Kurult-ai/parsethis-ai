import { getLogoMarkSvg } from "../lib/logo.js";

/**
 * Social share image (1200x630) in the Event Horizon theme: black field,
 * faint accretion glow, the mark, and the governance one-liner.
 */
export function getOgImageSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs>
    <radialGradient id="og-glow" cx="18%" cy="24%" r="70%">
      <stop offset="0%" stop-color="#3d7bff" stop-opacity="0.14"/>
      <stop offset="45%" stop-color="#7a5cff" stop-opacity="0.07"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="og-rim" cx="50%" cy="100%" r="80%">
      <stop offset="0%" stop-color="#ffb454" stop-opacity="0.16"/>
      <stop offset="55%" stop-color="#ffd9a0" stop-opacity="0.05"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="#000000"/>
  <rect width="1200" height="630" fill="url(#og-glow)"/>
  <rect y="330" width="1200" height="300" fill="url(#og-rim)"/>
  <g transform="translate(96 84) scale(1.5)">${getLogoMarkSvg()}</g>
  <text x="188" y="124" fill="#f2f2f2" font-family="Michroma, system-ui, sans-serif" font-weight="400" font-size="30" letter-spacing="2.5">Parse</text>
  <text x="96" y="306" fill="#f2f2f2" font-family="Georgia, 'Times New Roman', serif" font-size="66">Govern your agent fleet.</text>
  <text x="96" y="386" fill="#adb1b3" font-family="Schibsted Grotesk, system-ui, sans-serif" font-weight="450" font-size="30">Every agent registered. Every boundary screened. Every decision receipted.</text>
  <rect x="96" y="452" width="204" height="52" rx="26" fill="#f2f2f2"/>
  <text x="198" y="486" text-anchor="middle" fill="#000000" font-family="Schibsted Grotesk, system-ui, sans-serif" font-weight="700" font-size="19">Install Parse</text>
  <text x="336" y="485" fill="#878b8e" font-family="IBM Plex Mono, ui-monospace, monospace" font-size="18">parsethis.ai</text>
</svg>`;
}
