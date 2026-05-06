const PARSE_TEXT = "#111827";
const PARSE_BLUE = "#0b66ff";
const PARSE_CYAN = "#06b6d4";
const PARSE_VIOLET = "#6d5dfc";

export function getLogoMarkSvg(className = "parse-logo-mark", title?: string): string {
  const titleNode = title ? `<title>${escapeSvgText(title)}</title>` : "";
  return `<svg class="${className}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 44" role="img" aria-hidden="${title ? "false" : "true"}" focusable="false">
  ${titleNode}
  <circle cx="12" cy="24" r="5.6" fill="${PARSE_TEXT}"/>
  <rect x="26" y="11" width="11" height="27" rx="5.5" fill="${PARSE_TEXT}"/>
  <rect x="42" y="4" width="12" height="36" rx="6" fill="${PARSE_BLUE}"/>
  <rect x="60" y="12" width="11" height="24" rx="5.5" fill="${PARSE_VIOLET}"/>
  <circle cx="81" cy="22" r="5.2" fill="${PARSE_TEXT}"/>
</svg>`;
}

export function getLogoLockupSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 290 72" role="img" aria-labelledby="parse-logo-title">
  <title id="parse-logo-title">Parse</title>
  <circle cx="24" cy="39" r="9" fill="${PARSE_TEXT}"/>
  <rect x="47" y="20" width="16" height="39" rx="8" fill="${PARSE_TEXT}"/>
  <rect x="72" y="10" width="18" height="52" rx="9" fill="${PARSE_BLUE}"/>
  <rect x="101" y="22" width="16" height="35" rx="8" fill="${PARSE_VIOLET}"/>
  <circle cx="133" cy="36" r="8.5" fill="${PARSE_TEXT}"/>
  <text x="162" y="49" fill="${PARSE_TEXT}" font-family="DM Sans, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif" font-size="44" font-weight="760" letter-spacing="0">Parse</text>
</svg>`;
}

export function getLogoIconSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 84 84">
  <rect width="84" height="84" rx="18" fill="#ffffff"/>
  <circle cx="16" cy="46" r="6.5" fill="${PARSE_TEXT}"/>
  <rect x="29" y="26" width="11" height="34" rx="5.5" fill="${PARSE_TEXT}"/>
  <rect x="43" y="16" width="12" height="48" rx="6" fill="${PARSE_BLUE}"/>
  <rect x="59" y="29" width="10.5" height="30" rx="5.25" fill="${PARSE_VIOLET}"/>
  <circle cx="73" cy="42" r="5.8" fill="${PARSE_CYAN}"/>
</svg>`;
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
