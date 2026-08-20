function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON array, a JSON object with rows, or JSONL objects.`);
  }
  return value as Record<string, unknown>;
}

export function parseJsonOrJsonlRows(text: string, label: string): unknown[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) throw new Error(`${label} must contain at least one row.`);

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch (error) {
      if (trimmed.startsWith("[")) throw error;
      parsed = undefined;
    }
    if (parsed !== undefined) {
    const rows = Array.isArray(parsed) ? parsed : asRecord(parsed, label).rows;
    if (!Array.isArray(rows)) throw new Error(`${label} must be a JSON array or an object with a rows array.`);
    if (rows.length === 0) throw new Error(`${label} must contain at least one row.`);
    return rows;
    }
  }

  const rows = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as unknown;
      } catch (error) {
        throw new Error(`${label} JSONL row ${index} is not valid JSON: ${(error as Error).message}`);
      }
    });
  if (rows.length === 0) throw new Error(`${label} must contain at least one row.`);
  return rows;
}
