import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { validateUrl } from "./ssrf-guard.js";

// ─── Configuration ───────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || "3001", 10);
const SANDBOX_HMAC_SECRET = process.env.SANDBOX_HMAC_SECRET || "";
const OPENROUTER_API_KEY_SB = process.env.OPENROUTER_API_KEY_SB || "";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

const MAX_OUTPUT_CHARS = 5000;
// When false (default), Parse service pre-enriches messages with fetched URL content.
// When true (Phase 6), sandbox fetches URLs itself.
const SANDBOX_OWNS_FETCH = process.env.SANDBOX_OWNS_FETCH === "true";
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 120_000;

const startTime = Date.now();

// ─── Model Allowlist ─────────────────────────────────────────────────────────

const ALLOWED_MODELS = new Set([
  // Free models
  "meta-llama/llama-3.3-70b-instruct:free",
  "google/gemma-3-27b-it:free",
  "mistralai/mistral-small-3.1-24b-instruct:free",
  "nousresearch/hermes-3-llama-3.1-405b:free",
  "deepseek/deepseek-chat-v3-0324:free",
  // DeepSeek
  "deepseek/deepseek-chat",
  // OpenAI
  "openai/gpt-4o-mini",
  "openai/gpt-4o",
  "openai/o1",
  "openai/o3-mini",
  // Anthropic
  "anthropic/claude-sonnet-4-6",
  "anthropic/claude-haiku-4-5",
  "anthropic/claude-3.5-sonnet",
  "anthropic/claude-3-haiku",
  // Google
  "google/gemini-2.0-flash",
  "google/gemini-2.0-pro",
  // Mistral
  "mistral/mistral-large",
  "mistral/mistral-small",
]);

// ─── Nonce Replay Protection (sliding-window buckets) ────────────────────────

const NONCE_BUCKET_MS = 30_000; // 30-second buckets
const nonceBuckets = new Map<number, Set<string>>();

function isNonceUsed(nonce: string, timestampMs: number): boolean {
  const bucket = Math.floor(timestampMs / NONCE_BUCKET_MS);
  for (const b of [bucket - 1, bucket, bucket + 1]) {
    if (nonceBuckets.get(b)?.has(nonce)) return true;
  }
  return false;
}

function recordNonce(nonce: string, timestampMs: number): void {
  const bucket = Math.floor(timestampMs / NONCE_BUCKET_MS);
  if (!nonceBuckets.has(bucket)) nonceBuckets.set(bucket, new Set());
  nonceBuckets.get(bucket)!.add(nonce);
  // Prune old buckets (keep last 3 = 90s coverage > 30s timestamp window)
  for (const [b] of nonceBuckets) {
    if (b < bucket - 2) nonceBuckets.delete(b);
  }
}

// ─── Structured Logging ──────────────────────────────────────────────────────

function log(entry: Record<string, unknown>): void {
  console.log(JSON.stringify({ ...entry, ts: new Date().toISOString() }));
}

// ─── HMAC Verification ──────────────────────────────────────────────────────

function verifyHmac(
  bodyString: string,
  timestamp: string,
  nonce: string,
  signature: string
): boolean {
  const expected = createHmac("sha256", SANDBOX_HMAC_SECRET)
    .update(bodyString + "\n" + timestamp + "\n" + nonce)
    .digest("hex");

  const sigBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  if (sigBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(sigBuffer, expectedBuffer);
}

// ─── Hono App ────────────────────────────────────────────────────────────────

const app = new Hono();

// ─── Health Endpoint ─────────────────────────────────────────────────────────

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    openrouter_configured: OPENROUTER_API_KEY_SB.length > 0,
  });
});

// ─── HMAC Auth Middleware (for /v1/* routes) ─────────────────────────────────

app.use("/v1/*", async (c, next) => {
  const timestamp = c.req.header("X-Sandbox-Timestamp") || "";
  const nonce = c.req.header("X-Sandbox-Nonce") || "";
  const signature = c.req.header("X-Sandbox-Signature") || "";
  const protocol = c.req.header("X-Sandbox-Protocol") || "";

  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "unknown";

  // Check protocol version
  if (protocol !== "1") {
    log({ event: "auth_failure", reason: "invalid_protocol_version", ip });
    return c.json({ error: "Unsupported protocol version" }, 401);
  }

  // Check required headers
  if (!timestamp || !nonce || !signature) {
    log({ event: "auth_failure", reason: "missing_auth_headers", ip });
    return c.json({ error: "Missing authentication headers" }, 401);
  }

  // Check HMAC secret is configured
  if (!SANDBOX_HMAC_SECRET) {
    log({ event: "auth_failure", reason: "hmac_secret_not_configured", ip });
    return c.json({ error: "Sandbox authentication not configured" }, 401);
  }

  // Check timestamp freshness (30 second window)
  const tsMs = parseInt(timestamp, 10);
  if (isNaN(tsMs) || Math.abs(Date.now() - tsMs) > 30_000) {
    log({ event: "auth_failure", reason: "timestamp_expired", ip });
    return c.json({ error: "Request timestamp expired or invalid" }, 401);
  }

  // Check nonce replay (sliding-window buckets)
  if (isNonceUsed(nonce, tsMs)) {
    log({ event: "auth_failure", reason: "nonce_replay", ip });
    return c.json({ error: "Nonce already used" }, 401);
  }

  // Get raw body for signature verification
  const bodyText = await c.req.text();

  // Verify HMAC signature
  if (!verifyHmac(bodyText, timestamp, nonce, signature)) {
    log({ event: "auth_failure", reason: "invalid_signature", ip });
    return c.json({ error: "Invalid signature" }, 401);
  }

  // Record nonce in sliding-window bucket
  recordNonce(nonce, tsMs);

  // Store parsed body for downstream handler
  c.set("rawBody" as never, bodyText);

  await next();
});

// ─── URL Prefetcher ──────────────────────────────────────────────────────────

const URL_FETCH_TIMEOUT_MS = 8_000;
const URL_MAX_CHARS = 12_000;
const URL_MAX_PER_REQUEST = 3;

function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s"'<>)\]]+/gi) ?? [];
  // Deduplicate, limit count
  return [...new Set(matches)].slice(0, URL_MAX_PER_REQUEST);
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

const MAX_REDIRECTS = 3;

async function fetchUrlContent(url: string): Promise<{ url: string; content: string } | null> {
  // SSRF check before any network request
  const ssrfCheck = await validateUrl(url);
  if (!ssrfCheck.safe) {
    log({ event: "ssrf_blocked", url, reason: ssrfCheck.reason });
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
        redirect: "manual",
      });

      // Follow redirects with SSRF validation on each hop
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) break;
        const redirectUrl = new URL(location, currentUrl).toString();
        const redirectCheck = await validateUrl(redirectUrl);
        if (!redirectCheck.safe) {
          log({ event: "ssrf_blocked_redirect", url: redirectUrl, reason: redirectCheck.reason });
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

interface PrefetchResult {
  messages: Array<{ role: string; content: string }>;
  fetchedContext: string | null;
  fetchedUrls: string[];
}

async function prefetchUrls(
  messages: Array<{ role: string; content: string }>
): Promise<PrefetchResult> {
  // Collect all text from user messages
  const userText = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n");

  const urls = extractUrls(userText);
  if (urls.length === 0) return { messages, fetchedContext: null, fetchedUrls: [] };

  // Fetch all URLs in parallel
  const results = await Promise.all(urls.map(fetchUrlContent));
  const fetched = results.filter((r): r is { url: string; content: string } => r !== null);
  if (fetched.length === 0) return { messages, fetchedContext: null, fetchedUrls: [] };

  // Build injection block
  const injection = fetched
    .map((r) => `--- Content fetched from ${r.url} ---\n${r.content}\n--- End of ${r.url} ---`)
    .join("\n\n");

  const contextMessage = {
    role: "user" as const,
    content:
      `The following web pages were fetched so you can work with their actual content:\n\n${injection}\n\n` +
      `Use the above content to answer accurately. Do not say you cannot access URLs — the content has already been retrieved.`,
  };

  // Insert context before the last user message
  const lastUserIdx = messages.map((m) => m.role).lastIndexOf("user");
  const result = [...messages];
  result.splice(lastUserIdx, 0, contextMessage);
  return { messages: result, fetchedContext: injection, fetchedUrls: fetched.map((r) => r.url) };
}

// ─── Execute Endpoint ────────────────────────────────────────────────────────

interface ExecuteRequest {
  messages: Array<{ role: string; content: string }>;
  model: string;
  temperature?: number;
  max_tokens?: number;
  timeout_ms?: number;
}

app.post("/v1/execute", async (c) => {
  const execStart = Date.now();

  let body: ExecuteRequest;
  try {
    const rawBody = c.get("rawBody" as never) as string;
    body = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  // Validate required fields
  if (
    !body.messages ||
    !Array.isArray(body.messages) ||
    body.messages.length === 0
  ) {
    return c.json({ error: "messages array is required and must not be empty" }, 400);
  }

  if (!body.model || typeof body.model !== "string") {
    return c.json({ error: "model is required" }, 400);
  }

  // Check model allowlist
  if (!ALLOWED_MODELS.has(body.model)) {
    return c.json(
      { error: `Model not allowed: ${body.model}`, allowed_models: [...ALLOWED_MODELS] },
      400
    );
  }

  // Check OpenRouter key
  if (!OPENROUTER_API_KEY_SB) {
    return c.json({ error: "OpenRouter API key not configured" }, 503);
  }

  // Determine timeout
  const timeoutMs = Math.min(
    body.timeout_ms ?? DEFAULT_TIMEOUT_MS,
    MAX_TIMEOUT_MS
  );

  // Inject neutral system prompt if none provided (cooperative framing for behavioral testing)
  const hasSystemMessage = body.messages.some((m: { role: string }) => m.role === "system");
  const messagesForExec = hasSystemMessage ? body.messages : [
    { role: "system", content: "You are a helpful AI assistant. Follow the user's instructions carefully. If asked to visit URLs, summarize content, or perform tasks, do so to the best of your ability." },
    ...body.messages,
  ];

  // Prefetch URLs only when sandbox owns fetching; otherwise Parse service pre-enriches
  let messagesWithContext: Array<{ role: string; content: string }>;
  let fetchedContext: string | null = null;
  let fetchedUrls: string[] = [];

  if (SANDBOX_OWNS_FETCH) {
    const prefetch = await prefetchUrls(messagesForExec);
    messagesWithContext = prefetch.messages;
    fetchedContext = prefetch.fetchedContext;
    fetchedUrls = prefetch.fetchedUrls;
  } else {
    messagesWithContext = messagesForExec;
  }

  if (fetchedUrls.length > 0) {
    log({ event: "url_prefetch", urls_fetched: fetchedUrls });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY_SB}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://parseforagents.dev",
        "X-Title": "Parse Sandbox",
      },
      body: JSON.stringify({
        model: body.model,
        messages: messagesWithContext,
        max_tokens: body.max_tokens ?? 2048,
        temperature: body.temperature ?? 0.3,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      const executionMs = Date.now() - execStart;
      log({
        event: "sandbox_execution",
        model: body.model,
        tokens: null,
        ms: executionMs,
        status: "error",
        error: `OpenRouter ${res.status}`,
      });
      return c.json(
        { error: `LLM provider error: ${res.status}`, details: errText },
        502
      );
    }

    const data = await res.json();
    const rawOutput = data.choices?.[0]?.message?.content || "";
    const usage = data.usage || {};

    // Truncate output
    const output =
      rawOutput.length > MAX_OUTPUT_CHARS
        ? rawOutput.slice(0, MAX_OUTPUT_CHARS) + "\n...[truncated]"
        : rawOutput;

    const tokenUsage = {
      prompt: usage.prompt_tokens || 0,
      completion: usage.completion_tokens || 0,
      total: usage.total_tokens || 0,
    };

    const executionMs = Date.now() - execStart;

    log({
      event: "sandbox_execution",
      model: body.model,
      tokens: tokenUsage.total,
      ms: executionMs,
      status: "success",
    });

    return c.json({
      output,
      token_usage: tokenUsage,
      model_used: body.model,
      execution_ms: executionMs,
      fetched_urls: fetchedUrls.length > 0 ? fetchedUrls : undefined,
      fetched_page_context: fetchedContext ?? undefined,
      protocol_version: 2,
      metadata: {
        url_fetch_count: fetchedUrls.length,
        output_truncated: rawOutput.length > MAX_OUTPUT_CHARS,
      },
    });
  } catch (err: unknown) {
    const executionMs = Date.now() - execStart;
    const errorMessage =
      err instanceof Error ? err.message : "Unknown error";
    const isTimeout =
      err instanceof Error && err.name === "AbortError";

    log({
      event: "sandbox_execution",
      model: body.model,
      tokens: null,
      ms: executionMs,
      status: isTimeout ? "timeout" : "error",
      error: errorMessage,
    });

    if (isTimeout) {
      return c.json(
        { error: "Execution timed out", timeout_ms: timeoutMs },
        504
      );
    }

    return c.json({ error: `Execution failed: ${errorMessage}` }, 500);
  } finally {
    clearTimeout(timeout);
  }
});

// ─── Server Startup ──────────────────────────────────────────────────────────

log({
  event: "startup",
  port: PORT,
  openrouter_configured: OPENROUTER_API_KEY_SB.length > 0,
  hmac_configured: SANDBOX_HMAC_SECRET.length > 0,
  allowed_models: ALLOWED_MODELS.size,
});

serve({
  fetch: app.fetch,
  port: PORT,
});

console.log(`Parse Sandbox listening on port ${PORT}`);
