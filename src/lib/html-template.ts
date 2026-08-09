import { PRODUCT } from "./product-facts.js";
import { getLogoMarkSvg } from "./logo.js";

export interface PageOptions {
  title: string;
  description: string;
  path: string;
  content: string;
  baseUrl: string;
  jsonLd?: object[];
  lastUpdated?: string;
  breadcrumbs?: { name: string; href: string }[];
  ogImage?: string;
  author?: string;
  headExtra?: string;
  /** Extra attributes for the <body> tag (e.g. data-experiment, data-variant). */
  bodyAttributes?: string;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

export function renderPage(options: PageOptions): string {
  const {
    title,
    description,
    path,
    content,
    baseUrl,
    jsonLd,
    lastUpdated,
    breadcrumbs,
    ogImage,
    author,
    headExtra,
    bodyAttributes,
  } = options;

  const canonicalUrl = `${baseUrl}${path}`;
  const safeTitle = escapeHtml(title);
  const safeDesc = escapeHtml(description);
  const ogImg = ogImage || `${baseUrl}/og-image.svg?v=eclipse`;

  // --- JSON-LD blocks ---
  let jsonLdBlocks = "";
  if (jsonLd && jsonLd.length > 0) {
    jsonLdBlocks = jsonLd
      .map(
        (obj) =>
          `<script type="application/ld+json">${JSON.stringify(obj).replace(/<\//g, "<\\/")}</script>`
      )
      .join("\n    ");
  }

  // --- Breadcrumbs HTML ---
  let breadcrumbHtml = "";
  if (breadcrumbs && breadcrumbs.length > 0) {
    const items = breadcrumbs
      .map(
        (b, i) =>
          `<li itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem">` +
          (i < breadcrumbs.length - 1
            ? `<a itemprop="item" href="${escapeHtml(b.href)}"><span itemprop="name">${escapeHtml(b.name)}</span></a>`
            : `<span itemprop="name">${escapeHtml(b.name)}</span>`) +
          `<meta itemprop="position" content="${i + 1}"></li>`
      )
      .join("");
    breadcrumbHtml = `<nav aria-label="breadcrumb" class="breadcrumb" itemscope itemtype="https://schema.org/BreadcrumbList"><ol>${items}</ol></nav>`;
  }

  // --- Last updated ---
  let lastUpdatedHtml = "";
  if (lastUpdated) {
    lastUpdatedHtml = `<time datetime="${escapeHtml(lastUpdated)}" class="last-updated">Last updated: ${formatDate(lastUpdated)}</time>`;
  }

  // --- Author meta ---
  const authorMeta = author
    ? `<meta name="author" content="${escapeHtml(author)}">`
    : "";

  // --- article:modified_time ---
  const modifiedTimeMeta = lastUpdated
    ? `<meta property="article:modified_time" content="${escapeHtml(lastUpdated)}">`
    : "";

  // Build nav links with aria-current for active page
  const navLinks = [
    { href: "/playground", label: "Playground" },
    { href: "/docs", label: "Docs" },
    { href: "/technology", label: "Technology" },
    { href: "/pricing", label: "Pricing" },
    { href: "/blog", label: "Blog" },
    { href: "/about", label: "About" },
  ];
  const navLinksHtml = navLinks
    .map(
      (l) =>
        `<a href="${l.href}"${path === l.href ? ' aria-current="page"' : ""}>${l.label}</a>`
    )
    .join("\n      ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle} | ${PRODUCT.name}</title>
  <meta name="description" content="${safeDesc}">
  <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  <meta property="og:title" content="${safeTitle}">
  <meta property="og:description" content="${safeDesc}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="og:site_name" content="${PRODUCT.name}">
  <meta property="og:image" content="${escapeHtml(ogImg)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${safeTitle}">
  <meta name="twitter:description" content="${safeDesc}">
  <meta name="twitter:image" content="${escapeHtml(ogImg)}">
  <meta name="theme-color" content="#000000">
  <link rel="icon" href="/favicon.svg?v=eclipse" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Lexend:wght@300;400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&family=Saira:wght@500;600;700&display=swap" rel="stylesheet">
  ${authorMeta}
  ${modifiedTimeMeta}
  ${jsonLdBlocks}
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #000000;
      --surface: #0a0a0b;
      --surface2: #131316;
      --surface3: #1a1a1f;
      --border: rgba(255,255,255,0.09);
      --border2: rgba(255,255,255,0.16);
      --input: #0a0a0b;
      --text: #fafafa;
      --text-dim: #c3c7ca;
      --text-soft: #9a9ea2;
      --accent: #3d7bff;
      --accent2: #8ab8ff;
      --accent-dim: rgba(61,123,255,0.12);
      --green: #3ddc84;
      --green-dim: rgba(61,220,132,0.12);
      --yellow: #ffb454;
      --yellow-dim: rgba(255,180,84,0.12);
      --destructive: #ff5d5d;
      --destructive-dim: rgba(255,93,93,0.12);
      --gold: #ffd9a0;
      --ring: #3d7bff;
      --radius: 8px;
      --shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
      --serif: 'Instrument Serif', serif;
    }
    body {
      font-family: 'Lexend', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      letter-spacing: 0.005em;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      font-optical-sizing: auto;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    /* Approach Vector — the platform scene. A faint spacetime grid above; below
       the fold, a vast black planet whose limb carries a slowly rotating
       multicolor corona (140s revolution, 14s breathe). Geometry matches the
       approved mockup: ring band 84-95% of a 338vw circle centered 131vw below
       the viewport. */
    body::before {
      content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 0;
      background: repeating-radial-gradient(120% 90% at 50% 124%, transparent 0 46px, rgba(255,255,255,.028) 47px 48px);
    }
    body::after {
      content: ""; position: fixed; left: 50%; bottom: -300vw; width: 338vw; height: 338vw;
      transform: translateX(-50%) rotate(0deg); border-radius: 50%; pointer-events: none; z-index: 0;
      filter: blur(3px); will-change: transform, opacity;
      background: conic-gradient(from 0deg,
        rgba(255,217,160,.44) 0%, rgba(255,180,84,.33) 9%, rgba(61,220,132,.30) 20%,
        rgba(56,189,248,.35) 34%, rgba(122,92,255,.35) 50%, rgba(236,110,205,.32) 66%,
        rgba(255,138,61,.33) 82%, rgba(255,217,160,.44) 100%);
      -webkit-mask: radial-gradient(closest-side, transparent 0 84.2%, rgba(0,0,0,.9) 85%, #000 86%, rgba(0,0,0,.35) 90%, transparent 95.5%);
      mask: radial-gradient(closest-side, transparent 0 84.2%, rgba(0,0,0,.9) 85%, #000 86%, rgba(0,0,0,.35) 90%, transparent 95.5%);
      animation: coronaSpin 140s linear infinite, coronaBreathe 14s ease-in-out infinite alternate;
    }
    @keyframes coronaSpin { to { transform: translateX(-50%) rotate(360deg); } }
    @keyframes coronaBreathe { from { opacity: .62; } to { opacity: .9; } }
    @media (prefers-reduced-motion: reduce) {
      body::before, body::after { animation: none; }
    }
    body > * { position: relative; z-index: 1; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { color: var(--accent2); }
    a:focus-visible, button:focus-visible, summary:focus-visible, textarea:focus-visible, select:focus-visible, input:focus-visible {
      outline: 2px solid var(--ring);
      outline-offset: 2px;
    }

    /* Layout */
    .container { max-width: 1180px; margin: 0 auto; padding: 32px 24px; }

    /* Header nav */
    .site-header {
      position: sticky;
      top: 0;
      z-index: 100;
      background: rgba(0, 0, 0, 0.72);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border);
    }
    .site-header nav {
      max-width: 1180px;
      margin: 0 auto;
      padding: 14px 24px;
      display: flex;
      align-items: center;
      gap: 24px;
    }
    .site-header .logo {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.045em;
      color: var(--text);
      text-decoration: none;
      margin-right: auto;
      display: flex;
      align-items: center;
      gap: 9px;
      line-height: 1;
    }
    .parse-logo-mark {
      width: 32px;
      height: 32px;
      flex-shrink: 0;
      display: block;
    }
    .logo-lockup { display:flex; align-items:center; gap:12px; }
    /* Top-bar face: Saira — wordmark + top navigation only; UI text is Lexend. */
    .logo-primary { color:var(--text); font-family:'Saira',sans-serif; font-weight:700; font-size:17px; letter-spacing:.09em; }
    .site-header .logo:hover { color: var(--text); text-decoration: none; }
    .site-header nav a {
      color: var(--text-dim);
      font-family: 'Saira', sans-serif;
      font-size: 13.5px;
      font-weight: 600;
      letter-spacing: .045em;
      text-decoration: none;
      transition: color 0.2s;
      position: relative;
    }
    .site-header nav a:hover {
      color: var(--text);
      text-decoration: none;
    }
    .site-header nav a[aria-current="page"] {
      color: var(--gold);
    }
    .site-header nav a[aria-current="page"]::after {
      content: '';
      position: absolute;
      bottom: -8px;
      left: 0;
      right: 0;
      height: 2px;
      background: var(--gold);
      border-radius: 1px;
    }
    .site-header nav a.external::after {
      content: '\\2197';
      margin-left: 3px;
      font-size: 11px;
      position: static;
      background: none;
      height: auto;
    }
    .site-header .nav-signin {
      border: 1px solid var(--border2);
      color: var(--text-dim);
      padding: 8px 15px;
      border-radius: var(--radius);
      font-weight: 400;
      font-size: 11px;
      text-decoration: none;
      transition: all 0.2s;
    }
    .site-header .nav-signin:hover { color: var(--text); border-color: rgba(255,255,255,.3); text-decoration: none; }
    .site-header .nav-cta {
      background: var(--text);
      color: #000 !important;
      padding: 9px 16px;
      border-radius: var(--radius);
      font-weight: 400;
      font-size: 11px;
      text-decoration: none;
      transition: all 0.2s;
    }
    .site-header .nav-cta:hover { background: #fff; text-decoration: none; box-shadow: 0 0 0 1.5px rgba(255,217,160,.55), 0 6px 24px rgba(255,180,84,.16); }

    /* Headings */
    h1 {
      font-family: var(--serif);
      font-size: 2.6em;
      font-weight: 400;
      letter-spacing: -0.01em;
      color: var(--text);
      margin-bottom: 12px;
      line-height: 1.2;
    }
    @media (forced-colors: active) {
      h1, .site-header .logo { color: ButtonText; }
    }
    h2 {
      font-size: 1.5em;
      font-weight: 600;
      letter-spacing: -0.025em;
      margin-top: 2.5em;
      margin-bottom: 0.6em;
      color: var(--text);
    }
    h3 {
      font-size: 1.15em;
      font-weight: 600;
      letter-spacing: -0.015em;
      margin-top: 1.5em;
      margin-bottom: 0.4em;
      color: var(--text);
    }

    /* Answer capsule (GEO pattern) */
    .answer-capsule {
      font-size: 1.1em;
      line-height: 1.7;
      color: var(--text-dim);
      margin-bottom: 1.5em;
    }

    /* Section divider — Miller's Law visual chunking */
    .section-chunk {
      padding: 40px 0;
      border-bottom: 1px solid var(--border);
    }
    .section-chunk:last-child { border-bottom: none; }
    .section-chunk h2:first-child { margin-top: 0; }

    /* Card component (shadcn-style) */
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 24px;
      box-shadow: 0 1px 0 rgba(24,36,50,0.02);
      transition: border-color 0.2s;
    }
    .card:hover { border-color: var(--border2); }
    .card-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
    }

    /* Badge component (shadcn-style) */
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 3px 10px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.01em;
      line-height: 1.4;
      white-space: nowrap;
    }
    .badge-default { background: var(--surface2); color: var(--text); border: 1px solid var(--border); }
    .badge-accent { background: var(--accent-dim); color: var(--accent2); }
    .badge-green { background: var(--green-dim); color: var(--green); }
    .badge-destructive { background: var(--destructive-dim); color: var(--destructive); }
    .badge-yellow { background: var(--yellow-dim); color: var(--yellow); }

    /* Button component (shadcn-style) */
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 10px 24px;
      border-radius: var(--radius);
      font-size: 14px;
      font-weight: 600;
      font-family: inherit;
      letter-spacing: -0.01em;
      cursor: pointer;
      text-decoration: none;
      border: none;
      transition: all 0.2s;
      white-space: nowrap;
    }
    .btn-primary { background: var(--text); color: #000; }
    .btn-primary:hover { background: #fff; color: #000; box-shadow: 0 0 0 1.5px rgba(255,217,160,.55), 0 8px 30px rgba(255,180,84,.16); }
    .btn-outline { background: transparent; color: var(--text-dim); border: 1px solid var(--border2); }
    .btn-outline:hover { background: transparent; color: var(--text); border-color: rgba(255,255,255,.3); }
    .btn-ghost { background: transparent; color: var(--text-dim); }
    .btn-ghost:hover { background: var(--surface2); color: var(--text); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }

    /* Tables */
    .table-wrapper {
      overflow-x: auto;
      border-radius: var(--radius);
      border: 1px solid var(--border);
      margin: 1.5em 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }
    th {
      background: var(--surface);
      text-align: left;
      padding: 12px 16px;
      font-weight: 600;
      font-size: 13px;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
    }
    td {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
    }
    tr:last-child td { border-bottom: none; }
    tbody tr { transition: background 0.15s; }
    tbody tr:hover { background: var(--surface2); }

    /* Terminal code block */
    .terminal {
      position: relative;
      background: #0a0a0b;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 16px 48px 16px 16px;
      font-family: 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace;
      font-size: 13px;
      color: #b7f0ce;
      white-space: pre-wrap;
      word-break: break-all;
      line-height: 1.6;
      overflow-x: auto;
    }

    /* Inline code */
    code {
      background: var(--surface2);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace;
      font-size: 0.85em;
    }
    pre code {
      display: block;
      padding: 16px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow-x: auto;
      font-size: 13px;
      line-height: 1.6;
    }

    /* Breadcrumbs */
    nav.breadcrumb {
      font-size: 13px;
      color: var(--text-dim);
      margin-bottom: 24px;
    }
    nav.breadcrumb ol {
      list-style: none;
      display: flex;
      flex-wrap: wrap;
      gap: 0;
    }
    nav.breadcrumb li::after {
      content: '/';
      margin: 0 8px;
      color: var(--text-soft);
    }
    nav.breadcrumb li:last-child::after { content: ''; margin: 0; }
    nav.breadcrumb a { color: var(--text-dim); }
    nav.breadcrumb a:hover { color: var(--accent); }
    nav.breadcrumb li:last-child { color: var(--text); }

    /* Last updated */
    .last-updated {
      font-size: 13px;
      color: var(--text-dim);
      display: block;
      margin-bottom: 16px;
    }

    /* Aside / callout */
    aside {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 20px;
      margin: 24px 0;
    }

    /* Paragraphs and lists */
    p { margin-bottom: 1em; }
    ul, ol { margin-bottom: 1em; padding-left: 1.5em; }
    li { margin-bottom: 0.4em; }

    /* Footer */
    .site-footer {
      padding: 48px 24px 32px;
      font-size: 13px;
      color: var(--text-dim);
      border-top: 1px solid var(--border);
      margin-top: 64px;
      position: relative;
      overflow: hidden;
    }
    .site-footer .footer-inner {
      max-width: 1180px;
      margin: 0 auto;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 32px;
      flex-wrap: wrap;
    }
    .site-footer .footer-brand {
      font-family: 'Saira', sans-serif;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: .08em;
      color: var(--text);
      margin-bottom: 6px;
    }
    .site-footer a {
      color: var(--text-dim);
      text-decoration: none;
      transition: color 0.15s;
    }
    .site-footer a:hover { color: var(--text); }
    .site-footer nav { display: contents; }
    .footer-links {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 24px;
    }

    /* Copy button */
    .copy-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      padding: 5px 12px;
      background: var(--surface2);
      color: var(--text-dim);
      border: 1px solid var(--border);
      border-radius: 6px;
      font-size: 12px;
      font-family: inherit;
      cursor: pointer;
      transition: all 0.15s;
    }
    .copy-btn:hover { color: var(--text); border-color: var(--border2); }
    .copy-btn.copied { background: var(--green-dim); color: var(--green); border-color: var(--green); }

    /* Screen reader only (a11y) */
    .sr-only { position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0; }
    .sr-only:focus { position:static;width:auto;height:auto;padding:8px 16px;margin:0;overflow:visible;clip:auto;white-space:normal;background:var(--accent);color:#000;z-index:200; }

    /* Muted text utility */
    .muted { color: var(--text-dim); }

    /* Fade-in animation for page load */
    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .animate-in { animation: fadeInUp 0.4s ease-out both; }
    .animate-in-delay-1 { animation-delay: 0.08s; }
    .animate-in-delay-2 { animation-delay: 0.16s; }
    .animate-in-delay-3 { animation-delay: 0.24s; }

    /* Mobile nav */
    .nav-toggle { display:none;background:none;border:none;color:var(--text);font-size:24px;cursor:pointer;padding:4px; }
    @media (max-width: 640px) {
      .container { padding: 20px 16px; }
      h1 { font-size: 1.75em; }
      .nav-toggle { display:block; }
      .site-header nav { padding: 12px 16px; gap: 12px; flex-wrap: wrap; }
      .site-header .logo { font-size: 20px; }
      .logo-lockup { align-items:center; }
      .site-header .nav-links { display:none;width:100%;flex-direction:column;gap:12px;padding-top:8px; }
      .site-header .nav-links.open { display:flex; }
      .site-header .nav-cta, .site-header .nav-signin { text-align:center; }
      .card-grid { grid-template-columns: 1fr; }
      .section-chunk { padding: 28px 0; }
      .site-footer .footer-inner { flex-direction: column; gap: 20px; }
    }
    @media (min-width: 641px) {
      .nav-links { display:contents; }
    }
  </style>
  ${headExtra || ""}
  <!-- Google Analytics (GA4) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-CQCF8RMPYR"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-CQCF8RMPYR');
  </script>
</head>
<body${bodyAttributes ? ` ${bodyAttributes}` : ""}>
  <a href="#main-content" class="sr-only">Skip to main content</a>
  <header class="site-header">
    <nav aria-label="Site">
      <a href="/" class="logo" aria-label="Parse home"><span class="logo-lockup">${getLogoMarkSvg()}<span class="logo-primary">Parse</span></span></a>
      <button class="nav-toggle" aria-label="Toggle navigation" aria-expanded="false" aria-controls="nav-links" onclick="const n=document.getElementById('nav-links');const open=n.classList.toggle('open');this.setAttribute('aria-expanded',open);this.textContent=open?'\u2715':'\u2630';">\u2630</button>
      <div class="nav-links" id="nav-links">
      ${navLinksHtml}
      <a href="/admin/login" class="nav-signin">Sign in</a>
      <a href="/get-started" class="nav-cta">Install Parse</a>
      </div>
    </nav>
  </header>

  <div class="container">
    ${breadcrumbHtml}
    <main id="main-content">
      ${lastUpdatedHtml}
      ${content}
    </main>
  </div>

  <footer class="site-footer">
    <div class="footer-inner">
      <div>
        <div class="footer-brand">Parse</div>
        <div>Agent governance &amp; compliance for AI agents</div>
      </div>
      <nav aria-label="Footer">
        <div class="footer-links">
          <a href="/docs">Docs</a>
          <a href="/docs/api">API</a>
          <a href="/blog">Blog</a>
          <a href="/skill">Skill</a>
          <a href="/llms.txt">llms.txt</a>
          <a href="/openapi.json">OpenAPI</a>
          <a href="/pricing">Pricing</a>
          <a href="/trust">Trust</a>
          <a href="/status">Status</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href="/acceptable-use">Acceptable Use</a>
          <a href="/refund">Refunds</a>
        </div>
      </nav>
    </div>
  </footer>
  <script>
    function copyCode(btn) {
      var pre = btn.parentElement.querySelector('pre');
      if (!pre) return;
      var text = pre.innerText;
      navigator.clipboard.writeText(text).then(function() {
        btn.textContent = '✓ Copied';
        btn.classList.add('copied');
        setTimeout(function() {
          btn.textContent = 'Copy';
          btn.classList.remove('copied');
        }, 2000);
      }).catch(function() {
        // Fallback for older browsers
        var ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        btn.textContent = '✓ Copied';
        btn.classList.add('copied');
        setTimeout(function() {
          btn.textContent = 'Copy';
          btn.classList.remove('copied');
        }, 2000);
      });
    }
  </script>
  <style>
    .code-block { position: relative; }
    .code-block > pre { margin-top: 0; }
    .copy-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.15);
      color: #8b949e;
      padding: 4px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-family: system-ui, -apple-system, sans-serif;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.15s ease, background 0.15s ease;
      z-index: 1;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
    }
    .code-block:hover > .copy-btn, .copy-btn { opacity: 1; }
    .copy-btn:hover { background: rgba(255,255,255,0.2); color: #e1e4e8; }
    .copy-btn.copied { background: rgba(17,132,91,0.3); border-color: rgba(17,132,91,0.5); color: #3fb950; opacity: 1; }
    @media (max-width: 640px) {
      .copy-btn { opacity: 1; font-size: 11px; padding: 3px 10px; }
    }
  </style>
</body>
</html>`;
}
