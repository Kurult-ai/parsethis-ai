/**
 * Minimal structured JSON logger.
 * Outputs one JSON object per line for machine-readable log aggregation.
 */

type Level = "info" | "warn" | "error";

export function log(
  level: Level,
  msg: string,
  data?: Record<string, unknown>
): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...data,
  };
  if (level === "error") {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}
