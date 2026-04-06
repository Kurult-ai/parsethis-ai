import { createHmac, randomUUID } from "node:crypto";
import { validateUrl } from "./ssrf-guard.js";

// ─── URL Prefetch (inject real page content before LLM sees prompt) ──────────

const URL_FETCH_TIMEOUT_MS = 8_000;
const URL_MAX_CHARS = 12_000;
const URL_MAX_PER_REQUEST = 3;
const MAX_REDIRECTS = 3;

function extractUrls(text: string): string[] {
  // Explicit http/https URLs
  const explicit = text.match(/https?:\/\/[^\s"'<>)\]]+/gi) ?? [];

  // Bare domain URLs like canar.ai/company/NVDA or example.com/path
  const bare = text.match(
    /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|io|ai|org|net|dev|app|co|xyz|info|tech|us|uk|eu|gov|edu)\b(?:\/[^\s"'<>)\]]*)?/gi
  ) ?? [];

  const all = [
    ...explicit,
    ...bare.filter((u) => !u.startsWith("http")).map((u) => `https://${u}`),
  ];

  return [...new Set(all)].slice(0, URL_MAX_PER_REQUEST);
}

function stripHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")          // Strip HTML comments (injection vector)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function fetchUrlContent(url: string): Promise<{ url: string; content: string } | null> {
  // SSRF check before any network request
  const ssrfCheck = await validateUrl(url);
  if (!ssrfCheck.safe) {
    console.warn(`[ssrf-guard] Blocked URL: ${url} — ${ssrfCheck.reason}`);
    return null;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), URL_FETCH_TIMEOUT_MS);
  try {
    let currentUrl = url;
    let redirectCount = 0;

    while (redirectCount <= MAX_REDIRECTS) {
      const res = await fetch(currentUrl, {
        signal: ctrl.signal,
        headers: { "User-Agent": "ParseSandbox/1.0 (security-analysis-bot)" },
        redirect: "manual",  // Handle redirects manually to validate each target
      });

      // Follow redirects with SSRF validation on each hop
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) break;
        const redirectUrl = new URL(location, currentUrl).toString();
        const redirectCheck = await validateUrl(redirectUrl);
        if (!redirectCheck.safe) {
          console.warn(`[ssrf-guard] Blocked redirect to: ${redirectUrl} — ${redirectCheck.reason}`);
          return null;
        }
        currentUrl = redirectUrl;
        redirectCount++;
        continue;
      }

      if (!res.ok) return null;
      const ct = res.headers.get("content-type") ?? "";
      const raw = await res.text();
      const text = ct.includes("html") ? stripHtml(raw) : raw;
      return { url, content: text.slice(0, URL_MAX_CHARS) };
    }
    return null; // Max redirects exceeded
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function prefetchUrls(
  messages: Array<{ role: string; content: string }>
): Promise<{ messages: Array<{ role: string; content: string }>; fetchedContext: string | null; fetchedUrls: string[] }> {
  const userText = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n");

  const urls = extractUrls(userText);
  if (urls.length === 0) return { messages, fetchedContext: null, fetchedUrls: [] };

  const results = await Promise.all(urls.map(fetchUrlContent));
  const fetched = results.filter((r): r is { url: string; content: string } => r !== null);
  if (fetched.length === 0) return { messages, fetchedContext: null, fetchedUrls: [] };

  const injection = fetched
    .map((r) => `--- Content fetched from ${r.url} ---\n${r.content}\n--- End of ${r.url} ---`)
    .join("\n\n");

  const contextMessage = {
    role: "user" as const,
    content:
      `The following web pages were fetched so you can work with their actual content:\n\n${injection}\n\n` +
      `Use the above content to answer accurately. Do not say you cannot access URLs — the content has already been retrieved.`,
  };

  const lastUserIdx = messages.map((m) => m.role).lastIndexOf("user");
  const result = [...messages];
  result.splice(lastUserIdx, 0, contextMessage);
  return { messages: result, fetchedContext: injection, fetchedUrls: fetched.map((r) => r.url) };
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AgentConfig {
  model: string;          // required: e.g., "anthropic/claude-sonnet-4-6"
  temperature?: number;   // default 0.7
  max_tokens?: number;    // default 2048
  agent_role?: string;    // optional: "customer service agent" (NOT system_prompt)
}

export interface SandboxResult {
  output: string;
  token_usage: { prompt: number; completion: number; total: number };
  model_used: string;
  execution_ms: number;
  fetched_page_context?: string; // raw fetched content injected into LLM context
  fetched_urls?: string[];       // which URLs were actually fetched
}

export type SandboxOutcome =
  | { status: "executed"; isolated: true; result: SandboxResult }
  | { status: "fallback"; isolated: false; result: SandboxResult }
  | { status: "unavailable"; isolated: false; result: null };

// ─── Environment Checks ────────────────────────────────────────────────────

export function canUseSandbox(): boolean {
  return !!(process.env.SANDBOX_URL && process.env.SANDBOX_HMAC_SECRET);
}

// isFallbackAllowed removed — unisolated execution is never allowed (security hardening)

// ─── HMAC Signing ──────────────────────────────────────────────────────────

function signRequest(body: string, timestamp: string, nonce: string): string {
  const payload = `${body}\n${timestamp}\n${nonce}`;
  return createHmac("sha256", process.env.SANDBOX_HMAC_SECRET!)
    .update(payload)
    .digest("hex");
}

// ─── Sandbox Execution ─────────────────────────────────────────────────────

export async function executeInSandbox(
  prompt: string,
  testInput: string | undefined,
  agentConfig: AgentConfig
): Promise<SandboxResult> {
  const sandboxUrl = process.env.SANDBOX_URL!;

  // Build messages array
  const messages: Array<{ role: string; content: string }> = [];

  // Use agent_role to construct a generic system message (NOT the agent's actual system prompt)
  if (agentConfig.agent_role) {
    const sanitized = agentConfig.agent_role
      .replace(/[\n\r\x0B\x0C\x85\u2028\u2029]/g, " ")  // Strip ALL line separators
      .replace(/[^\w \t.,!?()-]/g, "")  // Explicit space+tab, not \s (VT/FF leak via \s)
      .slice(0, 200);
    messages.push({
      role: "system",
      content: `You are a ${sanitized}.`,
    });
  }

  if (testInput) {
    messages.push({ role: "system", content: prompt });
    messages.push({ role: "user", content: testInput });
  } else {
    messages.push({ role: "user", content: prompt });
  }

  // Prefetch URLs found in user messages so the LLM sees actual page content
  const { messages: messagesWithContext, fetchedContext, fetchedUrls } = await prefetchUrls(messages);

  const requestBody = JSON.stringify({
    messages: messagesWithContext,
    model: agentConfig.model,
    temperature: agentConfig.temperature ?? 0.7,
    max_tokens: agentConfig.max_tokens ?? 2048,
    timeout_ms: 90_000, // 90s for sandbox execution
  });

  const timestamp = String(Date.now());
  const nonce = randomUUID();
  const signature = signRequest(requestBody, timestamp, nonce);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 100_000); // 100s total

  try {
    const res = await fetch(`${sandboxUrl}/v1/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sandbox-Timestamp": timestamp,
        "X-Sandbox-Nonce": nonce,
        "X-Sandbox-Signature": signature,
        "X-Sandbox-Protocol": "1",
      },
      body: requestBody,
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Sandbox error ${res.status}: ${errText}`);
    }

    const result = await res.json() as SandboxResult;
    if (fetchedContext) result.fetched_page_context = fetchedContext;
    if (fetchedUrls.length > 0) result.fetched_urls = fetchedUrls;
    return result;
  } finally {
    clearTimeout(timeout);
  }
}
