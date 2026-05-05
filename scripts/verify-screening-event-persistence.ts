import { randomUUID } from "node:crypto";
import { disconnectDb, getPrisma } from "../src/db.js";
import { parsePrompt, type ParseRequest, type ParseResponse } from "../src/parse.js";
import {
  isCompleteScreeningEventData,
  persistScreeningEventForApiKey,
  type ScreeningEventMetadata,
} from "../src/lib/screening-event-log.js";

const WRITE_ENV = "SCREENING_EVENT_DB_VERIFY_WRITE";
const ALLOW_SHARED_DB_ENV = "SCREENING_EVENT_DB_VERIFY_ALLOW_SHARED_DB";
const VERIFIER = "screening_event_persistence";

function writeResult(result: Record<string, unknown>): void {
  console.log(JSON.stringify({ verifier: VERIFIER, ...result }, null, 2));
}

const databaseUrlPresent = Boolean(process.env.DATABASE_URL);
const writeEnabled = process.env[WRITE_ENV] === "1";
const allowSharedDb = process.env[ALLOW_SHARED_DB_ENV] === "1";

if (!databaseUrlPresent || !writeEnabled) {
  writeResult({
    status: "skipped",
    reason: !databaseUrlPresent
      ? "DATABASE_URL is not set."
      : `${WRITE_ENV}=1 is required for the disposable database write check.`,
    database_url_present: databaseUrlPresent,
    write_enabled: writeEnabled,
    claimability_status: "pass_internal_not_claimable",
  });
  process.exit(0);
}

function databaseTargetSafety(databaseUrl: string, allowSharedTarget: boolean): { safe: boolean; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return { safe: false, reason: "DATABASE_URL is not a valid URL." };
  }

  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    return { safe: false, reason: "DATABASE_URL must use postgres/postgresql for this verifier." };
  }

  const host = parsed.hostname.toLowerCase();
  const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, "")).toLowerCase();
  const target = `${host}/${database}`;
  const localHost = host === "localhost" || host === "127.0.0.1" || host === "::1";
  const disposableLooking = /(^|[^a-z0-9])(test|testing|verify|verification|disposable|scratch|ci|local|dev)([^a-z0-9]|$)/.test(target);
  const productionLooking = /(^|[^a-z0-9])(prod|production)([^a-z0-9]|$)/.test(target);

  if (productionLooking && !allowSharedTarget) {
    return { safe: false, reason: `DATABASE_URL looks production-like; set ${ALLOW_SHARED_DB_ENV}=1 only for a confirmed disposable target.` };
  }
  if (localHost || disposableLooking || allowSharedTarget) {
    return { safe: true, reason: allowSharedTarget ? "explicit shared-target override supplied" : "target appears local or disposable" };
  }
  return {
    safe: false,
    reason: `DATABASE_URL does not look local/disposable; use a disposable database or set ${ALLOW_SHARED_DB_ENV}=1 after confirming the target is safe.`,
  };
}

const targetSafety = databaseTargetSafety(process.env.DATABASE_URL ?? "", allowSharedDb);
if (!targetSafety.safe) {
  writeResult({
    status: "blocked_unsafe_target",
    reason: targetSafety.reason,
    database_url_present: true,
    write_enabled: true,
    allow_shared_db_override: allowSharedDb,
    claimability_status: "pass_internal_not_claimable",
  });
  process.exit(1);
}

const runId = `screening-event-verify-${randomUUID()}`;
const apiKeyId = `verify_${randomUUID()}`;
const prompt = `Summarize this persistence smoke-check ticket ${runId}. Keep the answer short.`;
const request: ParseRequest = {
  prompt,
  mode: "pattern-only",
  policy_mode: "balanced",
  metadata: {
    source_kind: "email",
    trust_level: "external",
    intended_action: "summarize",
    data_classification: ["business"],
    tool_permissions: [],
  },
};

const prisma = getPrisma();

try {
  await prisma.apiKey.create({
    data: {
      id: apiKeyId,
      userId: "screening-event-persistence-verifier",
      keyHash: `verify:${runId}`,
      keyPrefix: "verify",
      name: "Screening event persistence verifier",
      tier: "free",
      scopes: ["evaluate"],
      rateLimit: 1,
    },
  });

  const startedAt = performance.now();
  const result = await parsePrompt(request);
  const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));

  await persistScreeningEventForApiKey({
    apiKeyId,
    request,
    result,
    latencyMs,
  });

  const events = await prisma.screeningEvent.findMany({
    where: { apiKeyId },
    orderBy: { createdAt: "desc" },
  });
  if (events.length !== 1) {
    throw new Error(`Expected exactly one ScreeningEvent row, found ${events.length}.`);
  }

  const event = events[0];
  const metadata = event.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("ScreeningEvent metadata is missing or not an object.");
  }

  const persistedData = {
    apiKeyId: event.apiKeyId,
    riskScore: event.riskScore,
    verdict: event.verdict as ParseResponse["verdict"],
    categories: event.categories,
    mode: event.mode as NonNullable<ParseRequest["mode"]>,
    latencyMs: event.latencyMs,
    blocked: event.blocked,
    metadata: metadata as ScreeningEventMetadata,
  };

  const promptStored = JSON.stringify(event).includes(prompt);
  const eventComplete = isCompleteScreeningEventData(persistedData);
  if (!eventComplete) {
    throw new Error("Persisted ScreeningEvent row does not satisfy completeness requirements.");
  }
  if (promptStored) {
    throw new Error("Persisted ScreeningEvent row stores the raw prompt text.");
  }
  if (persistedData.metadata.request_id !== result.id) {
    throw new Error("Persisted ScreeningEvent metadata request_id does not match the Parse response id.");
  }

  writeResult({
    status: "pass",
    claimability_status: "pass_internal_not_claimable",
    screening_event_count: events.length,
    event_complete: eventComplete,
    prompt_stored: promptStored,
    recommended_action: persistedData.metadata.recommended_action,
    attack_detected: persistedData.metadata.attack_detected,
    target_safety: targetSafety.reason,
    allow_shared_db_override: allowSharedDb,
    cleanup: "disposable ApiKey and ScreeningEvent rows deleted in finally",
  });
} finally {
  await prisma.screeningEvent.deleteMany({ where: { apiKeyId } });
  await prisma.apiKey.deleteMany({ where: { id: apiKeyId } });
  await disconnectDb();
}
