import { marked, type Tokens } from "marked";
import matter from "gray-matter";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const CONTENT_DIR =
  process.env.CONTENT_DIR || resolve(process.cwd(), "content");

export interface ContentFile {
  frontmatter: Record<string, any>;
  html: string;
  markdown: string;
  wordCount: number;
  readingTime: number;
}

// --- Configure marked ---

// Custom renderer for heading IDs, table wrapping, and code blocks
const renderer = new marked.Renderer();

renderer.heading = function (token: Tokens.Heading): string {
  const rawText = token.text
    .replace(/<[^>]*>/g, "")
    .replace(/&[^;]+;/g, "")
    .trim();
  const id = rawText
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  const tag = `h${token.depth}`;
  const inner = this.parser.parseInline(token.tokens);
  return `<${tag} id="${id}">${inner}</${tag}>`;
};

renderer.table = function (token: Tokens.Table): string {
  // Render header cells
  const headerCells = token.header
    .map((cell) => {
      const align = cell.align ? ` style="text-align:${cell.align}"` : "";
      const content = this.parser.parseInline(cell.tokens);
      return `<th${align}>${content}</th>`;
    })
    .join("");
  const headerRow = `<tr>${headerCells}</tr>`;

  // Render body rows
  const bodyRows = token.rows
    .map((row) => {
      const cells = row
        .map((cell) => {
          const align = cell.align ? ` style="text-align:${cell.align}"` : "";
          const content = this.parser.parseInline(cell.tokens);
          return `<td${align}>${content}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  return `<div class="table-wrapper"><table><thead>${headerRow}</thead><tbody>${bodyRows}</tbody></table></div>`;
};

renderer.code = function (token: Tokens.Code): string {
  const escaped = token.text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const langClass = token.lang ? ` class="language-${token.lang}"` : "";
  return `<pre><code${langClass}>${escaped}</code></pre>`;
};

marked.setOptions({
  renderer,
  gfm: true,
  breaks: false,
});

/**
 * Load and render a markdown file by absolute path.
 */
export function loadMarkdownFile(filePath: string): ContentFile | null {
  try {
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, "utf-8");
    const { data, content } = matter(raw);
    const html = marked.parse(content) as string;
    const words = content.trim().split(/\s+/).filter(Boolean).length;
    return {
      frontmatter: data,
      html,
      markdown: content,
      wordCount: words,
      readingTime: Math.max(1, Math.ceil(words / 230)),
    };
  } catch {
    return null;
  }
}

/**
 * Load a markdown file from content/{directory}/{slug}.md
 */
export function loadContentBySlug(
  directory: string,
  slug: string
): ContentFile | null {
  const safeName = slug.replace(/[^a-z0-9_-]/gi, "");
  const filePath = join(CONTENT_DIR, directory, `${safeName}.md`);
  return loadMarkdownFile(filePath);
}

/**
 * List all .md files in content/{directory}, returning frontmatter summaries.
 * Sorted by date descending.
 */
export function listContent(
  directory: string
): Array<{ slug: string; title: string; date: string; description: string }> {
  const dirPath = join(CONTENT_DIR, directory);
  if (!existsSync(dirPath)) return [];

  try {
    const files = readdirSync(dirPath).filter((f) => f.endsWith(".md"));
    const items = files.map((filename) => {
      const slug = filename.replace(/\.md$/, "");
      const filePath = join(dirPath, filename);
      const raw = readFileSync(filePath, "utf-8");
      const { data } = matter(raw);
      return {
        slug,
        title: (data.title as string) || slug,
        date: (data.date as string) || "",
        description: (data.description as string) || "",
      };
    });

    // Sort by date descending
    items.sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });

    return items;
  } catch {
    return [];
  }
}

/**
 * List all blog posts across all categories in content/blog/{category}/.
 * Returns ContentFile[] with category added to frontmatter, sorted by date descending.
 */
export function listBlogPosts(): ContentFile[] {
  const blogDir = join(CONTENT_DIR, "blog");
  if (!existsSync(blogDir)) return [];

  try {
    const categories = readdirSync(blogDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== "configs");

    const posts: ContentFile[] = [];
    for (const catDir of categories) {
      const category = catDir.name.toLowerCase().replace(/\s+/g, "-");
      const catPath = join(blogDir, catDir.name);
      const files = readdirSync(catPath).filter((f) => f.endsWith(".md"));

      for (const filename of files) {
        const filePath = join(catPath, filename);
        const file = loadMarkdownFile(filePath);
        if (!file || !file.frontmatter.title || !file.frontmatter.date) continue;
        file.frontmatter.category = category;
        posts.push(file);
      }
    }

    posts.sort((a, b) => {
      const da = a.frontmatter.date || "";
      const db = b.frontmatter.date || "";
      return new Date(db).getTime() - new Date(da).getTime();
    });

    return posts;
  } catch {
    return [];
  }
}

/**
 * Load a single blog post by category and slug (matched against frontmatter slug field).
 */
export function loadBlogPost(category: string, slug: string): ContentFile | null {
  const catPath = join(CONTENT_DIR, "blog", category);
  if (!existsSync(catPath)) return null;

  try {
    const files = readdirSync(catPath).filter((f) => f.endsWith(".md"));
    for (const filename of files) {
      const filePath = join(catPath, filename);
      const file = loadMarkdownFile(filePath);
      if (!file) continue;
      if (file.frontmatter.slug === slug) {
        file.frontmatter.category = category;
        return file;
      }
    }
    return null;
  } catch {
    return null;
  }
}
