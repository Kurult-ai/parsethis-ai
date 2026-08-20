/**
 * Precision measured by prospect run 20 (Minh-Anh Tran, output-side hobbyist),
 * 2026-08-17, production 7473761, against ~/reports/parse-prospect/run20/evalset.json.
 * Corpus frozen before first page load. Every figure carries its n; do not
 * publish any of these without the n in the same sentence.
 *
 * Honesty guard: this module states an OUTPUT-surface figure. Do NOT reuse it
 * to make an input-surface precision claim — run 20 measured 2 of 13 refused
 * on /v1/parse for the same corpus, so a blanket "we don't refuse ordinary
 * text" claim would be false. Any copy citing these numbers must name the
 * surface.
 */
export const OUTPUT_PRECISION = {
  harmlessRefused: 0,
  harmlessTotal: 16,
  surface: "POST /v1/screen-output",
  mode: "deterministic",
  examples: [
    "a venue address",
    "a gate code",
    "a member's email",
    'a solar-safety warning that says "do not"',
  ],
  source: "prospect run 20, 2026-08-17",
} as const;


/**
 * Precision on the input surface, measured against prospect run 21's homelab
 * operations corpus (Bartek Nowicki, 2026-08-18) — release notes, CVE
 * advisories, alert payloads, restic log tails, compose fragments, issue
 * threads. The segment where the legitimate professional vocabulary IS the
 * attack vocabulary.
 *
 * **Provenance, stated because it changes what the number is worth.** Run 21
 * measured 3 of 17 harmless rows refused. The fixes in that run's remediation
 * were validated against these rows, so `run21/evalset.json` is now burnt and
 * this figure is a **delta**, not a fresh score: it says the three named
 * defects are gone, not that the detector is perfect on unseen ops traffic.
 * Any copy quoting it must carry the n and must not imply a general precision
 * rate.
 *
 * The honest short version for a page: on seventeen lines of real homelab
 * operations text, it refused none of them — and it used to refuse three.
 */
export const INPUT_PRECISION_OPS = {
  harmlessRefusedBefore: 3,
  harmlessRefusedAfter: 0,
  harmlessTotal: 17,
  surface: "POST /v1/parse",
  mode: "deterministic",
  corpus: "prospect run 21, homelab operations, 2026-08-18",
  corpusBurnt: true,
  examples: [
    "third-party release notes naming a default password",
    "a CVE advisory describing an authentication bypass",
    "an alert payload",
    "a quoted question about a certificate warning",
  ],
} as const;

/**
 * Precision on the financial-crime input surface, prospect run 22
 * (Anouk Vermeulen, 2026-08-18) — 19 analyst/harmless rows + 6 injections.
 * Corpus informed the describing-versus-instructing prompt fix, so this is
 * a delta: pattern-only refused 0 of 19 before and after; full mode had
 * refused 4 of 19 of an analyst describing an attack.
 */
export const INPUT_PRECISION_FINCRIME = {
  harmlessRefusedPatternOnly: 0,
  harmlessRefusedFullBefore: 4,
  harmlessTotal: 19,
  injectionsHeld: 6,
  injectionsTotal: 6,
  surface: "POST /v1/parse",
  modePatternOnly: "pattern-only",
  modeFull: "full",
  corpus: "prospect run 22, crypto financial-crime investigation, 2026-08-18",
  corpusInformedFix: true,
  examples: [
    "a seed-phrase victim narrative",
    "a quoted scam-site instruction",
    "an analyst asking to summarise a phishing kit without following it",
    "threat-intel prose mentioning admin access",
  ],
} as const;
