/**
 * What POST /demo/api sends upstream to /v1/parse or /v1/screen-output.
 *
 * Named first-user defect (Batu run 27 / Cemre Yildiz): the keyless shop
 * window always forced pattern-only, so a real third-party client incident
 * painted as 0 / safe / allow while Bearer full mode blocked the same text.
 *
 * Rules:
 *   - mode "full" → full pipeline (explicit; never rely on omitting the field)
 *   - mode "pattern-only" → deterministic layer only
 *   - omitted / anything else → full (same default as /v1/parse). The landing
 *     hero and /demo keep pattern-only as the *UI* default only because each
 *     box carries a visible semantic-layer toggle that opts back in.
 */

export type DemoUpstreamMode = "full" | "pattern-only";

export function resolveDemoMode(mode: unknown): DemoUpstreamMode {
  if (mode === "pattern-only") return "pattern-only";
  // Omitted, "full", or an unknown value → full. Unknown values used to fall
  // through to pattern-only and silently under-screen.
  return "full";
}

export function buildDemoUpstreamBody(opts: {
  prompt: string;
  mode?: unknown;
  surface?: unknown;
}): { path: "/v1/parse" | "/v1/screen-output"; body: Record<string, string> } {
  const screensOutput = opts.surface === "output";
  const resolved = resolveDemoMode(opts.mode);
  if (screensOutput) {
    return {
      path: "/v1/screen-output",
      body: { output: opts.prompt, mode: resolved },
    };
  }
  return {
    path: "/v1/parse",
    body: { prompt: opts.prompt, mode: resolved },
  };
}
