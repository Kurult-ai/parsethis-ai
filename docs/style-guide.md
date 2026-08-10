# Parse Platform Theme — "Event Horizon"

Version 1.0 · 2026-08-09 · Extracted from the shipped homepage (parsethis.ai)
· Companion to `docs/brand-guidelines.md` (which owns positioning, voice, and
claims; this file owns the visual system).

The theme in one sentence: **a black void, watched by a warm horizon** —
pure-black surfaces, hairline borders, serif editorial moments, mono data,
Parse Blue for action, and accretion gold for the boundary.

## 1. Tokens

Source of truth in code: the `:root` block in `src/lib/html-template.ts`
(shared shell) and the token block in `src/pages/landing.ts`. They must stay
in sync with this table.

| Token | Value | Role |
|-------|-------|------|
| `--bg` | `#000000` | page background |
| `--surface` | `#0a0a0b` | panels, cards, tables |
| `--surface2` | `#131316` | nested fills, inline-code bg |
| `--surface3` | `#1a1a1f` | deepest fills |
| `--border` | `rgba(255,255,255,.09)` | hairlines everywhere |
| `--border2` | `rgba(255,255,255,.16)` | emphasized borders, hover |
| `--text` | `#f2f2f2` | primary text |
| `--text-dim` | `#adb1b3` | body text (≈9:1 on black) |
| `--text-soft` | `#878b8e` | muted small text (≈5.6:1, AA floor) |
| `--accent` | `#3d7bff` | Parse Blue — links, active states |
| `--accent2` | `#8ab8ff` | link hover / bright blue |
| `--accent-dim` | `rgba(61,123,255,.12)` | blue fills |
| `--green` / `--green-dim` | `#3ddc84` / `rgba(61,220,132,.12)` | allow / safe |
| `--yellow` / `--yellow-dim` | `#ffb454` / `rgba(255,180,84,.12)` | warn; also accretion amber |
| `--destructive` / `--destructive-dim` | `#ff5d5d` / `rgba(255,93,93,.12)` | block / risk |
| `--gold` | `#ffd9a0` | horizon keyline (logo ring, photon hovers) |
| `--radius` | `8px` (cards 12–14px) | corners |

Rules: verdict colors are semantic only; red never decorates non-risk
content. Accretion amber/gold is sanctioned for atmosphere, the logo, and
photon-ring hovers — on data surfaces amber stays warn-tier.

## 2. Typography

> Canonical spec: `docs/typography.md` — tokens, weight ceilings, the one
> loader URL, and the full type scale. This section is the narrative summary.

- **Display / h1 / editorial turns:** Instrument Serif 400 (italic for the
  turn). Serif appears at the two editorial moments per page — the opening
  statement and the closer — never for body or UI.
- **UI, headings h2+, body:** Lexend (300–800), +.005em tracking. Section
  headings 600; body 15–16px, line-height 1.55–1.65. Text tiers on black:
  `#fafafa` primary, `#c3c7ca` body, `#9a9ea2` muted.
- **Data, code, receipts, labels:** IBM Plex Mono, `tabular-nums` for all
  numerals in data contexts. Micro-labels uppercase, letterspaced ≥ .1em,
  never below 10.5px.
- **Wordmark and top bar:** Saira — 700/.09em for the wordmark, 600/.045em
  at 13.5px for nav. Active page marked in corona gold text + underline.
  Never in headings, body, or in-page UI.
- Never Inter/Roboto/Arial; never more than these three text families plus
  the wordmark face.

## 3. Atmosphere tiers

Every page is black, but the sky is dressed by tier:

1. **Tier 1 — Landing.** Full production: starfield + twinkle, shooting
   stars, aurora blobs with scroll-driven hue (`--scrollp` × 80deg), floor
   sweep, grain, the boundary-gate animation, footer horizon rim.
2. **Tier 2 — Console (`/dashboard/*`).** Fixed ambient aurora (3 radials,
   ≤ .11 alpha, slow breathe), aurora hairlines, live instruments (orbit
   map, pings, beams). No starfield density, no shooting stars.
3. **Tier 3 — Content (docs, blog, pricing, trust, Test Lab…).** The
   platform scene, "Approach Vector": a faint spacetime grid, and below the
   fold a vast black planet whose limb carries a slowly rotating multicolor
   corona (338vw circle, ring band 84–95%, 140s revolution + 14s breathe,
   blur(3px), off under reduced motion). Sharp dark limb; the colors travel
   around the ring rather than changing all at once.

The landing is the exception to the shared scene: its sky is the multicolor
aurora — four curtain layers (12 color bands, 27–73s sways, hue-cycling) —
falling toward its own boundary-gate production.

There are no light pages. The Test Lab (/playground) runs on the same
tokens as everything else; its former light palette is gone.

## 4. Component idioms

- **Buttons:** primary = white pill (`#f2f2f2` bg, black text), hover lifts
  1px and gains the *photon ring* (`0 0 0 1.5px rgba(255,217,160,.55)` +
  soft amber shadow). Secondary = ghost (hairline border, gray text,
  brightens on hover). Never a filled blue button.
- **Cards/panels:** `--surface` + 1px `--border`, radius 12–14px; hover may
  raise border to `--border2` and add the tri-hue glow shadow.
- **Aurora hairline:** 1px `blue→violet→amber` gradient line, slowly
  shimmering, tops signature panels (terminal, pricing strip, posture strip).
- **Verdict chips:** mono lowercase pills in semantic dim fills.
- **Receipt strip:** mono key-value line wherever a verdict is shown.
- **Tables:** hairline rows, mono uppercase headers, hover `rgba(255,255,255,.025)`
  plus 3px translateX.
- **Terminal blocks:** `#0a0a0b` on `#050506` tab rail, syntax accents from
  the token palette, blinking green cursor allowed once per page.

## 5. Motion

One orchestrated moment per page; everything compositor-only
(transform/opacity/filter) and disabled under `prefers-reduced-motion`.
Budget: entrance staggers ≤ 1.2s total; ambient loops ≥ 9s and subtle;
scroll reveals via IntersectionObserver as *progressive enhancement* (content
must be visible without JS — gate hidden states behind `html.js`).
Signature moves: settle-in cells, radar pings, check-in beams, scanner
sweep, scroll-hue. Never scroll-jacking or parallax.

## 6. The logo in the system

The Total Eclipse mark (see brand guidelines §6) is the only place the full
corona gradient and diamond-ring flare appear at rest. The gate animation on
the landing uses the mark as its core — product surfaces may echo the
eclipse (black disc + gold rim) for "core"/"origin" elements, but never
redraw the corona or the flare as decoration.

## 7. Light surfaces

There are none. Email templates and third-party embeds that force light
grounds use: white bg, `#111827` text, Parse Blue links, the logo as-is
(the mark is light-safe). No gray-tinted "light theme" exists.

---

Change process: edits to tokens or idioms land here and in
`src/lib/html-template.ts` in the same commit; `docs/brand-guidelines.md`
governs anything touching positioning, claims, or the logo's meaning.
