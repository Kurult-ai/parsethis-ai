import { createHmac, randomUUID } from "node:crypto";

// ─── URL Prefetch (inject real page content before LLM sees prompt) ──────────

const URL_FETCH_TIMEOUT_MS = 8_000;
const URL_MAX_CHARS = 12_000;
const URL_MAX_PER_REQUEST = 3;

function extractUrls(text: string): string[] {
  // Explicit http/https URLs
  const explicit = text.match(/https?:\/\/[^\s"'<>)\]]+/gi) ?? [];

  // Bare domain URLs like canar.ai/company/NVDA or example.com/path
  // Match domain.tld patterns with common TLDs, optionally followed by a path
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
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), URL_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "ParseSandbox/1.0 (security-analysis-bot)" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    const raw = await res.text();
    const text = ct.includes("html") ? stripHtml(raw) : raw;
    return { url, content: text.slice(0, URL_MAX_CHARS) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function prefetchUrls(
  messages: Array<{ role: string; content: string }>
): Promise<Array<{ role: string; content: string }>> {
  const userText = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n");

  const urls = extractUrls(userText);
  if (urls.length === 0) return messages;

  const results = await Promise.all(urls.map(fetchUrlContent));
  const fetched = results.filter((r): r is { url: string; content: string } => r !== null);
  if (fetched.length === 0) return messages;

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
  return result;
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
}

export type SandboxOutcome =
  | { status: "executed"; isolated: true; result: SandboxResult }
  | { status: "fallback"; isolated: false; result: SandboxResult }
  | { status: "unavailable"; isolated: false; result: null };

// ─── Environment Checks ────────────────────────────────────────────────────

export function canUseSandbox(): boolean {
  return !!(process.env.SANDBOX_URL && process.env.SANDBOX_HMAC_SECRET);
}

export function isFallbackAllowed(): boolean {
  return process.env.ALLOW_UNISOLATED_EXECUTION === "true";
}

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
    messages.push({
      role: "system",
      content: `You are a ${agentConfig.agent_role}.`,
    });
  }

  if (testInput) {
    messages.push({ role: "system", content: prompt });
    messages.push({ role: "user", content: testInput });
  } else {
    messages.push({ role: "user", content: prompt });
  }

  // Prefetch URLs found in user messages so the LLM sees actual page content
  const messagesWithContext = await prefetchUrls(messages);

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

    return await res.json() as SandboxResult;
  } finally {
    clearTimeout(timeout);
  }
}
