/**
 * Curated catalog mapping capability categories onto the many names one
 * capability hides behind. An admin bans "browser" once; this file is what
 * makes that single rule catch `browser_use`, `playwright`, `computer_use`
 * and `mcp__claude-in-chrome__navigate` alike.
 *
 * The catalog is code, not data: it ships with tests, updates by pull request,
 * and needs no migration when a new MCP server gets popular.
 */

export interface ToolCategory {
  slug: string;
  label: string;
  description: string;
  /** Full tool names. Matched on normalized equality. */
  exact: string[];
  /** Name prefixes, e.g. "mcp__claude-in-chrome__". */
  prefixes: string[];
  /**
   * Substrings that on their own identify the capability. Keep these
   * high-signal — a loose substring here silently governs unrelated tools.
   */
  contains: string[];
}

/**
 * Lowercase, then collapse every separator style a tool name might use
 * (`mcp__claude-in-chrome__navigate`, `browser.navigate`, `Browser Use`) onto
 * a single `_`. Both sides of every comparison run through this, so a prefix
 * written with the vendor's spelling still matches the caller's spelling.
 */
export function normalizeToolName(name: string): string {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s\-./:]+/g, "_")
    .replace(/_+/g, "_");
}

export const TOOL_CATEGORIES: ToolCategory[] = [
  {
    slug: "browser",
    label: "Browser & computer use",
    description:
      "Driving a browser or the desktop: navigation, clicking, screenshots, and full computer use.",
    exact: [
      "browser",
      "browser_use",
      "browseruse",
      "web_browser",
      "headless_browser",
      "browserbase",
      "playwright",
      "puppeteer",
      "selenium",
      "webdriver",
      "chrome",
      "chromium",
      "firefox",
      "computer",
      "computer_use",
      "web_navigate",
      "navigate",
      "goto_url",
      "open_url",
      "screenshot",
      "take_screenshot",
      "click",
      "browse",
      "browse_web",
    ],
    prefixes: [
      "mcp__claude-in-chrome__",
      "mcp__browserbase__",
      "mcp__puppeteer__",
      "mcp__playwright__",
      "browser_",
      "chrome_",
    ],
    contains: ["browser", "playwright", "puppeteer", "selenium", "computer_use", "webdriver"],
  },
  {
    slug: "code_execution",
    label: "Code execution",
    description:
      "Running code or shell commands, whether sandboxed or on the host.",
    exact: [
      "bash",
      "sh",
      "zsh",
      "shell",
      "exec",
      "execute",
      "eval",
      "run",
      "run_code",
      "run_command",
      "run_script",
      "code_interpreter",
      "code_execution",
      "python",
      "python_repl",
      "node",
      "sandbox",
      "terminal",
      "subprocess",
      "docker",
      "kubectl",
    ],
    prefixes: ["mcp__code-sandbox__", "mcp__e2b__", "shell_", "sandbox_"],
    contains: ["code_interpreter", "code_execution", "python_repl", "run_command", "shell_exec"],
  },
  {
    slug: "email",
    label: "Email",
    description: "Reading, drafting, or sending mail.",
    exact: [
      "email",
      "gmail",
      "send_email",
      "read_email",
      "send_mail",
      "smtp",
      "imap",
      "outlook",
      "mailgun",
      "sendgrid",
      "postmark",
      "resend",
      "ses",
    ],
    prefixes: ["mcp__gmail__", "mcp__claude_ai_gmail__", "mcp__outlook__", "email_", "gmail_"],
    contains: ["gmail", "smtp", "send_email", "sendgrid", "mailgun", "send_mail"],
  },
  {
    slug: "filesystem",
    label: "Filesystem",
    description: "Reading, writing, or listing files on local or mounted storage.",
    exact: [
      "fs",
      "filesystem",
      "read_file",
      "write_file",
      "edit_file",
      "delete_file",
      "move_file",
      "copy_file",
      "create_file",
      "list_files",
      "list_directory",
      "file_search",
      "glob",
      "grep",
      "read",
      "write",
      "edit",
    ],
    prefixes: ["mcp__filesystem__", "file_", "fs_"],
    contains: ["read_file", "write_file", "filesystem", "list_directory", "delete_file"],
  },
  {
    slug: "payments",
    label: "Payments & funds movement",
    description: "Charging cards, moving money, or touching wallets and ledgers.",
    exact: [
      "stripe",
      "payment",
      "make_payment",
      "create_payment",
      "create_charge",
      "refund",
      "create_refund",
      "payout",
      "transfer",
      "wire",
      "wallet",
      "paypal",
      "square",
      "plaid",
      "mercury",
      "coinbase",
      "invoice",
      "checkout",
      "x402",
    ],
    prefixes: ["mcp__stripe__", "mcp__plugin_stripe_stripe__", "mcp__paypal__", "stripe_", "payment_"],
    // "checkout" is deliberately absent — it would capture `git checkout` tools.
    contains: ["stripe", "paypal", "payment", "payout", "refund"],
  },
  {
    slug: "messaging",
    label: "Messaging & chat",
    description: "Sending messages into chat platforms, SMS, or push channels.",
    exact: [
      "slack",
      "discord",
      "telegram",
      "signal",
      "whatsapp",
      "sms",
      "send_sms",
      "send_message",
      "post_message",
      "twilio",
      "teams",
      "matrix",
      "mattermost",
      "zulip",
      "intercom",
      "push_notification",
    ],
    prefixes: ["mcp__slack__", "mcp__discord__", "mcp__telegram__", "slack_", "discord_"],
    contains: ["slack", "discord", "telegram", "whatsapp", "twilio", "send_sms"],
  },
  {
    slug: "cloud_storage",
    label: "Cloud storage",
    description: "Object stores and hosted drives holding company documents.",
    exact: [
      "s3",
      "gcs",
      "gdrive",
      "google_drive",
      "dropbox",
      "onedrive",
      "sharepoint",
      "box",
      "blob_storage",
      "azure_blob",
      "cloud_storage",
      "upload_file",
      "download_file",
    ],
    prefixes: [
      "mcp__google-drive__",
      "mcp__claude_ai_google_drive__",
      "mcp__s3__",
      "mcp__dropbox__",
      "s3_",
      "gdrive_",
    ],
    contains: ["google_drive", "gdrive", "dropbox", "onedrive", "sharepoint", "azure_blob"],
  },
  {
    slug: "database",
    label: "Database",
    description: "Querying or mutating databases and warehouses directly.",
    exact: [
      "sql",
      "query",
      "execute_sql",
      "run_query",
      "database",
      "db_query",
      "postgres",
      "postgresql",
      "mysql",
      "sqlite",
      "mongodb",
      "mongo",
      "redis",
      "supabase",
      "bigquery",
      "snowflake",
      "clickhouse",
      "prisma",
    ],
    prefixes: ["mcp__postgres__", "mcp__supabase__", "mcp__plugin_supabase_supabase__", "sql_", "db_"],
    contains: ["execute_sql", "postgres", "mysql", "mongodb", "supabase", "bigquery", "snowflake"],
  },
  {
    slug: "network",
    label: "Network & outbound HTTP",
    description: "Arbitrary outbound requests: HTTP calls, webhooks, and raw sockets.",
    exact: [
      "http",
      "http_request",
      "https_request",
      "fetch",
      "fetch_url",
      "curl",
      "request",
      "webhook",
      "send_webhook",
      "api_call",
      "web_fetch",
      "web_search",
      "socket",
      "ssh",
      "ftp",
    ],
    prefixes: ["mcp__fetch__", "mcp__http__", "http_", "webhook_"],
    contains: ["http_request", "fetch_url", "send_webhook", "api_call", "web_fetch"],
  },
];

const CATEGORIES_BY_SLUG = new Map(TOOL_CATEGORIES.map((c) => [c.slug, c]));

// Patterns are normalized once at module load; tool names are normalized per
// call. Comparing raw strings on either side is always a bug.
const NORMALIZED = new Map(
  TOOL_CATEGORIES.map((c) => [
    c.slug,
    {
      exact: new Set(c.exact.map(normalizeToolName)),
      prefixes: c.prefixes.map(normalizeToolName).filter((p) => p.length > 0),
      contains: c.contains.map(normalizeToolName).filter((s) => s.length > 0),
    },
  ]),
);

export function getCategory(slug: string): ToolCategory | undefined {
  return CATEGORIES_BY_SLUG.get(normalizeToolName(slug));
}

export function toolMatchesCategory(name: string, slug: string): boolean {
  const entry = NORMALIZED.get(normalizeToolName(slug));
  if (!entry) return false;
  const tool = normalizeToolName(name);
  if (!tool) return false;
  if (entry.exact.has(tool)) return true;
  if (entry.prefixes.some((p) => tool.startsWith(p))) return true;
  return entry.contains.some((s) => tool.includes(s));
}

/** Every category slug the tool belongs to. A tool may span several. */
export function categoriesForTool(name: string): string[] {
  return TOOL_CATEGORIES.filter((c) => toolMatchesCategory(name, c.slug)).map((c) => c.slug);
}
