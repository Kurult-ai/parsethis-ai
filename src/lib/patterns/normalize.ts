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
  // Cyrillic lowercase
  '\u0430': 'a', '\u0435': 'e', '\u043E': 'o', '\u0440': 'p',
  '\u0441': 'c', '\u0443': 'y', '\u0445': 'x', '\u0456': 'i',
  // Cyrillic uppercase
  '\u0410': 'A', '\u0412': 'B', '\u0415': 'E', '\u041A': 'K',
  '\u041C': 'M', '\u041D': 'H', '\u041E': 'O', '\u0420': 'P',
  '\u0421': 'C', '\u0422': 'T', '\u0425': 'X',
  // Greek lowercase (visual confusables not collapsed by NFKD)
  '\u03B1': 'a', '\u03B5': 'e', '\u03B9': 'i', '\u03BF': 'o',
  '\u03C1': 'p', '\u03C4': 't', '\u03C5': 'u', '\u03BA': 'k', '\u03BD': 'v',
  // Greek uppercase
  '\u0391': 'A', '\u0392': 'B', '\u0395': 'E', '\u0397': 'H',
  '\u0399': 'I', '\u039A': 'K', '\u039C': 'M', '\u039D': 'N',
  '\u039F': 'O', '\u03A1': 'P', '\u03A4': 'T', '\u03A5': 'Y',
  '\u03A7': 'X', '\u0396': 'Z',
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

  // 7. Fullwidth Latin → ASCII (U+FF21-FF3A → A-Z, U+FF41-FF5A → a-z)
  normalized = normalized.replace(/[\uFF21-\uFF3A]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFF21 + 0x41));
  normalized = normalized.replace(/[\uFF41-\uFF5A]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFF41 + 0x61));

  return normalized;
}
