import { renderPage } from "../lib/html-template.js";
import { listBlogPosts, loadBlogPost } from "../lib/markdown.js";
import {
  articleSchema,
  organizationSchema,
  breadcrumbSchema,
} from "../lib/schema.js";

/**
 * Format a category slug into a display name.
 * "agent-security" -> "Agent Security"
 */
function formatCategoryName(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Render the blog listing page with posts grouped by category.
 */
export function renderBlogListingPage(baseUrl: string): string {
  const posts = listBlogPosts();

  // Group posts by category
  const grouped: Record<string, typeof posts> = {};
  for (const post of posts) {
    const cat = (post.frontmatter.category as string) || "uncategorized";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(post);
  }

  // Build card grid HTML for each category
  let categorySections = "";
  const categoryKeys = Object.keys(grouped).sort();

  for (const cat of categoryKeys) {
    const catPosts = grouped[cat];
    const catName = formatCategoryName(cat);

    let cards = "";
    for (const post of catPosts) {
      const fm = post.frontmatter;
      const title = fm.title as string;
      const slug = fm.slug as string;
      const date = fm.date as string;
      const description = (fm.description as string) || "";
      const readingTime = (fm.reading_time as string) || `${post.readingTime} min read`;
      const href = `/blog/${cat}/${slug}`;

      cards += `
      <a href="${href}" class="card" style="text-decoration:none;color:inherit;display:block;padding:1.25rem;border:1px solid var(--border);border-radius:8px;transition:border-color 0.15s,box-shadow 0.15s;">
        <h3 style="margin:0 0 0.5rem 0;font-size:1.1rem;line-height:1.4;">${title}</h3>
        <p style="margin:0 0 0.75rem 0;color:var(--muted);font-size:0.9rem;line-height:1.5;">${description}</p>
        <div style="display:flex;gap:1rem;font-size:0.8rem;color:var(--muted);">
          <span>${date}</span>
          <span>${readingTime}</span>
        </div>
      </a>`;
    }

    categorySections += `
    <h2 style="margin-top:2.5rem;">${catName}</h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:1.25rem;margin-top:1rem;">
      ${cards}
    </div>`;
  }

  const content = `
<h1>Blog</h1>
<p class="answer-capsule">Insights on prompt security, agent safety, and building trustworthy AI infrastructure.</p>
${posts.length === 0 ? "<p>No posts yet. Check back soon.</p>" : categorySections}
`;

  return renderPage({
    title: "Blog",
    description:
      "Parse blog — insights on prompt security, agent safety, and AI infrastructure.",
    path: "/blog",
    content,
    baseUrl,
    jsonLd: [organizationSchema(baseUrl)],
    breadcrumbs: [
      { name: "Home", href: "/" },
      { name: "Blog", href: "/blog" },
    ],
  });
}

/**
 * Render a single blog post page, or return raw markdown for content negotiation.
 */
export function renderBlogPostPage(
  category: string,
  slug: string,
  baseUrl: string,
  wantsMarkdown?: boolean
):
  | { html: string; contentType: "text/html" }
  | { markdown: string; contentType: "text/markdown" }
  | null {
  const file = loadBlogPost(category, slug);
  if (!file) return null;

  // Content negotiation: return raw markdown
  if (wantsMarkdown) {
    return { markdown: file.markdown, contentType: "text/markdown" };
  }

  const fm = file.frontmatter;
  const title = (fm.title as string) || slug;
  const description = (fm.description as string) || "";
  // YAML parses unquoted dates (date: 2026-03-06) into Date objects; quoted
  // ones stay strings. Normalize both so downstream string ops never crash.
  const fmDate = (value: unknown, fallback: string): string => {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (typeof value === "string" && value) return value;
    return fallback;
  };
  const datePublished = fmDate(fm.date, "2026-04-06");
  const dateModified = fmDate(fm.lastUpdated, datePublished);
  const author = (fm.author as string) || "Parse Team";
  const path = `/blog/${category}/${slug}`;

  const mdAlternate = `<link rel="alternate" type="text/markdown" href="${baseUrl}${path}">`;

  return {
    html: renderPage({
      title,
      description,
      path,
      content: file.html,
      baseUrl,
      author,
      lastUpdated: dateModified,
      headExtra: mdAlternate,
      jsonLd: [
        articleSchema({
          baseUrl,
          title,
          description,
          path,
          datePublished,
          dateModified,
          author,
        }),
        organizationSchema(baseUrl),
        breadcrumbSchema([
          { name: "Home", url: `${baseUrl}/` },
          { name: "Blog", url: `${baseUrl}/blog` },
          { name: title, url: `${baseUrl}${path}` },
        ]),
      ],
      breadcrumbs: [
        { name: "Home", href: "/" },
        { name: "Blog", href: "/blog" },
        { name: title, href: path },
      ],
    }),
    contentType: "text/html",
  };
}

export function renderBlogPostPageBySlug(
  slug: string,
  baseUrl: string,
  wantsMarkdown?: boolean
):
  | { html: string; contentType: "text/html" }
  | { markdown: string; contentType: "text/markdown" }
  | null {
  const post = listBlogPosts().find((candidate) => candidate.frontmatter.slug === slug);
  const category = post?.frontmatter.category;
  if (typeof category !== "string") return null;
  return renderBlogPostPage(category, slug, baseUrl, wantsMarkdown);
}
