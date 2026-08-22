/**
 * Per-file ACL (plan docs/plans/2026-08-22-file-acl-plan.md).
 *
 * Tier 2 core: a glob matcher for path patterns and the rule resolver used by
 * the gateway when it observes file-like paths in tool-call arguments.
 *
 * Conventions (matching egress-rule precedent):
 *  - Patterns are comma-separated; each entry matches independently.
 *  - `*` matches within one path segment; `**` matches across segments.
 *  - A pattern with no leading `/` matches as a suffix anywhere (so `payroll/**`
 *    catches both `/mnt/payroll/x` and `repo/payroll/x`). A leading `/` anchors
 *    to the volume root.
 *  - `..` in an observed path is collapsed before matching; a path whose
 *    collapse escapes the pattern root never matches.
 *  - No rule matched → allow (fail-open, same as egress rules).
 *  - Highest precedence = lowest `priority` value; first match at the best
 *    priority wins.
 */

export type FileAclAction = "allow" | "require_approval" | "block";

export interface FileAclRuleLike {
  id?: string;
  pathPattern: string;
  action: FileAclAction;
  priority?: number;
  comment?: string | null;
}

export interface FileAclDecision {
  path: string;
  action: FileAclAction;
  ruleId?: string;
  pattern?: string;
  comment?: string | null;
  matched: boolean;
}

/** Collapse `.` and `..` segments; null if traversal escapes the root. */
export function normalizePath(input: string): string | null {
  if (typeof input !== "string" || input.trim() === "") return null;
  let p = input.trim().replace(/\\/g, "/");
  // Strip file:// scheme if present
  if (p.startsWith("file://")) p = p.slice("file://".length);
  const out: string[] = [];
  const rooted = p.startsWith("/");
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return null; // escapes root
      out.pop();
      continue;
    }
    out.push(seg);
  }
  const collapsed = out.join("/");
  if (!collapsed) return rooted ? "/" : null;
  return rooted ? `/${collapsed}` : collapsed;
}

/** Convert one glob pattern to a RegExp source string. */
function globToRegex(pattern: string): RegExp {
  const anchored = pattern.startsWith("/");
  let src = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        // `**` — any characters including /
        src += ".*";
        i++; // consume second *
        // tolerate `/**/` → `/*` shapes
        if (pattern[i + 1] === "/") i++;
      } else {
        src += "[^/]*";
      }
    } else if ("/-.+^${}()|[]\\".includes(ch)) {
      src += `\\${ch}`;
    } else {
      src += ch;
    }
  }
  // Unanchored patterns match as a suffix at a segment boundary.
  const body = anchored ? src.replace(/^\\\//, "") : src;
  const prefix = anchored ? "^/" : "(^|/)";
  return new RegExp(`${prefix}${body}$`);
}

/** Does `path` match one comma-separated pattern list? */
export function pathMatchesPattern(path: string, patterns: string): boolean {
  const norm = normalizePath(path);
  if (!norm) return false;
  const stripped = norm.startsWith("/") ? norm.slice(1) : norm;
  for (const raw of patterns.split(",")) {
    const pattern = raw.trim();
    if (!pattern) continue;
    const anchored = pattern.startsWith("/");
    const patBody = anchored ? pattern.slice(1) : pattern;
    if (patBody === "**" || patBody === "*") return true; // catch-all entry
    const re = globToRegex(pattern);
    if (re.test(stripped) || re.test(`/${stripped}`)) return true;
  }
  return false;
}

/** Resolve the decision for one observed path against an org's rules. */
export function resolveFileAcl(
  path: string,
  rules: FileAclRuleLike[],
): FileAclDecision {
  const norm = normalizePath(path);
  if (!norm) {
    return { path, action: "allow", matched: false };
  }
  const sorted = [...rules].sort(
    (a, b) => (a.priority ?? 0) - (b.priority ?? 0),
  );
  for (const rule of sorted) {
    if (pathMatchesPattern(norm, rule.pathPattern)) {
      return {
        path: norm,
        action: rule.action,
        ruleId: rule.id,
        pattern: rule.pathPattern,
        comment: rule.comment ?? null,
        matched: true,
      };
    }
  }
  return { path: norm, action: "allow", matched: false };
}

/** Extract file-like path strings from a tool-call arguments JSON blob. */
export function extractPathsFromToolArgs(args: unknown): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const PATH_KEYS = new Set([
    "path",
    "file_path",
    "filepath",
    "filename",
    "file",
    "absolute_path",
    "notebook_path",
    "target",
  ]);

  const visit = (node: unknown, depth: number): void => {
    if (depth > 6 || node === null || node === undefined) return;
    if (typeof node === "string") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    if (typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (PATH_KEYS.has(k.toLowerCase()) && typeof v === "string") {
          const norm = normalizePath(v);
          if (norm && norm !== "/" && !seen.has(norm)) {
            seen.add(norm);
            found.push(norm);
          }
        } else if (typeof v === "string" && v.length > 2 && v.includes("/")) {
          // Strings that look like paths inside arrays of args (e.g. Bash `command` cd)
          // are NOT treated as paths — too noisy. Only declared path-ish keys count.
        } else {
          visit(v, depth + 1);
        }
      }
    }
  };

  if (typeof args === "string") {
    try {
      visit(JSON.parse(args), 0);
    } catch {
      return found;
    }
  } else {
    visit(args, 0);
  }
  return found;
}
