import {
  organizationSchema,
  webApplicationSchema,
} from "../lib/schema.js";
import { listBlogPosts } from "../lib/markdown.js";
import { getLogoMarkSvg } from "../lib/logo.js";
import { DETECTION_FACTS, PLAN_LIMITS, X402_PAYMENT, X402_ENDPOINTS, PRODUCT } from "../lib/product-facts.js";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface LandingPageVariant {
  /** Experiment name for data-experiment attribute. */
  experiment?: string;
  /** Assigned variant key for data-variant attribute. */
  variant?: string;
}

/**
 * Landing page — "Event Horizon" design (2026-08-09).
 *
 * Self-contained dark document (does NOT use the light renderPage shell):
 * full-viewport hero with the boundary-gate animation, starfield, aurora
 * with scroll-driven hue, and the section system from the approved mockups.
 * The rest of the site (docs, blog, pricing) keeps the light shell.
 */
export function renderLandingPage(baseUrl: string, ab?: LandingPageVariant): string {
  const bearerPrompt = `Integrate Parse as the governance and screening boundary for this agent runtime.

First-use path:
- Prefer REST with Bearer auth: store PARSE_API_KEY in the runtime secret store and send it only to www.parsethis.ai.
- If no key exists, try POST https://www.parsethis.ai/v1/keys/generate. If it returns 503, stop and report key validation unavailable instead of claiming setup succeeded.
- Keep Parse disabled until a local benign fixture and an encoded-injection fixture pass. Do not print API keys or wallet/private-key values.

Use Bearer auth when PARSE_API_KEY is available. Treat x402 as a paid REST fallback after operator approval, not as the default for recurring production use.

Call POST https://www.parsethis.ai/v1/parse before untrusted user input, retrieved documents, browser content, tool output, email, or another agent's message can affect tools, memory, credentials, payments, code execution, or user-visible output.

Call POST https://www.parsethis.ai/v1/screen-output before forwarding generated or tool-derived output to users, tools, memory, or another agent.

Call POST https://www.parsethis.ai/v1/agent/trust/verify before accepting delegation from an unknown agent, plugin, or service.

Follow decision.action, recommended_action, or suggested_action. Block high-risk results, sandbox ambiguous results, request owner approval for private/irreversible actions, and log trace_id for review.

Verification required before reporting done:
- Local encoded-injection fixture blocks.
- Benign fixture allows.
- Tool-output or JSON instruction fixture blocks.
- Status/doctor output redacts secrets.
- REST checks completed: key-generation response handled, benign fixture allowed, encoded prompt-injection fixture blocked, and tool-output/JSON instruction fixture blocked.
- If a local Hermes Parse plugin exists, include its output; otherwise do not reference Hermes commands.`;

  const x402Prompt = `Integrate Parse with x402 pay-per-call fallback.

REST/x402 path:
- First try Bearer auth if PARSE_API_KEY exists.
- If no account context exists or Parse returns HTTP 402, read https://www.parsethis.ai/v1/pricing and use the x402 402 payment flow.
- Do not make a paid x402 screening call until the operator confirms spending is allowed and the funded wallet is scoped for Parse.
- Never print private keys, seed phrases, payment signatures, API keys, or wallet secrets.

Primary boundary: POST https://www.parsethis.ai/v1/parse before untrusted user input, RAG documents, browser content, tool output, email, or another agent's message can affect tools, memory, credentials, payments, code execution, or user-visible output.

Output boundary: POST https://www.parsethis.ai/v1/screen-output before forwarding generated or tool-derived output.

Trust boundary: POST https://www.parsethis.ai/v1/agent/trust/verify before accepting delegation from an unknown agent, plugin, or service.

Use x402 for autonomous first calls and metered workflows. Use subscriptions for sustained production volume.

Verification required before reporting done:
- Pricing manifest read from https://www.parsethis.ai/v1/pricing.
- Prompt/output prices, asset, network, and retry header recorded.
- Local no-paid-call test passes.
- If a local Hermes Parse plugin exists, include its output; otherwise verify with REST pricing and fixture checks.`;

  const installSnippets = {
    sdk: {
      code: "npm install @parsethis/sdk",
      foot: "<b>then:</b> wrap your agent — screening runs at every trust boundary.",
    },
    mcp: {
      code: "claude mcp add --transport http parse https://www.parsethis.ai/mcp",
      foot: "<b>then:</b> screen_prompt, screen_output, and verify_agent_trust appear as tools.",
    },
    curl: {
      code: "curl -X POST https://www.parsethis.ai/v1/keys/generate",
      foot: `<b>no auth required</b> — returns a 30-day key, ${PLAN_LIMITS.free.requestsPerMinute} req/min free.`,
    },
  };
  const installPayload = JSON.stringify(installSnippets).replace(/</g, "\\u003c");
  const promptsPayload = JSON.stringify({ bearer: bearerPrompt, x402: x402Prompt }).replace(/</g, "\\u003c");

  const blogPosts = listBlogPosts().slice(0, 3);
  const blogCardsHtml = blogPosts
    .map((post) => {
      const fm = post.frontmatter;
      return `<a href="/blog/${fm.category}/${fm.slug}" class="pa-article rv">
        <span>${escapeHtml(String(fm.date))}</span>
        <strong>${escapeHtml(String(fm.title))}</strong>
        <p>${escapeHtml(String(fm.description || ""))}</p>
      </a>`;
    })
    .join("\n");

  // ─── A/B: two serif hero headlines, same design ───
  const variantKey = ab?.variant ?? "a";
  const heroVariants: Record<string, { l1: string; l2: string; lede: string }> = {
    a: {
      l1: "Governance for",
      l2: "autonomous agents",
      lede: "Every agent on the record. Every boundary screened. Every decision receipted.",
    },
    b: {
      l1: "Give your agents real authority.",
      l2: "Without losing yours.",
      lede: "Decide what your agent can read, touch, and spend. Parse enforces those boundaries on every call — and writes an audit receipt for every decision.",
    },
  };
  const hero = heroVariants[variantKey] ?? heroVariants.a;

  const canonicalUrl = `${baseUrl}/`;
  const title = "Agent Governance & Compliance for AI Agents";
  const description = `Parse governs agent fleets: registry, runtime policy, boundary screening, and an audit receipt for every decision. ${DETECTION_FACTS.riskCategoryCount} risk categories, ${DETECTION_FACTS.pipelineLayers.length} detection layers, machine-readable by design.`;
  const jsonLd = [organizationSchema(baseUrl), webApplicationSchema(baseUrl)]
    .map((obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/<\//g, "<\\/")}</script>`)
    .join("\n  ");
  const bodyAttrs = ab?.experiment ? ` data-experiment="${escapeHtml(ab.experiment)}" data-variant="${escapeHtml(variantKey)}"` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} | ${PRODUCT.name}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="og:site_name" content="${PRODUCT.name}">
  <meta property="og:image" content="${escapeHtml(`${baseUrl}/og-image.svg?v=eclipse`)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="theme-color" content="#000000">
  <link rel="icon" href="/favicon.svg?v=eclipse" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Lexend:wght@300;400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&family=Saira:wght@500;600;700&display=swap" rel="stylesheet">
  ${jsonLd}
  <style>
  :root {
    --black: #000; --panel: #0a0a0b; --panel2: #101012;
    --line: rgba(255,255,255,0.08); --line2: rgba(255,255,255,0.14);
    --white: #fafafa; --gray: #c3c7ca; --gray-dim: #9a9ea2;
    --blue: #3d7bff; --violet: #6d5dfc; --cyan: #06b6d4;
    --green: #3ddc84; --red: #ff5d5d; --amber: #ffb454; --gold: #ffd9a0;
    --serif: 'Instrument Serif', Georgia, serif;
    --sans: 'Lexend', -apple-system, system-ui, sans-serif;
    --mono: 'IBM Plex Mono', ui-monospace, 'SF Mono', monospace;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { overflow-x: clip; max-width: 100%; }
  body { background: var(--black); color: var(--gray); font-family: var(--sans); font-size: 16px; line-height: 1.65; -webkit-font-smoothing: antialiased; }
  a { color: inherit; text-decoration: none; }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 0 32px; }
  .mono { font-family: var(--mono); }

  /* ── starfield + shooting stars ── */
  .sky, .sky i { position: fixed; inset: 0; pointer-events: none; }
  .sky { z-index: 0; }
  .sky i { width: 1px; height: 1px; border-radius: 50%; background: transparent; display: block; inset: auto; top: 0; left: 0; }
  .sky .s1 { box-shadow: 7vw 12vh 0 0 rgba(255,255,255,.5), 19vw 78vh 0 0 rgba(255,255,255,.4), 27vw 33vh 0 0 rgba(255,255,255,.6), 36vw 88vh 0 0 rgba(255,255,255,.35), 44vw 8vh 0 0 rgba(255,255,255,.55), 52vw 61vh 0 0 rgba(255,255,255,.4), 61vw 24vh 0 0 rgba(255,255,255,.5), 68vw 91vh 0 0 rgba(255,255,255,.3), 76vw 45vh 0 0 rgba(255,255,255,.6), 83vw 70vh 0 0 rgba(255,255,255,.4), 91vw 16vh 0 0 rgba(255,255,255,.5), 12vw 55vh 0 0 rgba(255,255,255,.35), 31vw 5vh 0 0 rgba(255,255,255,.45), 57vw 40vh 0 0 rgba(255,255,255,.3), 88vw 84vh 0 0 rgba(255,255,255,.5), 4vw 95vh 0 0 rgba(255,255,255,.4), 48vw 73vh 0 0 rgba(255,255,255,.35), 72vw 6vh 0 0 rgba(255,255,255,.45), 95vw 52vh 0 0 rgba(255,255,255,.4), 23vw 96vh 0 0 rgba(255,255,255,.3); opacity: .16; animation: skyDrift 240s linear infinite alternate; }
  .sky .s2 { width: 1.5px; height: 1.5px; box-shadow: 14vw 28vh 0 0 rgba(255,255,255,.6), 39vw 64vh 0 0 rgba(255,255,255,.5), 63vw 15vh 0 0 rgba(255,255,255,.55), 81vw 58vh 0 0 rgba(255,255,255,.45), 9vw 82vh 0 0 rgba(255,255,255,.5), 54vw 92vh 0 0 rgba(255,255,255,.4), 70vw 37vh 0 0 rgba(255,255,255,.6), 29vw 47vh 0 0 rgba(255,255,255,.5), 93vw 26vh 0 0 rgba(255,255,255,.45), 46vw 20vh 0 0 rgba(255,255,255,.55); opacity: .22; animation: skyDrift 150s linear infinite alternate-reverse; }
  .sky .s3 { box-shadow: 17vw 41vh 0 0 rgba(255,255,255,.7), 58vw 79vh 0 0 rgba(255,255,255,.6), 86vw 12vh 0 0 rgba(255,255,255,.65), 34vw 18vh 0 0 rgba(255,255,255,.6), 66vw 55vh 0 0 rgba(255,255,255,.7), 11vw 68vh 0 0 rgba(255,255,255,.6); opacity: .3; animation: twinkle 7s ease-in-out infinite alternate; }
  @keyframes skyDrift { to { transform: translateY(-3vh); } }
  @keyframes twinkle { 0% { opacity: .08; } 100% { opacity: .4; } }
  .shoot { position: fixed; top: 12%; left: 68%; width: 130px; height: 1px; z-index: 0; pointer-events: none; background: linear-gradient(270deg, rgba(255,255,255,.7), transparent); border-radius: 1px; transform: rotate(-28deg); opacity: 0; animation: shoot 26s linear infinite 7s; }
  .shoot.sh2 { top: 64%; left: 22%; width: 90px; animation: shoot 34s linear infinite 19s; }
  @keyframes shoot { 0% { opacity: 0; transform: rotate(-28deg) translateX(0); } 1.2% { opacity: .8; } 4.5% { opacity: 0; transform: rotate(-28deg) translateX(-42vw); } 100% { opacity: 0; transform: rotate(-28deg) translateX(-42vw); } }

  /* ── ambient aurora (scroll-hued) ── */
  body::after {
    content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 0;
    background:
      radial-gradient(min(760px, 95vw) 460px at 82% -8%, rgba(61,123,255,.11), transparent 70%),
      radial-gradient(min(560px, 85vw) 380px at 8% 112%, rgba(109,93,252,.09), transparent 70%);
    filter: hue-rotate(calc(var(--scrollp, 0) * 80deg));
    animation: glowBreathe 24s ease-in-out infinite alternate;
  }
  @keyframes glowBreathe { from { opacity: 1; } to { opacity: .72; } }
  body > * { position: relative; z-index: 1; }

  /* ── multicolor aurora curtains (landing-only scene) ── */
  .lp-curt { position: fixed; top: -12%; bottom: 8%; left: -16%; right: -16%; pointer-events: none; z-index: 0; mix-blend-mode: screen; will-change: transform, filter;
    -webkit-mask-image: linear-gradient(180deg, #000 6%, transparent 94%); mask-image: linear-gradient(180deg, #000 6%, transparent 94%); }
  .lp-c1 { background: repeating-linear-gradient(94deg, transparent 0 30px, rgba(56,189,248,.12) 36px 46px, rgba(61,220,132,.10) 52px 60px, rgba(122,92,255,.09) 66px 74px, rgba(255,214,120,.06) 80px 86px, transparent 92px 150px); animation: lpswayA 27s ease-in-out infinite alternate; }
  .lp-c2 { background: repeating-linear-gradient(87deg, transparent 0 50px, rgba(61,220,180,.11) 58px 70px, rgba(255,196,130,.07) 78px 86px, rgba(96,165,250,.09) 94px 102px, transparent 110px 180px); animation: lpswayB 41s ease-in-out infinite alternate; }
  .lp-c3 { background: repeating-linear-gradient(91deg, transparent 0 80px, rgba(109,93,252,.10) 88px 102px, rgba(236,110,205,.085) 110px 120px, rgba(52,211,153,.07) 128px 136px, transparent 144px 235px); animation: lpswayC 59s ease-in-out infinite alternate; }
  .lp-c4 { background: repeating-linear-gradient(89deg, transparent 0 120px, rgba(45,212,191,.09) 130px 144px, rgba(244,140,224,.065) 152px 162px, rgba(250,204,21,.05) 170px 178px, rgba(94,234,212,.06) 186px 194px, transparent 202px 320px); animation: lpswayD 73s ease-in-out infinite alternate; }
  @keyframes lpswayA { 0% { transform: translateX(-2.5%) skewX(-3deg); filter: hue-rotate(-32deg); } 50% { filter: hue-rotate(26deg); } 100% { transform: translateX(2%) skewX(2.4deg); filter: hue-rotate(-8deg); } }
  @keyframes lpswayB { 0% { transform: translateX(1.8%) skewX(2deg); filter: hue-rotate(22deg); } 100% { transform: translateX(-2.2%) skewX(-2.6deg); filter: hue-rotate(-34deg); } }
  @keyframes lpswayC { 0% { transform: translateX(-1.2%) skewX(1.4deg); filter: hue-rotate(22deg); } 100% { transform: translateX(1.6%) skewX(-1.8deg); filter: hue-rotate(-18deg); } }
  @keyframes lpswayD { 0% { transform: translateX(1%) skewX(-1.2deg); filter: hue-rotate(-14deg); } 100% { transform: translateX(-1.4%) skewX(1.6deg); filter: hue-rotate(26deg); } }
  /* ── landing scene: pure black + whisper of slowly shifting color ── */
 }
  /* ── header ── */
  header { position: sticky; top: 0; z-index: 50; background: rgba(0,0,0,.72); backdrop-filter: blur(12px); border-bottom: 1px solid var(--line); }
  .nav { display: flex; align-items: center; height: 64px; gap: 32px; }
  .logo { display: flex; align-items: center; gap: 10px; color: var(--white); font-family: 'Saira', sans-serif; font-weight: 700; font-size: 16px; letter-spacing: .09em; }
  .logo svg { width: 30px; height: 30px; display: block; }
  .nav-links { display: flex; gap: 28px; font-family: 'Saira', sans-serif; font-size: 13.5px; font-weight: 600; letter-spacing: .045em; color: var(--gray); }
  .nav .btn { font-family: 'Saira', sans-serif; font-weight: 600; font-size: 13px; letter-spacing: .03em; }
  .nav-links a:hover { color: var(--white); }
  .nav-right { margin-left: auto; display: flex; gap: 10px; align-items: center; }
  .btn { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; font-size: 14px; padding: 9px 18px; border-radius: 8px; border: 1px solid transparent; transition: all .18s; }
  .btn-white { background: var(--white); color: #000; }
  .btn-white:hover { background: #fff; transform: translateY(-1px); box-shadow: 0 0 0 1.5px rgba(255,217,160,.55), 0 8px 30px rgba(255,180,84,.16); }
  .btn-ghost { border-color: var(--line2); color: var(--gray); }
  .btn-ghost:hover { color: var(--white); border-color: rgba(255,255,255,.3); }
  .btn-lg { padding: 12px 24px; font-size: 15px; border-radius: 10px; }

  /* ── full-viewport hero ── */
  .hf { position: relative; min-height: 100dvh; display: flex; align-items: center; overflow: hidden; }
  .hf-inner { position: relative; z-index: 5; width: 100%; }
  .hf-copy { max-width: 620px; }
  .hf h1 { font-family: var(--serif); font-weight: 400; font-size: clamp(46px, 6vw, 82px); line-height: 1.02; letter-spacing: -0.01em; color: var(--white); }
  .hf h1 em { font-style: italic; }
  .hf-lede { margin: 26px 0 36px; font-size: 19px; color: var(--gray); line-height: 1.6; max-width: 52ch; }
  .hf-cta { display: flex; gap: 12px; flex-wrap: wrap; }
  .hf-fine { margin-top: 22px; font-family: var(--mono); font-size: 13.5px; color: var(--gray-dim); }
  .hf-scroll { position: absolute; left: 50%; transform: translateX(-50%); bottom: 26px; z-index: 5; font-family: var(--mono); font-size: 10.5px; letter-spacing: .3em; text-transform: uppercase; color: var(--gray-dim); text-align: center; line-height: 1.8; animation: hfBob 2.6s ease-in-out infinite; }
  @keyframes hfBob { 50% { transform: translateX(-50%) translateY(6px); } }

  .hf-aurora { position: absolute; inset: 0; z-index: 1; filter: hue-rotate(calc(var(--scrollp, 0) * 80deg)); }
  .hf-aurora i { position: absolute; border-radius: 50%; filter: blur(70px); display: block; will-change: transform, opacity; }
  .hf-aurora .a1 { width: min(52vw, 760px); height: min(46vh, 480px); left: 44%; top: 6%; background: radial-gradient(closest-side, rgba(61,123,255,.20), transparent 72%); animation: aur1 34s ease-in-out infinite alternate; }
  .hf-aurora .a2 { width: min(44vw, 620px); height: min(40vh, 420px); left: 58%; top: 42%; background: radial-gradient(closest-side, rgba(109,93,252,.16), transparent 72%); animation: aur2 42s ease-in-out infinite alternate; }
  .hf-aurora .a3 { width: min(36vw, 520px); height: min(34vh, 360px); left: -6%; top: 58%; background: radial-gradient(closest-side, rgba(255,180,84,.08), transparent 72%); animation: aur3 38s ease-in-out infinite alternate; }
  @keyframes aur1 { from { transform: translate(0,0) scale(1); } to { transform: translate(-9vw, 7vh) scale(1.18); } }
  @keyframes aur2 { from { transform: translate(0,0) scale(1.1); opacity:.9; } to { transform: translate(6vw, -9vh) scale(.92); opacity:.65; } }
  @keyframes aur3 { from { transform: translate(0,0) scale(1); } to { transform: translate(7vw, -5vh) scale(1.22); } }
  .hf-floor { position: absolute; left: -10%; right: -10%; bottom: -4%; height: 34%; z-index: 2; pointer-events: none; background: radial-gradient(60% 90% at 50% 100%, rgba(160,140,110,.08), transparent 70%); transform: skewY(-2.2deg); animation: floorSweep 16s ease-in-out infinite alternate; }
  @keyframes floorSweep { from { opacity: .5; transform: skewY(-2.2deg) translateX(-4%); } to { opacity: 1; transform: skewY(-2.2deg) translateX(4%); } }
  .hf-grain { position: absolute; inset: 0; z-index: 3; pointer-events: none; opacity: .05; mix-blend-mode: overlay; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='0.7'/%3E%3C/svg%3E"); }

  /* ── the boundary gate (event horizon) ── */
  /* ── lensed black hole (lightweight WebGL shader; homage to
        steeltroops-ai/blackhole-simulation — design lineage:
        ~/Downloads/parse-resend-variants-2026-08-09/hero-blackhole-sim.html) ── */
  #bh { position: absolute; right: 6%; top: 50%; transform: translateY(-50%) rotate(-45deg); width: min(860px, 56vw); aspect-ratio: 1; z-index: 4; pointer-events: none;
        -webkit-mask-image: radial-gradient(circle closest-side, #000 52%, transparent 96%); mask-image: radial-gradient(circle closest-side, #000 52%, transparent 96%); }
  .hf-bh-receipt { position: absolute; right: 6%; bottom: 10%; z-index: 4; font-family: var(--mono); font-size: 12.5px; letter-spacing: .04em; pointer-events: none; }
  .hf-bh-receipt b { font-weight: 500; color: var(--green); }
  .hf-bh-receipt span { color: var(--gray-dim); }

  /* ── sections ── */
  section { padding: 92px 0; position: relative; }
  .sec-center { text-align: center; }
  html.js .sec-center { opacity: 0; transform: translateY(26px); transition: opacity .8s ease, transform .8s ease; }
  html.js .sec-center.in { opacity: 1; transform: none; }
  .cube { width: 56px; height: 56px; margin: 0 auto 30px; border-radius: 14px; position: relative; background: linear-gradient(145deg, #17181b, #0a0a0b); border: 1px solid var(--line2); box-shadow: 0 20px 50px rgba(255,180,84,.10), inset 0 1px 0 rgba(255,255,255,.08); display: grid; place-items: center; font-family: var(--mono); font-size: 15px; color: var(--white); }
  .cube::after { content: ""; position: absolute; inset: -26px; border-radius: 50%; background: radial-gradient(closest-side, transparent 56%, rgba(255,196,130,.22) 65%, transparent 74%); z-index: -1; }
  .cube::before { content: ""; position: absolute; left: 50%; top: 50%; width: 4px; height: 4px; margin: -2px; border-radius: 50%; background: rgba(255,255,255,.8); box-shadow: 0 0 8px rgba(255,255,255,.5); transform: rotate(0deg) translateY(-46px); animation: cubeMoon 14s linear infinite; }
  .cube.v::before { animation-duration: 18s; animation-direction: reverse; }
  .cube.c::before { animation-duration: 22s; }
  .cube.v::after { background: radial-gradient(closest-side, transparent 56%, rgba(109,93,252,.26) 65%, transparent 74%); }
  .cube.c::after { background: radial-gradient(closest-side, transparent 56%, rgba(6,182,212,.24) 65%, transparent 74%); }
  @keyframes cubeMoon { to { transform: rotate(360deg) translateY(-46px); } }
  h2 { font-size: clamp(34px, 4.6vw, 52px); font-weight: 600; letter-spacing: -0.045em; line-height: 1.08; color: var(--white); }
  h2 .thin { font-family: var(--serif); font-style: italic; font-weight: 400; color: var(--white); letter-spacing: 0; }
  .sec-sub { max-width: 560px; margin: 20px auto 0; font-size: 18px; color: var(--gray); }

  /* aurora hairline accent */
  .aura-line { position: relative; }
  .aura-line::before { content: ""; position: absolute; top: -1px; left: 0; right: 0; height: 1px; z-index: 2; background: linear-gradient(90deg, rgba(61,123,255,.55), rgba(109,93,252,.55) 45%, rgba(255,180,84,.45) 80%, transparent); background-size: 200% 100%; animation: auraLine 12s ease-in-out infinite alternate; }
  @keyframes auraLine { to { background-position: 100% 0; } }

  /* terminal artifact */
  .artifact { max-width: 880px; margin: 60px auto 0; position: relative; text-align: left; }
  .artifact::before { content: ""; position: absolute; inset: -60px 0; pointer-events: none; background: radial-gradient(50% 60% at 50% 40%, rgba(255,180,84,.07), transparent 75%); }
  .term { position: relative; background: var(--panel); border: 1px solid var(--line2); border-radius: 14px; overflow: hidden; box-shadow: 0 40px 100px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.06); }
  .term-tabs { display: flex; gap: 2px; padding: 10px 12px 0; border-bottom: 1px solid var(--line); background: #050506; }
  .term-tabs button { font: inherit; font-family: var(--mono); font-size: 13.5px; color: var(--gray-dim); background: none; border: 0; border-radius: 8px 8px 0 0; padding: 9px 16px; cursor: pointer; }
  .term-tabs button.on { color: var(--white); background: var(--panel); border: 1px solid var(--line); border-bottom-color: var(--panel); margin-bottom: -1px; }
  .term pre { margin: 0; padding: 24px 26px; font: 14.5px/1.8 var(--mono); color: #d6d9dc; overflow-x: auto; }
  .tk-c { color: #5b6063; } .tk-s { color: #8ab8ff; } .tk-k { color: #c0b1ff; } .tk-g { color: var(--green); } .tk-r { color: var(--red); } .tk-a { color: var(--amber); }
  .term .cur { display: inline-block; width: 8px; height: 15px; background: var(--green); vertical-align: -2px; margin-left: 3px; animation: curBlink 1.2s steps(1) infinite; }
  @keyframes curBlink { 50% { opacity: 0; } }
  .term-foot { border-top: 1px solid var(--line); padding: 14px 26px; display: flex; gap: 24px; font-family: var(--mono); font-size: 13.5px; color: var(--gray-dim); flex-wrap: wrap; }
  .term-foot b { color: var(--green); font-weight: 500; }

  /* install strip */
  .install { margin: 26px auto 0; max-width: 880px; background: var(--panel); border: 1px solid var(--line2); border-radius: 12px; overflow: hidden; text-align: left; }
  .install-tabs { display: flex; border-bottom: 1px solid var(--line); background: #050506; }
  .install-tabs button { font: inherit; font-size: 13.5px; font-weight: 600; color: var(--gray-dim); background: none; border: 0; padding: 12px 18px; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; }
  .install-tabs button.on { color: var(--gold); border-bottom-color: var(--amber); }
  .install-body { display: flex; align-items: center; gap: 16px; padding: 16px 18px; }
  .install-body code { font-family: var(--mono); font-size: 13.5px; color: var(--white); flex: 1; overflow-x: auto; white-space: nowrap; }
  .copybtn { font-family: var(--mono); font-size: 12.5px; font-weight: 600; color: var(--gray-dim); background: var(--panel2); border: 1px solid var(--line); border-radius: 7px; padding: 7px 12px; cursor: pointer; white-space: nowrap; transition: all .15s; }
  .copybtn:hover { color: var(--gold); border-color: rgba(255,217,160,.5); }
  .copybtn.done { color: var(--green); border-color: var(--green); }
  .install-foot { font-family: var(--mono); font-size: 12.5px; color: var(--gray-dim); padding: 0 18px 14px; }
  .install-foot b { color: var(--gray); font-weight: 500; }

  .bento { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; max-width: 880px; margin: 26px auto 0; text-align: left; }
  .bcard { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 28px; transition: border-color .2s, box-shadow .2s; }
  .bcard:hover { border-color: rgba(109,93,252,.28); box-shadow: 0 18px 60px rgba(61,123,255,.10), 0 8px 34px rgba(255,180,84,.07); }
  .bcard h3 { font-size: 18.5px; font-weight: 600; color: var(--white); margin-bottom: 8px; letter-spacing: -.01em; }
  .bcard p { font-size: 15.5px; color: var(--gray); }
  .bcard .more { display: inline-block; margin-top: 16px; font-size: 15px; color: var(--gray-dim); }
  .bcard:hover .more { color: var(--white); }

  .rows { max-width: 880px; margin: 56px auto 0; border-top: 1px solid var(--line); text-align: left; }
  .rowi { display: grid; grid-template-columns: 230px 1fr auto; gap: 26px; padding: 24px 6px; border-bottom: 1px solid var(--line); align-items: baseline; }
  .rowi:hover { background: rgba(255,255,255,.015); }
  .rowi h3 { font-size: 17.5px; font-weight: 600; color: var(--white); }
  .rowi p { font-size: 16px; color: var(--gray); }
  .rowi .ep { font-family: var(--mono); font-size: 13.5px; color: var(--gray-dim); }
  .rowi:hover .ep { color: var(--gold); }

  .gov { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; max-width: 980px; margin: 56px auto 0; text-align: left; }
  .gcard { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 24px; transition: border-color .2s, box-shadow .2s; }
  .gcard:hover { border-color: rgba(109,93,252,.28); box-shadow: 0 18px 60px rgba(61,123,255,.10), 0 8px 34px rgba(255,180,84,.07); }
  .gcard .tag { font-family: var(--mono); font-size: 12px; letter-spacing: .16em; color: var(--gray-dim); }
  .gcard h3 { font-size: 17.5px; font-weight: 600; color: var(--white); margin: 12px 0 6px; }
  .gcard p { font-size: 15.5px; color: var(--gray); }

  /* agent prompt */
  .prompt-panel { max-width: 880px; margin: 52px auto 0; background: var(--panel); border: 1px solid var(--line2); border-radius: 14px; overflow: hidden; text-align: left; }
  .prompt-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 14px 18px; border-bottom: 1px solid var(--line); background: #050506; flex-wrap: wrap; }
  .prompt-head b { font-size: 15px; color: var(--white); }
  .prompt-head small { display: block; font-family: var(--mono); font-size: 11px; color: var(--gray-dim); letter-spacing: .08em; text-transform: uppercase; }
  .ptabs { display: inline-flex; gap: 3px; background: var(--panel2); border: 1px solid var(--line); border-radius: 999px; padding: 3px; }
  .ptab { appearance: none; border: 0; border-radius: 999px; background: transparent; color: var(--gray-dim); font: inherit; font-size: 12.5px; font-weight: 700; padding: 7px 12px; cursor: pointer; }
  .ptab.is-active { background: var(--white); color: #000; }
  .prompt-panel pre { margin: 0; padding: 20px; max-height: 300px; overflow: auto; white-space: pre-wrap; word-break: break-word; font: 12.5px/1.7 var(--mono); color: var(--gray); }

  /* pricing */
  .price-strip { max-width: 880px; margin: 56px auto 0; border: 1px solid var(--line); border-radius: 14px; overflow: hidden; text-align: left; }
  .prow { display: grid; grid-template-columns: 160px 1fr auto auto; gap: 20px; align-items: center; padding: 18px 26px; border-top: 1px solid var(--line); }
  .prow:first-child { border-top: 0; }
  .prow:hover { background: rgba(255,255,255,.015); }
  .prow .t { color: var(--white); font-weight: 600; font-size: 16.5px; }
  .prow .d { font-size: 15px; color: var(--gray); }
  .prow .p { font-family: var(--mono); font-size: 16.5px; color: var(--white); }
  .prow .p small { color: var(--gray-dim); font-size: 11.5px; display: block; }
  .prow .go { font-size: 15px; color: var(--gray-dim); }
  .prow:hover .go { color: var(--white); }
  .price-note { max-width: 880px; margin: 18px auto 0; text-align: left; font-family: var(--mono); font-size: 13.5px; color: var(--gray-dim); }

  /* articles */
  .pa-articles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; max-width: 980px; margin: 52px auto 0; text-align: left; }
  .pa-article { display: block; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 22px; color: inherit; transition: border-color .2s; }
  .pa-article:hover { border-color: var(--line2); }
  .pa-article span { font-size: 12px; color: var(--gray-dim); font-family: var(--mono); }
  .pa-article strong { display: block; color: var(--white); font-size: 16px; line-height: 1.3; margin: 8px 0; }
  .pa-article p { margin: 0; color: var(--gray); font-size: 13.5px; line-height: 1.5; }

  /* closer + footer horizon */
  .closer { text-align: center; padding: 150px 0 140px; position: relative; }
  html.js .closer { opacity: 0; transform: translateY(26px); transition: opacity .8s ease, transform .8s ease; }
  html.js .closer.in { opacity: 1; transform: none; }
  .closer::before { content: ""; position: absolute; top: 20%; left: 50%; transform: translateX(-50%); width: min(700px, 100vw); height: 400px; pointer-events: none; background: radial-gradient(closest-side, rgba(109,93,252,.1), transparent 70%); }
  .closer h2 { font-family: var(--serif); font-weight: 400; font-size: clamp(44px, 6vw, 72px); letter-spacing: -0.01em; }
  .closer h2 em { font-style: italic; }
  .closer .hf-cta { justify-content: center; margin-top: 40px; }
  footer { border-top: 1px solid var(--line); padding: 44px 0 60px; font-size: 15px; color: var(--gray-dim); position: relative; overflow: hidden; }
  footer::before { content: ""; position: absolute; left: 50%; bottom: -20px; transform: translateX(-50%); width: min(180vw, 2400px); height: 240px; pointer-events: none; background: radial-gradient(50% 100% at 50% 100%, transparent 55%, rgba(255,196,130,.13) 66%, rgba(255,180,84,.04) 76%, transparent 86%); }
  .frow { display: flex; gap: 26px; flex-wrap: wrap; }
  .frow a:hover { color: var(--white); }
  .limits { margin-top: 16px; max-width: 82ch; }

  @media (max-width: 1100px) {
    #bh, .hf-bh-receipt { display: none; }
  }
  @media (max-width: 900px) {
    .hf-copy { max-width: 100%; }
    .bento, .gov { grid-template-columns: 1fr; }
    .pa-articles { grid-template-columns: 1fr; }
    .rowi { grid-template-columns: 1fr; gap: 8px; padding: 20px 4px; }
    .prow { grid-template-columns: 1fr auto; row-gap: 6px; }
    .prow .d { grid-column: 1 / -1; }
    section { padding: 64px 0; }
    .closer { padding: 100px 0 90px; }
  }
  @media (max-width: 720px) {
    .nav-links { display: none; }
    .nav-right .btn-ghost { display: none; }
    .nav { gap: 14px; }
    .hf-cta { flex-direction: column; align-items: flex-start; }
    .term pre { font-size: 12.5px; padding: 18px 16px; }
    .install-body code { font-size: 12px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .hf-scroll, .cube::before, .term .cur, .aura-line::before, body::after { animation: none; }
    .shoot { display: none; }
    .sec-center, .closer { opacity: 1; transform: none; transition: none; }
  }
  </style>
</head>
<body${bodyAttrs}>


<header>
  <div class="wrap nav">
    <a class="logo" href="/">${getLogoMarkSvg()}Parse</a>
    <nav class="nav-links">
      <a href="/playground">Playground</a><a href="/docs">Docs</a><a href="/technology">Technology</a><a href="/pricing">Pricing</a><a href="/blog">Blog</a><a href="/about">About</a>
    </nav>
    <div class="nav-right">
      <a class="btn btn-ghost" href="/admin/login">Sign in</a>
      <a class="btn btn-white" href="/get-started">Install Parse</a>
    </div>
  </div>
</header>

<div class="hf">

  <canvas id="bh" aria-hidden="true"></canvas>
  <div class="hf-bh-receipt" aria-hidden="true"><b>every crossing</b> <span>· receipted</span></div>

  <div class="wrap hf-inner">
    <div class="hf-copy">
      <h1>${hero.l1}<br><em>${hero.l2}</em></h1>
      <p class="hf-lede">${hero.lede}</p>
      <div class="hf-cta">
        <a class="btn btn-white btn-lg" href="/get-started">Install Parse</a>
        <a class="btn btn-ghost btn-lg" href="/docs">Documentation</a>
      </div>
      <div class="hf-fine">npm install @parsethis/sdk · no credit card, no sales call</div>
    </div>
  </div>

  <div class="hf-scroll">scroll<br>↓</div>
</div>

<section class="sec-center">
  <div class="wrap">
    <div class="cube">/</div>
    <h2>Integrate <span class="thin">this afternoon</span></h2>
    <p class="sec-sub">One POST at the boundary. Score, categories, action — and a receipt.</p>
    <div class="artifact">
      <div class="term aura-line">
        <div class="term-tabs"><button class="on">cURL</button><button disabled>response</button></div>
        <pre><span class="tk-c"># screen a retrieved document before your agent acts on it</span>
curl -s ${baseUrl}/v1/parse \\
  -H <span class="tk-s">"Authorization: Bearer $PARSE_API_KEY"</span> \\
  -d <span class="tk-s">'{"prompt": "&lt;untrusted content&gt;"}'</span>

<span class="tk-c"># →</span> {
<span class="tk-c">    </span><span class="tk-k">"risk_score"</span>: <span class="tk-r">8.7</span>,
<span class="tk-c">    </span><span class="tk-k">"verdict"</span>: <span class="tk-s">"critical"</span>,
<span class="tk-c">    </span><span class="tk-k">"categories"</span>: [<span class="tk-s">"instruction_override"</span>, <span class="tk-s">"data_exfiltration"</span>],
<span class="tk-c">    </span><span class="tk-k">"recommended_action"</span>: <span class="tk-a">"block"</span>,
<span class="tk-c">    </span><span class="tk-k">"trace_id"</span>: <span class="tk-s">"prs_7fd2"</span>  <span class="tk-c">// your receipt</span>
  }<span class="cur"></span></pre>
        <div class="term-foot"><span>${DETECTION_FACTS.pipelineLayers.length} detection layers</span><span>${DETECTION_FACTS.riskCategoryCount} risk categories</span><span>receipt on <b>every</b> verdict</span></div>
      </div>
    </div>
    <div class="install">
      <div class="install-tabs" role="tablist" aria-label="Install method">
        <button type="button" class="on" data-t="sdk">SDK</button>
        <button type="button" data-t="mcp">Claude Code / MCP</button>
        <button type="button" data-t="curl">cURL</button>
      </div>
      <div class="install-body">
        <code id="pa-ins">npm install @parsethis/sdk</code>
        <button type="button" class="copybtn" id="pa-cp">COPY</button>
      </div>
      <div class="install-foot" id="pa-insfoot"><b>then:</b> wrap your agent — screening runs at every trust boundary.</div>
    </div>
    <div class="bento">
      <div class="bcard"><h3>Test Lab</h3><p>Blind fixtures probe whether your agent resists injection — before your customers do.</p><a class="more" href="/playground">Open the playground →</a></div>
      <div class="bcard"><h3>Monitor first, block later</h3><p>Ship in monitor mode, then dial to block per environment. Every change is versioned.</p><a class="more" href="/docs">Read about the dial →</a></div>
    </div>
  </div>
</section>

<section class="sec-center">
  <div class="wrap">
    <div class="cube v">◈</div>
    <h2>Four surfaces. <span class="thin">One decision.</span></h2>
    <p class="sec-sub">Screen before authority — at all four places an agent can be steered.</p>
    <div class="rows">
      <div class="rowi"><h3>User &amp; RAG input</h3><p>Injection and hidden instructions in what it reads.</p><span class="ep">POST /v1/parse</span></div>
      <div class="rowi"><h3>Tool &amp; browser output</h3><p>Data that parses like instruction.</p><span class="ep">POST /v1/parse</span></div>
      <div class="rowi"><h3>Generated output</h3><p>Screened before users, tools, or memory.</p><span class="ep">POST /v1/screen-output</span></div>
      <div class="rowi"><h3>Agent handoff</h3><p>Delegation verified before work is accepted.</p><span class="ep">POST /v1/agent/trust/verify</span></div>
    </div>
  </div>
</section>

<section class="sec-center">
  <div class="wrap">
    <div class="cube c">§</div>
    <h2>Screening is the floor.<br><span class="thin">Governance is the product.</span></h2>
    <p class="sec-sub">Six controls around the pipeline. Evidence your auditor can read.</p>
    <div class="gov">
      <div class="gcard"><div class="tag">REGISTRY</div><h3>Every agent on record</h3><p>Status, risk, owner, last seen. Freeze or retire from one place.</p></div>
      <div class="gcard"><div class="tag">POLICY</div><h3>Enforcement you dial</h3><p>Monitor, warn, or block — per environment, versioned with diffs.</p></div>
      <div class="gcard"><div class="tag">DATA</div><h3>Boundaries on data</h3><p>Grants, egress control, and volume budgets per agent.</p></div>
      <div class="gcard"><div class="tag">EVIDENCE</div><h3>Receipts &amp; SIEM</h3><p>Category, score, action, trace ID — sealed and forwarded.</p></div>
      <div class="gcard"><div class="tag">ATTESTATION</div><h3>Coverage, proven</h3><p>Screened vs. unscreened traffic over any window.</p></div>
      <div class="gcard"><div class="tag">CROSSWALK</div><h3>Framework mapping</h3><p>OWASP LLM, NIST AI RMF, EU AI Act, ISO 42001, and SOC 2 TSC — certifications on the roadmap, controls aligned today.</p></div>
    </div>
  </div>
</section>

<section class="sec-center">
  <div class="wrap">
    <div class="cube">⌁</div>
    <h2>Hand this to the agent. <span class="thin">It wires itself.</span></h2>
    <p class="sec-sub">A copy-paste integration prompt for any agent runtime — Bearer-key first, x402 when no account exists.</p>
    <div class="prompt-panel aura-line">
      <div class="prompt-head">
        <div><small>Copy into an agent</small><b>Integration prompt</b></div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <div class="ptabs" role="tablist" aria-label="Authentication path">
            <button type="button" role="tab" aria-selected="true" data-route="bearer" class="ptab is-active">Bearer key</button>
            <button type="button" role="tab" aria-selected="false" data-route="x402" class="ptab">x402</button>
          </div>
          <button type="button" class="copybtn pa-copy-prompt">COPY</button>
        </div>
      </div>
      <pre tabindex="0"><code class="pa-prompt-text"></code></pre>
    </div>
  </div>
</section>

<section class="sec-center">
  <div class="wrap">
    <div class="cube v">$</div>
    <h2>Start free. <span class="thin">Scale on evidence.</span></h2>
    <div class="price-strip aura-line">
      <div class="prow"><span class="t">Free</span><span class="d">${PLAN_LIMITS.free.requestsPerMinute} req/min · all endpoints · test lab</span><span class="p">$0<small>forever</small></span><a class="go" href="/get-started">Install →</a></div>
      <div class="prow"><span class="t">Pro</span><span class="d">10K screenings · full pipeline · dashboard</span><span class="p">$49<small>/mo</small></span><a class="go" href="/pricing">Deploy →</a></div>
      <div class="prow"><span class="t">Team</span><span class="d">50K screenings · registry · SIEM forwarding</span><span class="p">$199<small>/mo</small></span><a class="go" href="/pricing">Scale →</a></div>
      <div class="prow"><span class="t">Compliance</span><span class="d">attestation · evidence packs · review support</span><span class="p">$999<small>/mo</small></span><a class="go" href="/pricing">Engage →</a></div>
    </div>
    <div class="price-note">$47 one-time Security Audit · x402 pay-per-call from ${X402_ENDPOINTS.parse.price} — ${X402_PAYMENT.currency} on ${X402_PAYMENT.networkName}, no account required.</div>
  </div>
</section>

<section class="sec-center">
  <div class="wrap">
    <div class="cube c">✎</div>
    <h2>Field <span class="thin">notes.</span></h2>
    <div class="pa-articles">
      ${blogCardsHtml}
    </div>
  </div>
</section>

<div class="closer">
  <div class="wrap">
    <h2>Agent governance,<br><em>receipted.</em></h2>
    <div class="hf-cta">
      <a class="btn btn-white btn-lg" href="/get-started">Install Parse</a>
      <a class="btn btn-ghost btn-lg" href="/support">Talk to security engineering</a>
    </div>
  </div>
</div>

<footer>
  <div class="wrap">
    <div class="frow mono" style="font-size:12.5px">
      <a href="/llms.txt">/llms.txt</a><a href="/openapi.json">/openapi.json</a><a href="/mcp">/mcp</a><a href="/trust">/trust</a><a href="/status">/status</a>
    </div>
    <p class="limits">Detection reduces risk; it does not replace least-privilege tools or output validation. © 2026 Parse · agent governance &amp; compliance.</p>
  </div>
</footer>

<script>
(function () {
  document.documentElement.classList.add('js');
  // scroll-driven hue
  var root = document.documentElement, ticking = false;
  function update() {
    ticking = false;
    var max = document.body.scrollHeight - window.innerHeight;
    var p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    root.style.setProperty('--scrollp', p.toFixed(4));
  }
  window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  update();

  // section reveals
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { threshold: 0.12 });
  document.querySelectorAll('.sec-center, .closer').forEach(function (el) { io.observe(el); });

  // install strip
  var snippets = ${installPayload};
  var ins = document.getElementById('pa-ins'), foot = document.getElementById('pa-insfoot'), cp = document.getElementById('pa-cp');
  document.querySelectorAll('.install-tabs button').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('.install-tabs button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      var sn = snippets[b.getAttribute('data-t')];
      if (sn && ins && foot) { ins.textContent = sn.code; foot.innerHTML = sn.foot; }
      if (cp) { cp.textContent = 'COPY'; cp.classList.remove('done'); }
    });
  });
  if (cp) cp.addEventListener('click', function () {
    if (navigator.clipboard) navigator.clipboard.writeText(ins ? ins.textContent || '' : '');
    cp.textContent = 'COPIED'; cp.classList.add('done');
    setTimeout(function () { cp.textContent = 'COPY'; cp.classList.remove('done'); }, 1600);
  });

  // agent prompt tabs
  var prompts = ${promptsPayload};
  var tabs = document.querySelectorAll('.ptab');
  var code = document.querySelector('.pa-prompt-text');
  var copy = document.querySelector('.pa-copy-prompt');
  function setRoute(route) {
    if (!prompts[route] || !code) return;
    tabs.forEach(function (tab) {
      var active = tab.dataset.route === route;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    code.textContent = prompts[route];
  }
  tabs.forEach(function (tab) { tab.addEventListener('click', function () { setRoute(tab.dataset.route); }); });
  setRoute('bearer');
  if (copy) copy.addEventListener('click', function () {
    var text = code ? code.textContent || '' : '';
    navigator.clipboard.writeText(text).then(function () {
      copy.textContent = 'COPIED'; copy.classList.add('done');
      setTimeout(function () { copy.textContent = 'COPY'; copy.classList.remove('done'); }, 1600);
    }).catch(function () { copy.textContent = 'Press Cmd+C'; });
  });
})();

// Lensed black hole hero — lightweight homage to steeltroops-ai/blackhole-simulation:
// one raw-WebGL fragment shader, iterative geodesic bending, thin accretion disc
// with Doppler beaming, photon ring from the loop, lensed procedural starfield,
// slow orbit + hue drift. No framework, DPR capped, pauses offscreen.
// Source mockup: ~/Downloads/parse-resend-variants-2026-08-09/hero-blackhole-sim.html
(function(){
  var canvas = document.getElementById('bh');
  if (!canvas) return;
  var still = new URLSearchParams(location.search).has('still');
  var gl = canvas.getContext('webgl', { alpha:true, antialias:false, depth:false, stencil:false, powerPreference:'low-power', preserveDrawingBuffer: still });
  if (!gl) return;
  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  var vs = 'attribute vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }';
  var fs = \`
precision highp float;
uniform vec2 R; uniform float T;

mat3 hueRot(float a){
  float c = cos(a), s = sin(a);
  return mat3(.299,.587,.114,.299,.587,.114,.299,.587,.114)
       + c * (mat3(1,0,0,0,1,0,0,0,1) - mat3(.299,.587,.114,.299,.587,.114,.299,.587,.114))
       + s * mat3(-.3,-.588,.886, .143,-.353,.258, -.787,.715,.072);
}
float hash(vec3 q){ return fract(sin(dot(q, vec3(127.1,311.7,74.7))) * 43758.5453); }
vec3 stars(vec3 d){
  vec3 q = normalize(d);
  vec3 cell = floor(q * 90.);
  float h = hash(cell);
  float star = smoothstep(.995, 1., h) * (.35 + .45 * hash(cell + 1.3));
  return vec3(star) * vec3(.85, .9, 1.);
}
void main(){
  vec2 uv = (gl_FragCoord.xy - .5 * R) / R.y;
  vec3 ro = vec3(0., .55, -7.2);
  vec3 rd = normalize(vec3(uv.x, uv.y - .04, 1.05));
  float ca = -.10;
  mat3 tilt = mat3(1.,0.,0., 0.,cos(ca),-sin(ca), 0.,sin(ca),cos(ca));
  ro = tilt * ro; rd = tilt * rd;
  float yaw = T * .06;
  mat3 orb = mat3(cos(yaw),0.,sin(yaw), 0.,1.,0., -sin(yaw),0.,cos(yaw));
  ro = orb * ro; rd = orb * rd;

  vec3 p = ro, v = rd;
  vec3 col = vec3(0.);
  float captured = 0.;
  float w = 1.;
  float jit = .9 + .2 * hash(vec3(gl_FragCoord.xy, 7.));

  for (int i = 0; i < 110; i++) {
    float r = length(p);
    if (r < .9) { captured = 1.; break; }
    float dt = clamp(.05 + .055 * r, .06, .3) * jit;
    vec3 acc = -1.55 * p / (r * r * r * r);
    v += acc * dt;
    vec3 pp = p;
    p += v * dt;
    if (pp.y * p.y < 0.) {
      float t = pp.y / (pp.y - p.y);
      vec3 hit = mix(pp, p, t);
      float hr = length(hit.xz);
      if (hr > 1.3 && hr < 4.6) {
        float ang = atan(hit.z, hit.x);
        float doppler = 1. + .6 * sin(ang) / sqrt(hr);
        float arms = sin(ang * 2. - hr * 3.5 + T * 1.1);
        float fine = sin(ang * 9. - hr * 11. + T * 2.2);
        float bands = .72 + .28 * arms + .10 * fine;
        float glow = pow(1.55 / hr, 2.2) * bands * doppler;
        vec3 disc = mix(vec3(1.0,.78,.42), vec3(1.0,.45,.16), clamp((hr-1.3)/3.3, 0., 1.));
        disc = mix(disc, vec3(1.02,.98,.9), clamp((doppler - 1.)*.5, 0., .35));
        col += disc * glow * .55 * w;
        w *= .5;
      }
    }
  }
  if (captured < .5) col += stars(v) * .8;
  col = clamp(hueRot(T * .026) * col, 0., 1.3);
  float vig = smoothstep(1.15, .45, length(uv));
  gl_FragColor = vec4(col * vig, 1.);
}\`;

  function shader(type, src){ var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s)); return s; }
  var prog = gl.createProgram();
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog); gl.useProgram(prog);
  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  var uR = gl.getUniformLocation(prog, 'R'), uT = gl.getUniformLocation(prog, 'T');

  function size(){
    var dpr = Math.min(devicePixelRatio || 1, 1.25);
    var w = canvas.clientWidth * dpr, h = canvas.clientHeight * dpr;
    if (canvas.width !== w) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
  }
  var visible = true, raf = 0;
  new IntersectionObserver(function (e) { visible = e[0].isIntersecting; if (visible && !raf && !still && !reduced) loop(); }).observe(canvas);
  function frame(t){
    size();
    gl.uniform2f(uR, canvas.width, canvas.height);
    gl.uniform1f(uT, t * .001);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function loop(){ raf = requestAnimationFrame(function (ts) { frame(ts); raf = 0; if (visible) loop(); }); }
  if (still || reduced) { var tSec = parseFloat(new URLSearchParams(location.search).get('t')) || 9; size(); frame(tSec * 1000); window.__bhOK = (gl.getError() === 0); window.__bhShot = function () { return canvas.toDataURL('image/png'); }; } else loop();
})();

</script>

</body>
</html>`;
}

