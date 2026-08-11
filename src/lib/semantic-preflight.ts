/**
 * Boot-time check that the semantic layer's model provider will actually
 * answer us.
 *
 * Twice now the semantic layer has been silently dead in production while
 * every response still looked complete: once when OPENROUTER_API_KEY was the
 * literal placeholder `sk-or-.....` (so the layer had *never* run and
 * screening was pattern-only while reporting a finished verdict), and again
 * when an instance booted with a bad key and logged nine
 * "Missing Authentication header" 401s before anyone noticed. Both times the
 * first signal was a runtime failure on a customer's screening call, and both
 * times it went unnoticed for hours.
 *
 * The fix is to ask the question at boot, once, and say the answer out loud.
 * The probe is deliberately cheap: OpenRouter's /auth/key endpoint validates
 * credentials without running a model, so this costs no tokens and adds no
 * meaningful startup time.
 *
 * This must NEVER prevent the service from starting. Pattern-only screening is
 * a legitimate degraded mode — a bad model key should cost us the semantic
 * layer, not the API. The point is that we know at boot, in the log and on
 * /health, instead of finding out from a customer.
 */

export type SemanticPreflightStatus =
  | "pending"
  | "ok"
  | "rejected"
  | "unreachable"
  | "not_configured";

export interface SemanticPreflightResult {
  status: SemanticPreflightStatus;
  /** Human-readable, safe to surface publicly. Never contains the key. */
  detail: string;
  checkedAt: string | null;
}

const OPENROUTER_AUTH_URL = "https://openrouter.ai/api/v1/auth/key";
const PREFLIGHT_TIMEOUT_MS = Number(process.env.SEMANTIC_PREFLIGHT_TIMEOUT_MS ?? 8000);

let current: SemanticPreflightResult = {
  status: "pending",
  detail: "Model provider credentials have not been checked yet.",
  checkedAt: null,
};

export function getSemanticPreflight(): SemanticPreflightResult {
  return current;
}

/** Test seam: lets the suite drive the probe without network access. */
let probeImpl: ((key: string) => Promise<{ ok: boolean; status: number }>) | null = null;
export function __setSemanticPreflightProbeForTesting(
  fn: ((key: string) => Promise<{ ok: boolean; status: number }>) | null,
): void {
  probeImpl = fn;
}

export function __resetSemanticPreflightForTesting(): void {
  current = { status: "pending", detail: "Model provider credentials have not been checked yet.", checkedAt: null };
}

async function defaultProbe(key: string): Promise<{ ok: boolean; status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PREFLIGHT_TIMEOUT_MS);
  try {
    const res = await fetch(OPENROUTER_AUTH_URL, {
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    return { ok: res.ok, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe the provider and record the verdict. Resolves to the result rather
 * than throwing: callers should be able to `void` this safely.
 */
export async function runSemanticPreflight(): Promise<SemanticPreflightResult> {
  const key = process.env.OPENROUTER_API_KEY;
  const checkedAt = new Date().toISOString();

  if (!key) {
    current = {
      status: "not_configured",
      detail: "No model provider key configured — screening runs on pattern matching alone.",
      checkedAt,
    };
    console.warn(
      "[startup] semantic layer NOT CONFIGURED: OPENROUTER_API_KEY is unset. "
      + "Screening will run pattern-only and every response will report degraded_reason=llm_disabled.",
    );
    return current;
  }

  try {
    const { ok, status } = await (probeImpl ?? defaultProbe)(key);
    if (ok) {
      current = { status: "ok", detail: "Model provider credentials accepted at startup.", checkedAt };
      console.log("[startup] semantic layer OK: model provider accepted the configured credentials.");
      return current;
    }

    // 401/403 is the placeholder-key case. Name it explicitly, because the
    // generic "call failed" phrasing is what let it hide twice.
    const credentialProblem = status === 401 || status === 403;
    current = {
      status: credentialProblem ? "rejected" : "unreachable",
      detail: credentialProblem
        ? `Model provider rejected the configured credentials (HTTP ${status}). Screening will fall back to pattern matching.`
        : `Model provider returned HTTP ${status} at startup. Screening falls back to pattern matching while this persists.`,
      checkedAt,
    };
    console.error(
      credentialProblem
        ? `[startup] semantic layer REJECTED: the model provider refused the configured key (HTTP ${status}). `
          + "Screening will silently fall back to pattern matching until this is fixed — check OPENROUTER_API_KEY."
        : `[startup] semantic layer UNREACHABLE: model provider returned HTTP ${status}.`,
    );
    return current;
  } catch (err) {
    const message = (err as Error).name === "AbortError"
      ? `no response within ${PREFLIGHT_TIMEOUT_MS}ms`
      : (err as Error).message;
    current = {
      status: "unreachable",
      detail: `Could not reach the model provider at startup (${message}). Screening falls back to pattern matching while this persists.`,
      checkedAt,
    };
    console.error(`[startup] semantic layer UNREACHABLE: ${message}. Screening falls back to pattern matching.`);
    return current;
  }
}
