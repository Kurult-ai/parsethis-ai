/**
 * Prompt privacy protection — redacts raw user prompts after evaluation/screening
 * completes, so PII, credentials, or sensitive content are not stored permanently.
 *
 * Lifecycle:
 *   1. Full prompt is available during analysis (parse, evaluate, screen-output).
 *   2. After results are computed and persisted, redactEvaluationAfterCompletion()
 *      overwrites Evaluation.prompt with a truncated prefix + SHA-256 hash.
 *
 * The redacted form preserves enough for debugging (first 100 chars) while
 * providing a deterministic fingerprint (SHA-256) for dedup and audit without
 * retaining the raw content.
 */

import { createHash } from "node:crypto";

/** Truncation limit for the debugging prefix. */
const PROMPT_PREFIX_LENGTH = 100;

/** Marker that indicates a prompt has already been redacted. */
export const REDACTION_HASH_PREFIX = "[hash:sha256:";

/**
 * Redact a raw prompt string into a privacy-safe form:
 *   `<first 100 chars>...` + newline + `[hash:sha256:<sha256-hex>]`
 *
 * - Prompts shorter than 100 chars are not truncated (no `...` appended).
 * - The SHA-256 hash is computed over the *full* original prompt, giving a
 *   deterministic fingerprint without storing the content.
 */
export function redactPrompt(prompt: string): string {
  const hash = createHash("sha256").update(prompt).digest("hex");

  const prefix = prompt.slice(0, PROMPT_PREFIX_LENGTH);
  const truncationMarker = prompt.length > PROMPT_PREFIX_LENGTH ? "..." : "";
  const separator = truncationMarker ? "\n" : "\n";

  return `${prefix}${truncationMarker}${separator}${REDACTION_HASH_PREFIX}${hash}]`;
}

/**
 * Check whether a prompt has already been redacted (idempotency guard).
 */
export function isRedacted(prompt: string): boolean {
  return prompt.includes(REDACTION_HASH_PREFIX);
}

/**
 * Minimal Prisma-like type so this module can be tested without importing
 * the generated client (which requires a DATABASE_URL at runtime).
 */
interface PrismaLike {
  evaluation: {
    findUnique(args: {
      where: { id: string };
      select?: { prompt: boolean };
    }): Promise<{ prompt: string } | null>;
    update(args: {
      where: { id: string };
      data: { prompt: string };
    }): Promise<unknown>;
  };
}

/**
 * After an evaluation completes, overwrite the stored `Evaluation.prompt`
 * with its redacted form. This is the main entry point for the privacy
 * reconciliation pass.
 *
 * - Fetches the current (raw) prompt from the database.
 * - Skips the update if the prompt is already redacted (idempotent).
 * - Throws if the evaluation does not exist.
 *
 * The update is best-effort: callers should `.catch()` log errors without
 * blocking the response path.
 */
export async function redactEvaluationAfterCompletion(
  prisma: PrismaLike,
  evaluationId: string
): Promise<void> {
  const evaluation = await prisma.evaluation.findUnique({
    where: { id: evaluationId },
    select: { prompt: true },
  });

  if (!evaluation) {
    throw new Error(`Evaluation ${evaluationId} not found — cannot redact prompt`);
  }

  // Idempotency: don't re-hash an already-redacted prompt
  if (isRedacted(evaluation.prompt)) {
    return;
  }

  const redacted = redactPrompt(evaluation.prompt);

  await prisma.evaluation.update({
    where: { id: evaluationId },
    data: { prompt: redacted },
  });
}
