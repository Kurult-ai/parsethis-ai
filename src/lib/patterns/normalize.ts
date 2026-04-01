/**
 * Text normalization for security pattern detection.
 * Strips obfuscation techniques that bypass regex-based detection.
 */

// Zero-width and invisible characters commonly used for evasion
const INVISIBLE_CHARS = /[\u200B\u200C\u200D\uFEFF\u00AD\u200E\u200F\u2060\u2061\u2062\u2063\u2064]/g;

// Combining diacritical marks (applied after NFKD decomposition)
const COMBINING_MARKS = /[\u0300-\u036f]/g;

// RTL override and isolate characters used to reverse or reorder text
const RTL_OVERRIDES = /[\u202A-\u202E\u2066-\u2069]/g;

// Unicode whitespace characters (non-breaking spaces, various-width spaces, line/paragraph separators)
const UNICODE_WHITESPACE = /[\u00A0\u2000-\u200A\u2028\u2029\u205F\u3000]/g;

// Homoglyph mapping — Cyrillic and Greek characters that look like Latin
const HOMOGLYPHS: Record<string, string> = {
  '\u0430': 'a', // Cyrillic а
  '\u0435': 'e', // Cyrillic е
  '\u043E': 'o', // Cyrillic о
  '\u0440': 'p', // Cyrillic р
  '\u0441': 'c', // Cyrillic с
  '\u0443': 'y', // Cyrillic у (approximate)
  '\u0445': 'x', // Cyrillic х
  '\u0456': 'i', // Cyrillic і
  '\u0410': 'A', // Cyrillic А
  '\u0412': 'B', // Cyrillic В
  '\u0415': 'E', // Cyrillic Е
  '\u041A': 'K', // Cyrillic К
  '\u041C': 'M', // Cyrillic М
  '\u041D': 'H', // Cyrillic Н
  '\u041E': 'O', // Cyrillic О
  '\u0420': 'P', // Cyrillic Р
  '\u0421': 'C', // Cyrillic С
  '\u0422': 'T', // Cyrillic Т
  '\u0425': 'X', // Cyrillic Х
};

// Build a regex that matches any homoglyph character
const HOMOGLYPH_REGEX = new RegExp(`[${Object.keys(HOMOGLYPHS).join("")}]`, "g");

/**
 * Replace homoglyph characters (Cyrillic/Greek lookalikes) with their Latin equivalents.
 */
function replaceHomoglyphs(text: string): string {
  return text.replace(HOMOGLYPH_REGEX, (ch) => HOMOGLYPHS[ch] || ch);
}

/**
 * Normalize text for pattern detection.
 * Strips zero-width characters, homoglyphs, RTL overrides, Unicode whitespace,
 * applies NFKD normalization, and removes combining diacritical marks.
 */
export function normalizeForDetection(text: string): string {
  // 1. Strip zero-width and invisible characters
  let normalized = text.replace(INVISIBLE_CHARS, "");

  // 2. Replace homoglyph characters with Latin equivalents (before NFKD)
  normalized = replaceHomoglyphs(normalized);

  // 3. Remove RTL override and isolate characters
  normalized = normalized.replace(RTL_OVERRIDES, "");

  // 4. Normalize Unicode whitespace to regular spaces
  normalized = normalized.replace(UNICODE_WHITESPACE, " ");

  // 5. NFKD normalization (decomposes and maps compatibility characters)
  normalized = normalized.normalize("NFKD");

  // 6. Strip combining diacritical marks
  normalized = normalized.replace(COMBINING_MARKS, "");

  return normalized;
}
