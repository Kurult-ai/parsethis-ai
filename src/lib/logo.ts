const PARSE_TEXT = "#111827";
const PARSE_BLUE = "#0b66ff";

export function getLogoMarkSvg(className = "parse-logo-mark", title?: string): string {
  const titleNode = title ? `<title>${escapeSvgText(title)}</title>` : "";
  return `<svg class="${className}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 84 34" role="img" aria-hidden="${title ? "false" : "true"}" focusable="false">
  ${titleNode}
  <path d="M27 7L13 21L27 29" fill="none" stroke="${PARSE_TEXT}" stroke-width="5.2" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="36" cy="21" r="2.8" fill="${PARSE_TEXT}"/>
  <circle cx="43" cy="21" r="2.8" fill="${PARSE_TEXT}"/>
  <circle cx="50" cy="21" r="2.8" fill="${PARSE_TEXT}"/>
  <path d="M57 7L71 21L57 29" fill="none" stroke="${PARSE_BLUE}" stroke-width="5.2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

export function getLogoLockupSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 290 72" role="img" aria-labelledby="parse-logo-title">
  <title id="parse-logo-title">Parse</title>
  <path d="M45 15L16 36L45 57" fill="none" stroke="${PARSE_TEXT}" stroke-width="8.5" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="64" cy="36" r="4.6" fill="${PARSE_TEXT}"/>
  <circle cx="78" cy="36" r="4.6" fill="${PARSE_TEXT}"/>
  <circle cx="92" cy="36" r="4.6" fill="${PARSE_TEXT}"/>
  <path d="M111 15L140 36L111 57" fill="none" stroke="${PARSE_BLUE}" stroke-width="8.5" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="166" y="49" fill="${PARSE_TEXT}" font-family="DM Sans, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif" font-size="44" font-weight="760" letter-spacing="0">Parse</text>
</svg>`;
}

export function getLogoIconSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 84 84">
  <rect width="84" height="84" rx="18" fill="#ffffff"/>
  <path d="M29 24L16 42L29 60" fill="none" stroke="${PARSE_TEXT}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="38" cy="42" r="3.2" fill="${PARSE_TEXT}"/>
  <circle cx="45" cy="42" r="3.2" fill="${PARSE_TEXT}"/>
  <circle cx="52" cy="42" r="3.2" fill="${PARSE_TEXT}"/>
  <path d="M58 24L71 42L58 60" fill="none" stroke="${PARSE_BLUE}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
