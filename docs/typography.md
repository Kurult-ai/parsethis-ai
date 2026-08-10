# Parse Typography — the one guide

Canonical source of truth for every typeface decision on the platform.
`docs/style-guide.md` §2 and `docs/brand-guidelines.md` §8 defer to this file;
if they ever disagree with it, this file wins. Mechanically checkable rules
are enforced by `scripts/brand-lint.ts`.

Audited and unified 2026-08-09 across all 28 SSR pages + the shared shell.

## 1. The four faces

| Face | Role | Where it may appear | Weights loaded |
|---|---|---|---|
| **Saira** | Brand voice | Wordmark, top-bar nav, footer brand line, console masthead, OG image/lockup SVG. Nowhere else. | 500 · 600 · 700 |
| **Instrument Serif** | Editorial voice | The two editorial moments per page: opening display statement and the closer. Italic for the "turn". Never body, never UI. | 400 (+ italic) |
| **Lexend** | UI & body | Everything readable: body, h2+, buttons, cards, forms. | 300–800 |
| **IBM Plex Mono** | Data voice | Code, endpoints, receipts, verdicts, counts, timestamps, micro-labels. | 400 · 500 · 600 |

No fifth face. Banned outright: Inter, Roboto, Arial, DM Sans, Schibsted
Grotesk, JetBrains Mono, Krona One, Michroma (the last two lost the wordmark
bake-off; they stay dead). Per surface: at most two text families plus the
wordmark face.

## 2. Tokens — the only way to reference a face

Every page inherits (or, if standalone, declares) exactly these:

```css
--serif: 'Instrument Serif', Georgia, serif;
--sans:  'Lexend', -apple-system, system-ui, sans-serif;
--mono:  'IBM Plex Mono', ui-monospace, 'SF Mono', monospace;
```

- Rules reference `var(--serif|--sans|--mono)` — never a literal family name.
  (Saira is the one exception: it appears literally, only in the §1 slots.)
- Never bare `font-family: monospace` or a raw system stack in page CSS.
  System stacks live only inside the token fallback chains above.
- The shared shell defines all three tokens on `:root`; standalone pages
  (landing, agent-dashboard) declare identical values. Do not fork them.

## 3. Loading — one URL, everywhere

```
https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Lexend:wght@300;400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&family=Saira:wght@500;600;700&display=swap
```

Preconnect to `fonts.googleapis.com` and `fonts.gstatic.com` first;
`display=swap` always. Never load a weight you don't use; never use a weight
you don't load — an unloaded weight silently renders as synthesized faux-bold,
which is how the playground shipped fake 750/800 mono for a day.

**Weight ceilings.** IBM Plex Mono stops at **600** — 700/750/800 on mono is
a lint-visible bug, not a style choice. Lexend may use 300–800 (headings 600;
700–800 reserved for stat numerals and display moments). Saira only 500/600/700.

**Email templates (`src/lib/email.ts`) are exempt**: email clients don't load
webfonts, so they intentionally use system stacks and bare monospace.

## 4. The scale

On black, at the measured platform sizes:

| Tier | Face / weight | Size | Notes |
|---|---|---|---|
| Display (hero, closer) | serif 400 | clamp(44px, 5.6–6vw, 84px) / 1.02 | −.01em; italic `<em>` for the turn |
| h2 section | sans 600 | clamp(34px, 4.6vw, 52px) / 1.08 | −.045em; serif-italic `.thin` inflection allowed |
| h3 / card titles | sans 600 | 17–18.5px | −.01em |
| Body | sans 400 | 15–16.5px / 1.55–1.65 | +.005em; lede 17–19px |
| Small / meta | sans 400–500 | 13.5–15px | muted tier `#9a9ea2`, AA floor |
| Code blocks | mono 400 | 12.5–14.5px / 1.7–1.8 | scroll, never wrap-break tokens |
| Data / receipts | mono 400–500 | 11–13.5px | `font-variant-numeric: tabular-nums` always |
| Micro-labels | mono 500–600 | ≥10.5px | UPPERCASE, letter-spacing ≥ .08em (kickers ≥ .1em) |
| Stat numerals | mono 600 (or sans 700–800) | 22px+ | mono for data readouts, sans for marketing counts |
| Nav | Saira 600 | 13.5px | +.045em; active page in corona gold `#ffd9a0` |
| Wordmark | Saira 700 | 16–17px | +.09em |

Text tiers on black: `#fafafa` primary · `#c3c7ca` body · `#9a9ea2` muted.

## 5. Don'ts (the ones the audit actually caught)

- No JetBrains Mono — it shipped on six surfaces as a stowaway; brand-lint
  now blocks it.
- No mono weight above 600 (synthesized bold), no `font-weight` on mono
  micro-labels beyond 600.
- No bare `monospace`, no raw `-apple-system…` stacks outside email.
- No per-page Google Fonts URL drift: copy §3 verbatim.
- No all-caps body text — uppercase is for kickers/labels at mono sizes only.
- No serif below display size; no Saira outside its §1 slots.

## 6. Enforcement

`scripts/brand-lint.ts` fails CI on: legacy/banned families appearing as a
leading `font-family` in `src/pages` or the shell (Inter, Roboto, Arial,
DM Sans, JetBrains Mono). Everything else here is reviewed by eye against
this file. When touching any page, leave its fonts on the tokens — if a new
need genuinely doesn't fit §4, extend this file first, then the CSS.
