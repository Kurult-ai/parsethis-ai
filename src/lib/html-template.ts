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
    .replace(/"/g, "&quot;");
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
  const ogImg = ogImage || `${baseUrl}/og-image.png`;

  // --- JSON-LD blocks ---
  let jsonLdBlocks = "";
  if (jsonLd && jsonLd.length > 0) {
    jsonLdBlocks = jsonLd
      .map(
        (obj) =>
          `<script type="application/ld+json">${JSON.stringify(obj)}</script>`
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

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle} | ParseThis.ai</title>
  <meta name="description" content="${safeDesc}">
  <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  <meta property="og:title" content="${safeTitle}">
  <meta property="og:description" content="${safeDesc}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="og:site_name" content="ParseThis.ai">
  <meta property="og:image" content="${escapeHtml(ogImg)}">
  ${authorMeta}
  ${modifiedTimeMeta}
  ${jsonLdBlocks}
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #0a0a0f;
      --surface: #12121a;
      --surface2: #1a1a2e;
      --border: #2a2a3e;
      --text: #e0e0e8;
      --text-dim: #8888a0;
      --accent: #6366f1;
      --accent2: #818cf8;
      --green: #34d399;
      --green-dim: #065f46;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
    }
    a { color: var(--accent2); text-decoration: none; }
    a:hover { text-decoration: underline; }

    /* Layout */
    .container { max-width: 900px; margin: 0 auto; padding: 24px; }

    /* Header nav */
    .site-header {
      position: sticky;
      top: 0;
      z-index: 100;
      background: rgba(10, 10, 15, 0.92);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border);
    }
    .site-header nav {
      max-width: 900px;
      margin: 0 auto;
      padding: 14px 24px;
      display: flex;
      align-items: center;
      gap: 24px;
    }
    .site-header .logo {
      font-size: 18px;
      font-weight: 700;
      background: linear-gradient(135deg, var(--accent), var(--accent2));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      text-decoration: none;
      margin-right: auto;
    }
    .site-header .logo:hover { text-decoration: none; }
    .site-header nav a {
      color: var(--text-dim);
      font-size: 14px;
      font-weight: 500;
      transition: color 0.15s;
    }
    .site-header nav a:hover {
      color: var(--text);
      text-decoration: none;
    }
    .site-header nav a.external::after {
      content: '\\2197';
      margin-left: 3px;
      font-size: 11px;
    }

    /* Headings */
    h1 {
      font-size: 2em;
      font-weight: 700;
      background: linear-gradient(135deg, var(--accent), var(--accent2));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 8px;
      line-height: 1.3;
    }
    h2 {
      font-size: 1.5em;
      font-weight: 600;
      margin-top: 2em;
      margin-bottom: 0.5em;
      color: var(--text);
    }
    h3 {
      font-size: 1.2em;
      font-weight: 600;
      margin-top: 1.5em;
      margin-bottom: 0.4em;
      color: var(--text);
    }

    /* Answer capsule (GEO pattern) */
    .answer-capsule {
      font-size: 1.15em;
      line-height: 1.7;
      color: var(--text);
      margin-bottom: 1.5em;
    }

    /* Tables */
    .table-wrapper {
      overflow-x: auto;
      border-radius: 8px;
      border: 1px solid var(--border);
      margin: 1.5em 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th {
      background: var(--surface2);
      text-align: left;
      padding: 12px 16px;
      font-weight: 600;
      border-bottom: 2px solid var(--border);
      position: sticky;
      top: 0;
    }
    td {
      padding: 10px 16px;
      border-bottom: 1px solid var(--border);
    }
    tr:nth-child(even) { background: var(--surface2); }
    tr:last-child td { border-bottom: none; }

    /* Terminal code block */
    .terminal {
      position: relative;
      background: #0d0d14;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px 48px 16px 16px;
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      font-size: 13px;
      color: var(--green);
      white-space: pre-wrap;
      word-break: break-all;
      line-height: 1.5;
      overflow-x: auto;
    }

    /* Inline code */
    code {
      background: var(--surface2);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      font-size: 0.9em;
    }
    pre code {
      display: block;
      padding: 16px;
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow-x: auto;
      font-size: 13px;
      line-height: 1.5;
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
      content: '>';
      margin: 0 8px;
      color: var(--text-dim);
    }
    nav.breadcrumb li:last-child::after { content: ''; margin: 0; }
    nav.breadcrumb a { color: var(--accent2); }

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
      border-radius: 8px;
      padding: 20px;
      margin: 24px 0;
    }

    /* Paragraphs and lists */
    p { margin-bottom: 1em; }
    ul, ol { margin-bottom: 1em; padding-left: 1.5em; }
    li { margin-bottom: 0.4em; }

    /* Footer */
    .site-footer {
      text-align: center;
      padding: 48px 24px 24px;
      font-size: 13px;
      color: var(--text-dim);
      border-top: 1px solid var(--border);
      margin-top: 48px;
    }
    .site-footer a {
      color: var(--accent2);
      text-decoration: none;
    }
    .site-footer a:hover { text-decoration: underline; }
    .footer-links {
      display: flex;
      justify-content: center;
      flex-wrap: wrap;
      gap: 8px 20px;
    }

    /* Copy button (reused from dashboard) */
    .copy-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      padding: 5px 12px;
      background: var(--surface);
      color: var(--text-dim);
      border: 1px solid var(--border);
      border-radius: 6px;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .copy-btn:hover { color: var(--text); border-color: var(--accent2); }
    .copy-btn.copied { background: var(--green-dim); color: var(--green); border-color: var(--green); }

    /* Screen reader only (a11y) */
    .sr-only { position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0; }

    /* Responsive */
    @media (max-width: 640px) {
      .container { padding: 16px; }
      .site-header nav { padding: 12px 16px; gap: 16px; flex-wrap: wrap; }
      h1 { font-size: 1.5em; }
    }
  </style>
  ${headExtra || ""}
</head>
<body>
  <header class="site-header">
    <nav>
      <a href="/" class="logo">ParseThis.ai</a>
      <a href="/docs">Docs</a>
      <a href="/pricing">Pricing</a>
      <a href="/playground">Playground</a>
      <a href="/faq">FAQ</a>
      <a href="https://github.com/nicobailon/parse-for-agents" class="external" target="_blank" rel="noopener">GitHub</a>
    </nav>
  </header>

  <div class="container">
    ${breadcrumbHtml}
    ${lastUpdatedHtml}
    <main>
      ${content}
    </main>
  </div>

  <footer class="site-footer">
    <div class="footer-links">
      <a href="/docs">Docs</a>
      <a href="/v1">API</a>
      <a href="/skill">Skill</a>
      <a href="/llms.txt">llms.txt</a>
      <a href="/openapi.json">OpenAPI</a>
      <a href="https://github.com/nicobailon/parse-for-agents" target="_blank" rel="noopener">GitHub</a>
      <a href="/privacy">Privacy</a>
    </div>
  </footer>
</body>
</html>`;
}
