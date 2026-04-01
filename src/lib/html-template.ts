import { GITHUB_URL } from "./constants.js";

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
  } = options;

  const canonicalUrl = `${baseUrl}${path}`;
  const safeTitle = escapeHtml(title);
  const safeDesc = escapeHtml(description);
  const ogImg = ogImage || `${baseUrl}/og-image.svg`;

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
    { href: "/docs", label: "Docs" },
    { href: "/pricing", label: "Pricing" },
    { href: "/playground", label: "Playground" },
    { href: "/faq", label: "FAQ" },
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
  <title>${safeTitle} | Parse</title>
  <meta name="description" content="${safeDesc}">
  <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  <meta property="og:title" content="${safeTitle}">
  <meta property="og:description" content="${safeDesc}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="og:site_name" content="Parse">
  <meta property="og:image" content="${escapeHtml(ogImg)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${safeTitle}">
  <meta name="twitter:description" content="${safeDesc}">
  <meta name="twitter:image" content="${escapeHtml(ogImg)}">
  <meta name="theme-color" content="#09090b">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300..700;1,9..40,300..700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  ${authorMeta}
  ${modifiedTimeMeta}
  ${jsonLdBlocks}
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #09090b;
      --surface: #18181b;
      --surface2: #27272a;
      --border: #27272a;
      --input: #27272a;
      --text: #fafafa;
      --text-dim: #a1a1aa;
      --accent: #6366f1;
      --accent2: #818cf8;
      --accent-dim: rgba(99,102,241,0.12);
      --green: #22c55e;
      --green-dim: #052e16;
      --yellow: #eab308;
      --yellow-dim: #422006;
      --destructive: #ef4444;
      --destructive-dim: #450a0a;
      --ring: #6366f1;
      --radius: 0.625rem;
    }
    body {
      font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      font-optical-sizing: auto;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    a { color: var(--accent2); text-decoration: none; }
    a:hover { color: var(--text); }
    a:focus-visible, button:focus-visible, summary:focus-visible, textarea:focus-visible, select:focus-visible, input:focus-visible {
      outline: 2px solid var(--ring);
      outline-offset: 2px;
    }

    /* Layout */
    .container { max-width: 960px; margin: 0 auto; padding: 32px 24px; }

    /* Header nav */
    .site-header {
      position: sticky;
      top: 0;
      z-index: 100;
      background: rgba(9, 9, 11, 0.85);
      backdrop-filter: blur(16px) saturate(180%);
      -webkit-backdrop-filter: blur(16px) saturate(180%);
      border-bottom: 1px solid var(--border);
    }
    .site-header nav {
      max-width: 960px;
      margin: 0 auto;
      padding: 16px 24px;
      display: flex;
      align-items: center;
      gap: 28px;
    }
    .site-header .logo {
      font-size: 17px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--text);
      text-decoration: none;
      margin-right: auto;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .site-header .logo::before {
      content: '';
      display: inline-block;
      width: 22px;
      height: 22px;
      background: linear-gradient(135deg, var(--accent), var(--accent2));
      border-radius: 5px;
      flex-shrink: 0;
    }
    .site-header .logo:hover { color: var(--text); text-decoration: none; }
    .site-header nav a {
      color: var(--text-dim);
      font-size: 14px;
      font-weight: 500;
      text-decoration: none;
      transition: color 0.2s;
      position: relative;
    }
    .site-header nav a:hover {
      color: var(--text);
      text-decoration: none;
    }
    .site-header nav a[aria-current="page"] {
      color: var(--text);
    }
    .site-header nav a[aria-current="page"]::after {
      content: '';
      position: absolute;
      bottom: -6px;
      left: 0;
      right: 0;
      height: 2px;
      background: var(--accent);
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
    .site-header .nav-cta {
      background: var(--accent);
      color: white !important;
      padding: 7px 18px;
      border-radius: var(--radius);
      font-weight: 600;
      font-size: 13px;
      text-decoration: none;
      transition: all 0.2s;
      letter-spacing: -0.01em;
    }
    .site-header .nav-cta:hover { background: var(--accent2); text-decoration: none; }

    /* Headings */
    h1 {
      font-size: 2.25em;
      font-weight: 700;
      letter-spacing: -0.035em;
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
      transition: border-color 0.2s;
    }
    .card:hover { border-color: #3f3f46; }
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
    .badge-destructive { background: var(--destructive-dim); color: #fca5a5; }
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
    .btn-primary { background: var(--accent); color: white; }
    .btn-primary:hover { background: var(--accent2); color: white; }
    .btn-outline { background: transparent; color: var(--accent2); border: 1px solid var(--border); }
    .btn-outline:hover { background: var(--surface2); color: var(--text); border-color: #3f3f46; }
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
    tbody tr:hover { background: var(--surface); }

    /* Terminal code block */
    .terminal {
      position: relative;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 16px 48px 16px 16px;
      font-family: 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace;
      font-size: 13px;
      color: var(--green);
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
      color: #3f3f46;
    }
    nav.breadcrumb li:last-child::after { content: ''; margin: 0; }
    nav.breadcrumb a { color: var(--text-dim); }
    nav.breadcrumb a:hover { color: var(--text); }
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
    }
    .site-footer .footer-inner {
      max-width: 960px;
      margin: 0 auto;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 32px;
      flex-wrap: wrap;
    }
    .site-footer .footer-brand {
      font-size: 14px;
      font-weight: 600;
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
    .copy-btn:hover { color: var(--text); border-color: #3f3f46; }
    .copy-btn.copied { background: var(--green-dim); color: var(--green); border-color: var(--green); }

    /* Screen reader only (a11y) */
    .sr-only { position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0; }
    .sr-only:focus { position:static;width:auto;height:auto;padding:8px 16px;margin:0;overflow:visible;clip:auto;white-space:normal;background:var(--accent);color:white;z-index:200; }

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
      .site-header .nav-links { display:none;width:100%;flex-direction:column;gap:12px;padding-top:8px; }
      .site-header .nav-links.open { display:flex; }
      .site-header .nav-cta { text-align:center; }
      .card-grid { grid-template-columns: 1fr; }
      .section-chunk { padding: 28px 0; }
      .site-footer .footer-inner { flex-direction: column; gap: 20px; }
    }
    @media (min-width: 641px) {
      .nav-links { display:contents; }
    }
  </style>
  ${headExtra || ""}
</head>
<body>
  <a href="#main-content" class="sr-only">Skip to main content</a>
  <header class="site-header">
    <nav aria-label="Site">
      <a href="/" class="logo">Parse</a>
      <button class="nav-toggle" aria-label="Toggle navigation" aria-expanded="false" aria-controls="nav-links" onclick="const n=document.getElementById('nav-links');const open=n.classList.toggle('open');this.setAttribute('aria-expanded',open);this.textContent=open?'\u2715':'\u2630';">\u2630</button>
      <div class="nav-links" id="nav-links">
      ${navLinksHtml}
      <a href="${GITHUB_URL}" class="external" target="_blank" rel="noopener noreferrer">GitHub<span class="sr-only"> (opens in new tab)</span></a>
      <a href="/docs/quickstart" class="nav-cta">Quick Start</a>
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
        <div>Prompt security for AI agents</div>
      </div>
      <nav aria-label="Footer">
        <div class="footer-links">
          <a href="/docs">Docs</a>
          <a href="/docs/api">API</a>
          <a href="/skill">Skill</a>
          <a href="/llms.txt">llms.txt</a>
          <a href="/openapi.json">OpenAPI</a>
          <a href="${GITHUB_URL}" target="_blank" rel="noopener noreferrer">GitHub<span class="sr-only"> (opens in new tab)</span></a>
          <a href="/pricing">Pricing</a>
          <a href="/privacy">Privacy</a>
        </div>
      </nav>
    </div>
  </footer>
</body>
</html>`;
}
