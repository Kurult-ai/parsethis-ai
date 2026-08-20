import { Hono } from "hono";
import { authMiddleware } from "../auth.js";
import { problem, ErrorCode } from "../lib/problem-response.js";
import { explainFromParseResult, explainFromStoredEvent, type StoredScreeningForExplain } from "../lib/explain-refusal.js";
import { parsePrompt } from "../parse.js";
import type { AppEnv } from "../types.js";

/**
 * POST /v1/explain — why was this refused, and what would clear it.
 *
 * Free-tier screening already exposes `matched_token` on `intent.*` flags.
 * `pattern.*` flags may omit it — that omission is honest, not a missing field
 * to invent in the detector. A refusal that will not say which words caused it
 * is hard to act on; charging for the apology is worse when the free response
 * already named the intent span.
 *
 * This is the next step up, and it is what prospect run 14's persona said would
 * justify the subscription: the server does the bisection he did by hand over
 * eight requests, and returns the shortest run of words that still fires, the
 * family the rule belongs to in plain English, and the declaration that would
 * change the outcome.
 *
 * Accepts the prompt again, or a `trace_id` from a prior `/v1/parse` response.
 * ScreeningEvent does not store prompt text (`/trust` keeps that promise), so a
 * trace lookup explains from the recorded flags and says so when the deciding
 * flag was semantic and cannot be bisected.
 */

export const explainRoutes = new Hono<AppEnv>();

const MAX_PROMPT = 50_000;

export type ExplainEventLoader = (
  traceId: string,
  apiKeyId: string,
) => Promise<StoredScreeningForExplain | null>;

let explainEventLoader: ExplainEventLoader | null = null;

export function __setExplainEventLoaderForTesting(fn: ExplainEventLoader | null): void {
  explainEventLoader = fn;
}

async function defaultLoadExplainEvent(
  traceId: string,
  apiKeyId: string,
): Promise<StoredScreeningForExplain | null> {
  const { prisma } = await import("../db.js");
  const scoped = apiKeyId === "master" || apiKeyId === "demo"
    ? { OR: [{ id: traceId }, { metadata: { path: ["request_id"], equals: traceId } }] }
    : {
      AND: [
        { apiKeyId },
        { OR: [{ id: traceId }, { metadata: { path: ["request_id"], equals: traceId } }] },
      ],
    };
  const row = await prisma.screeningEvent.findFirst({ where: scoped });
  if (!row) return null;
  const metadata = (row.metadata ?? {}) as { request_id?: string; rule_ids?: string[] };
  return {
    requestId: metadata.request_id ?? row.id,
    blocked: row.blocked,
    disposition: row.disposition,
    categories: row.categories,
    ruleIds: metadata.rule_ids ?? [],
    riskScore: row.riskScore,
    verdict: row.verdict,
  };
}

explainRoutes.post("/v1/explain", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  const tier = apiKey.tier
    ?? (apiKey.id === "master" || apiKey.scopes?.includes("admin") ? "enterprise" : "free");

  if (tier === "free") {
    c.header("X-Upgrade-URL", "/pricing#solo");
    return problem(c, {
      status: 402,
      title: "Explanations are a paid feature",
      detail:
        "On free, `intent.*` flags carry `matched_token` (the phrase that fired); "
        + "`pattern.*` flags may omit it. POST /v1/explain adds the server-side bisection: "
        + "the shortest run of words that still triggers the rule, and the declaration that would clear it.",
      code: ErrorCode.PAYMENT_REQUIRED,
      retryable: false,
      upgradeUrl: "/pricing#solo",
      upgrade: {
        tier: "solo",
        price_per_month: 12,
        message: "Solo ($12/mo) includes explanations and evidence spans.",
      },
    });
  }

  let body: { prompt?: unknown; trace_id?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "Body must be JSON with a `prompt` string or a `trace_id` from a prior /v1/parse call.",
      code: ErrorCode.VALIDATION_REQUIRED,
      retryable: false,
    });
  }

  const traceId = typeof body.trace_id === "string" ? body.trace_id.trim() : "";
  const prompt = typeof body.prompt === "string" ? body.prompt : "";

  if (traceId) {
    const started = Date.now();
    const loader = explainEventLoader ?? defaultLoadExplainEvent;
    const event = await loader(traceId, apiKey.id);
    if (!event) {
      return problem(c, {
        status: 404,
        title: "Trace not found",
        detail:
          "No screening event matches that trace_id for this key. Parse does not keep prompt text; "
          + "a trace can only be explained while the screening event is retained.",
        code: ErrorCode.RESOURCE_NOT_FOUND,
        retryable: false,
      });
    }
    const result = explainFromStoredEvent(event);
    return c.json({
      ...result,
      trace_id: event.requestId,
      latency_ms: Date.now() - started,
    });
  }

  if (!prompt.trim()) {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "`prompt` or `trace_id` is required.",
      code: ErrorCode.VALIDATION_REQUIRED,
      retryable: false,
    });
  }
  if (prompt.length > MAX_PROMPT) {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: `\`prompt\` must be ${MAX_PROMPT.toLocaleString("en-US")} characters or fewer.`,
      code: ErrorCode.VALIDATION_REQUIRED,
      retryable: false,
    });
  }

  const started = Date.now();
  const parsed = await parsePrompt({
    prompt,
    mode: "full",
    apiKeyId: apiKey.id,
    tier: tier === "enterprise" && apiKey.id === "master" ? "enterprise" : (apiKey.tier ?? tier),
  });
  const result = explainFromParseResult(prompt, parsed);

  return c.json({
    ...result,
    layers: parsed.layers,
    latency_ms: Date.now() - started,
  });
});
