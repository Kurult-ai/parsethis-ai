/**
 * Text normalization for security pattern detection.
 * Strips obfuscation techniques that bypass regex-based detection.
 */

// Zero-width and invisible characters commonly used for evasion
const INVISIBLE_CHARS = /[\u200B\u200C\u200D\uFEFF\u00AD\u200E\u200F\u2060\u2061\u2062\u2063\u2064]/g;

// Combining diacritical marks (applied after NFKD decomposition)
const COMBINING_MARKS = /[\u0300-\u036f]/g;

/**
 * Normalize text for pattern detection.
 * Strips zero-width characters, applies NFKD normalization,
 * and removes combining diacritical marks.
 */
export function normalizeForDetection(text: string): string {
  // 1. Strip zero-width and invisible characters
  let normalized = text.replace(INVISIBLE_CHARS, "");

  // 2. NFKD normalization (decomposes and maps compatibility characters)
  normalized = normalized.normalize("NFKD");

  // 3. Strip combining diacritical marks
  normalized = normalized.replace(COMBINING_MARKS, "");

  return normalized;
}
