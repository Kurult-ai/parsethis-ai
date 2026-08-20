/**
 * Parse logo — "Lensed Fold" mark (adopted 2026-08-10, succeeds the
 * Total Eclipse mark).
 *
 * The landing animation's silhouette reduced to geometry: the black shadow,
 * the thin photon ring, and the accretion disc folded by gravitational
 * lensing — near side sweeping across the front, far side bent over the top
 * and under the bottom. One radial gradient serves every element, following
 * the disc's T ∝ r^(-3/4) temperature ramp: hottest at the hole, cooling
 * outward. The band's right tip carries a Doppler highlight — the
 * approaching side is brighter. The reading is the brand: the boundary is
 * where everything is decided, and what crosses it is visible and receipted.
 *
 * Geometry is parametric (generated, not drawn): the band is the near-side
 * arc of the disc ellipse tapered to points; the arches are annular lenses
 * hugging the photon ring at the radii lensing actually paints them.
 * Tilt -24°, matching the hero canvas.
 */

const HOT = "#fff3d6";
const GOLD = "#ffd9a0";
const AMBER = "#ffb454";
const DEEP = "#ff8a3d";
const EMBER = "#f07428";
const INK = "#111827";

const ARCH_OVER_PATH =
  "M24.79 54.45L24.31 53.56L23.93 52.64L23.60 51.69L23.33 50.72L23.09 49.74L22.91 48.74L22.77 47.72L22.67 46.70L22.62 45.66L22.61 44.62L22.66 43.58L22.74 42.53L22.88 41.48L23.06 40.43L23.28 39.39L23.56 38.35L23.87 37.32L24.24 36.30L24.65 35.30L25.11 34.31L25.60 33.34L26.15 32.39L26.73 31.46L27.36 30.55L28.03 29.67L28.74 28.82L29.48 28.00L30.26 27.21L31.08 26.45L31.93 25.73L32.81 25.04L33.72 24.40L34.66 23.79L35.63 23.23L36.62 22.71L37.64 22.23L38.67 21.80L39.72 21.41L40.78 21.07L41.86 20.77L42.95 20.53L44.05 20.33L45.16 20.18L46.27 20.08L47.38 20.03L48.49 20.02L49.59 20.07L50.69 20.16L51.79 20.30L52.87 20.49L53.94 20.72L55.00 21.00L56.04 21.32L57.06 21.69L58.06 22.10L59.04 22.55L59.99 23.04L60.92 23.57L61.82 24.14L62.68 24.74L63.52 25.38L64.33 26.05L65.10 26.75L65.83 27.48L66.53 28.24L67.19 29.02L67.81 29.83L68.39 30.66L68.92 31.52L69.40 32.39L69.83 33.29L70.17 34.24L70.17 34.24L69.48 33.59L68.78 32.96L68.07 32.35L67.34 31.76L66.60 31.20L65.84 30.67L65.07 30.17L64.28 29.69L63.48 29.24L62.67 28.82L61.84 28.43L61.01 28.07L60.17 27.75L59.32 27.45L58.46 27.18L57.59 26.94L56.72 26.73L55.85 26.55L54.97 26.40L54.09 26.28L53.20 26.19L52.32 26.13L51.44 26.10L50.56 26.11L49.68 26.14L48.80 26.20L47.93 26.29L47.06 26.40L46.19 26.55L45.34 26.73L44.49 26.93L43.64 27.16L42.81 27.42L41.99 27.71L41.17 28.03L40.37 28.37L39.58 28.74L38.80 29.13L38.03 29.55L37.28 30.00L36.55 30.47L35.83 30.96L35.12 31.48L34.43 32.02L33.77 32.59L33.11 33.18L32.48 33.79L31.87 34.42L31.28 35.08L30.71 35.76L30.16 36.45L29.64 37.17L29.14 37.90L28.66 38.65L28.21 39.42L27.78 40.21L27.38 41.01L27.00 41.83L26.66 42.67L26.34 43.51L26.05 44.37L25.79 45.24L25.55 46.13L25.35 47.02L25.18 47.93L25.04 48.84L24.92 49.76L24.84 50.68L24.79 51.62L24.77 52.55L24.77 53.50L24.79 54.45Z";
const ARCH_UNDER_PATH =
  "M74.23 54.27L74.25 54.96L74.23 55.64L74.18 56.33L74.10 57.01L74.00 57.69L73.87 58.38L73.72 59.05L73.55 59.73L73.36 60.40L73.15 61.07L72.91 61.73L72.66 62.39L72.38 63.04L72.08 63.68L71.76 64.31L71.42 64.94L71.06 65.55L70.68 66.15L70.28 66.75L69.86 67.33L69.42 67.90L68.96 68.45L68.48 68.99L67.99 69.52L67.48 70.03L66.95 70.53L66.41 71.01L65.85 71.47L65.28 71.91L64.69 72.34L64.09 72.74L63.48 73.13L62.85 73.50L62.21 73.85L61.56 74.18L60.90 74.48L60.23 74.77L59.55 75.03L58.87 75.27L58.17 75.49L57.47 75.69L56.77 75.86L56.06 76.02L55.35 76.15L54.63 76.25L53.91 76.33L53.19 76.39L52.47 76.43L51.75 76.45L51.03 76.44L50.31 76.41L49.59 76.35L48.88 76.27L48.17 76.17L47.47 76.05L46.77 75.91L46.08 75.75L45.39 75.56L44.71 75.35L44.05 75.12L43.39 74.88L42.74 74.61L42.10 74.32L41.47 74.01L40.85 73.69L40.25 73.34L39.66 72.98L39.09 72.60L38.53 72.20L37.98 71.78L37.46 71.34L36.96 70.86L36.96 70.86L37.57 71.16L38.17 71.44L38.78 71.71L39.39 71.97L40.01 72.22L40.63 72.44L41.25 72.65L41.88 72.85L42.52 73.03L43.16 73.19L43.80 73.33L44.44 73.46L45.08 73.57L45.73 73.67L46.38 73.75L47.03 73.81L47.68 73.86L48.33 73.89L48.98 73.90L49.63 73.90L50.28 73.88L50.93 73.84L51.57 73.79L52.21 73.72L52.86 73.63L53.49 73.53L54.13 73.42L54.76 73.28L55.39 73.14L56.01 72.97L56.63 72.79L57.25 72.60L57.85 72.39L58.46 72.16L59.06 71.92L59.65 71.67L60.23 71.40L60.81 71.12L61.38 70.82L61.95 70.51L62.50 70.18L63.05 69.84L63.59 69.49L64.12 69.12L64.64 68.74L65.15 68.34L65.65 67.94L66.14 67.52L66.63 67.08L67.10 66.64L67.56 66.18L68.01 65.71L68.44 65.23L68.87 64.74L69.28 64.24L69.68 63.73L70.07 63.20L70.45 62.67L70.81 62.12L71.16 61.57L71.49 61.00L71.81 60.43L72.12 59.85L72.41 59.26L72.69 58.66L72.95 58.05L73.20 57.44L73.43 56.82L73.65 56.19L73.85 55.56L74.04 54.92L74.23 54.27Z";
const BAND_PATH =
  "M92.52 33.51L92.51 34.20L92.43 34.92L92.29 35.66L92.08 36.42L91.80 37.20L91.46 38.01L91.05 38.83L90.57 39.67L90.04 40.53L89.43 41.40L88.77 42.29L88.05 43.19L87.26 44.10L86.42 45.02L85.52 45.94L84.56 46.88L83.55 47.82L82.48 48.76L81.36 49.70L80.20 50.64L78.98 51.59L77.73 52.53L76.42 53.46L75.08 54.39L73.69 55.32L72.27 56.23L70.81 57.14L69.32 58.03L67.80 58.91L66.25 59.78L64.68 60.63L63.08 61.47L61.46 62.29L59.82 63.08L58.17 63.86L56.51 64.62L54.83 65.35L53.15 66.06L51.46 66.74L49.77 67.40L48.08 68.02L46.39 68.62L44.71 69.19L43.04 69.73L41.38 70.24L39.73 70.72L38.10 71.16L36.49 71.58L34.89 71.95L33.33 72.29L31.78 72.60L30.27 72.87L28.79 73.11L27.34 73.31L25.93 73.47L24.56 73.59L23.22 73.68L21.93 73.73L20.68 73.74L19.48 73.72L18.33 73.65L17.23 73.55L16.17 73.42L15.18 73.24L14.23 73.03L13.35 72.78L12.52 72.50L11.75 72.18L11.04 71.83L10.40 71.44L9.81 71.02L9.29 70.56L9.29 70.56L10.35 70.61L11.25 70.74L12.13 70.84L13.03 70.91L13.94 70.93L14.89 70.92L15.86 70.87L16.86 70.78L17.89 70.65L18.95 70.49L20.03 70.29L21.15 70.05L22.29 69.78L23.45 69.48L24.64 69.15L25.86 68.79L27.10 68.41L28.36 67.99L29.64 67.56L30.94 67.10L32.26 66.61L33.59 66.11L34.94 65.59L36.31 65.06L37.69 64.51L39.09 63.94L40.49 63.36L41.91 62.77L43.33 62.17L44.77 61.56L46.21 60.94L47.65 60.32L49.10 59.69L50.55 59.05L52.00 58.41L53.46 57.77L54.91 57.12L56.36 56.47L57.80 55.81L59.24 55.16L60.67 54.50L62.10 53.85L63.51 53.19L64.91 52.53L66.29 51.88L67.66 51.22L69.02 50.56L70.35 49.90L71.66 49.25L72.95 48.59L74.22 47.93L75.46 47.27L76.67 46.61L77.85 45.96L79.00 45.30L80.12 44.63L81.20 43.97L82.24 43.31L83.25 42.64L84.21 41.98L85.13 41.31L86.00 40.63L86.83 39.96L87.62 39.28L88.35 38.60L89.04 37.91L89.68 37.21L90.28 36.51L90.83 35.80L91.34 35.08L91.85 34.33L92.52 33.51Z";
/** Heavier band for the favicon cut — survives 16 px. */
const BAND_BOLD_PATH =
  "M94.50 34.51L94.41 35.32L94.25 36.15L94.04 36.99L93.76 37.86L93.41 38.74L93.01 39.64L92.54 40.56L92.01 41.48L91.43 42.42L90.78 43.37L90.07 44.33L89.31 45.30L88.49 46.28L87.62 47.26L86.69 48.24L85.71 49.23L84.68 50.22L83.60 51.20L82.47 52.19L81.30 53.17L80.08 54.15L78.82 55.12L77.51 56.09L76.17 57.04L74.79 57.99L73.37 58.92L71.92 59.84L70.44 60.75L68.93 61.64L67.39 62.52L65.83 63.38L64.25 64.22L62.64 65.04L61.02 65.83L59.38 66.61L57.73 67.36L56.06 68.08L54.39 68.78L52.71 69.46L51.03 70.10L49.35 70.72L47.67 71.30L45.99 71.86L44.31 72.39L42.65 72.88L40.99 73.34L39.35 73.77L37.72 74.16L36.11 74.52L34.52 74.84L32.96 75.13L31.41 75.38L29.90 75.60L28.41 75.78L26.95 75.92L25.53 76.02L24.14 76.09L22.79 76.12L21.48 76.11L20.20 76.07L18.97 75.99L17.79 75.87L16.65 75.72L15.56 75.52L14.52 75.29L13.52 75.03L12.58 74.73L11.70 74.39L10.87 74.02L10.09 73.62L9.37 73.18L8.71 72.71L8.71 72.71L10.48 72.25L11.66 72.20L12.75 72.16L13.82 72.12L14.88 72.06L15.94 71.98L17.01 71.86L18.10 71.72L19.20 71.55L20.31 71.35L21.45 71.12L22.60 70.86L23.77 70.58L24.95 70.27L26.16 69.94L27.37 69.58L28.61 69.20L29.86 68.80L31.13 68.38L32.40 67.94L33.70 67.48L35.00 67.01L36.32 66.52L37.64 66.01L38.98 65.49L40.33 64.96L41.68 64.42L43.04 63.86L44.41 63.30L45.78 62.73L47.16 62.14L48.54 61.55L49.92 60.96L51.30 60.36L52.68 59.75L54.07 59.14L55.45 58.52L56.83 57.90L58.20 57.27L59.57 56.64L60.93 56.01L62.28 55.38L63.63 54.74L64.96 54.10L66.28 53.46L67.59 52.82L68.89 52.18L70.17 51.53L71.43 50.88L72.68 50.23L73.90 49.58L75.11 48.93L76.29 48.27L77.45 47.61L78.58 46.95L79.69 46.29L80.77 45.62L81.82 44.95L82.85 44.28L83.84 43.60L84.80 42.91L85.73 42.22L86.62 41.53L87.49 40.82L88.32 40.11L89.12 39.39L89.90 38.66L90.65 37.91L91.40 37.15L92.15 36.36L92.98 35.52L94.50 34.51Z";

/** Shared defs: the disc temperature ramp and the Doppler tip highlight. */
function foldDefs(id: string): string {
  return `<defs>
    <radialGradient id="${id}-heat" gradientUnits="userSpaceOnUse" cx="50" cy="50" r="50">
      <stop offset="0" stop-color="${HOT}"/>
      <stop offset=".28" stop-color="${GOLD}"/>
      <stop offset=".5" stop-color="${AMBER}"/>
      <stop offset=".78" stop-color="${DEEP}"/>
      <stop offset="1" stop-color="${EMBER}"/>
    </radialGradient>
    <linearGradient id="${id}-beam" gradientUnits="userSpaceOnUse" x1="10" y1="50" x2="92" y2="50">
      <stop offset=".45" stop-color="${HOT}" stop-opacity="0"/>
      <stop offset=".95" stop-color="${HOT}" stop-opacity=".55"/>
    </linearGradient>
  </defs>`;
}

/** The fold geometry on a 100x100 box; defs id must match foldDefs(id). */
function foldBody(id: string): string {
  return `<path d="${ARCH_OVER_PATH}" fill="url(#${id}-heat)"/>
  <path d="${ARCH_UNDER_PATH}" fill="url(#${id}-heat)" opacity=".75"/>
  <circle cx="50" cy="50" r="22.6" fill="none" stroke="${HOT}" stroke-width="1.5"/>
  <circle cx="50" cy="50" r="20" fill="#050505"/>
  <path d="${BAND_PATH}" fill="url(#${id}-heat)"/>
  <path d="${BAND_PATH}" fill="url(#${id}-beam)"/>`;
}

export function getLogoMarkSvg(className = "parse-logo-mark", title?: string): string {
  const titleNode = title ? `<title>${escapeSvgText(title)}</title>` : "";
  return `<svg class="${className}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-hidden="${title ? "false" : "true"}" focusable="false">
  ${titleNode}
  ${foldDefs("pa-fold-mark")}
  ${foldBody("pa-fold-mark")}
</svg>`;
}

export function getLogoLockupSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 290 72" role="img" aria-labelledby="parse-logo-title">
  <title id="parse-logo-title">Parse</title>
  ${foldDefs("pa-fold-lockup")}
  <g transform="translate(4 2) scale(0.68)">
  ${foldBody("pa-fold-lockup")}
  </g>
  <text x="86" y="47" fill="${INK}" font-family="Saira, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif" font-size="32" font-weight="700" letter-spacing="2.5">Parse</text>
</svg>`;
}

export function getLogoIconSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 84 84">
  ${foldDefs("pa-fold-icon")}
  <rect width="84" height="84" rx="18" fill="#050506"/>
  <g transform="translate(3 3) scale(0.78)">
  ${foldBody("pa-fold-icon")}
  </g>
</svg>`;
}

/** Favicon cut: arches dropped, weights raised — ring + band + shadow reads
 *  at 16 px where the full fold would smear. */
export function getFaviconCutSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  ${foldDefs("pa-fold-fav")}
  <circle cx="50" cy="50" r="24.5" fill="none" stroke="${GOLD}" stroke-width="3.2"/>
  <circle cx="50" cy="50" r="19.5" fill="#050505"/>
  <path d="${BAND_BOLD_PATH}" fill="url(#pa-fold-fav-heat)"/>
</svg>`;
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
