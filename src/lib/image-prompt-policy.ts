/**
 * Image-in-prompt policy.
 *
 * An admin can refuse a prompt that carries image bytes / image parts unless
 * every image declares a source path that matches an *allow* File ACL rule.
 *
 * Undeclared images are unauthorized. Raw base64 has no directory. We do not
 * invent one.
 *
 * Modes:
 *   allow     — no-op (default)
 *   deny      — any detected image is refused
 *   whitelist — every detected image needs a source path matching an allow rule
 */

import { resolveFileAcl, type FileAclRuleLike } from "./file-acl.js";

export type ImagePromptMode = "allow" | "deny" | "whitelist";

export interface ImageAttachment {
  kind: "data_uri" | "content_part" | "url";
  mediaHint: string;
  sourcePath: string | null;
}

export interface ImagePolicyDecision {
  mode: ImagePromptMode;
  imageCount: number;
  allowed: boolean;
  reason: string;
  unauthorized: Array<{ mediaHint: string; sourcePath: string | null; why: string }>;
}

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|tif|tiff|heic|heif)(\?|#|$)/i;
const DATA_IMAGE = /data:image\/([a-z0-9.+-]+);base64,/i;

export function isImagePromptMode(v: unknown): v is ImagePromptMode {
  return v === "allow" || v === "deny" || v === "whitelist";
}

export function extractDeclaredImagePaths(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object") return [];
  const raw = (metadata as { image_sources?: unknown }).image_sources;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) out.push(item.trim());
    else if (item && typeof item === "object" && typeof (item as { path?: unknown }).path === "string") {
      const p = (item as { path: string }).path.trim();
      if (p) out.push(p);
    }
  }
  return out;
}

function partPath(part: Record<string, unknown>): string | null {
  for (const key of ["path", "file_path", "filepath", "filename", "source_path"]) {
    const v = part[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const nested = part.image_url;
  if (nested && typeof nested === "object") {
    const p = (nested as { path?: unknown }).path;
    if (typeof p === "string" && p.trim()) return p.trim();
  }
  return null;
}

function looksLikeImageUrl(url: string): boolean {
  if (DATA_IMAGE.test(url)) return true;
  if (IMAGE_EXT.test(url)) return true;
  return /\/image\//i.test(url);
}

export function extractImageAttachments(input: unknown, declaredPaths: string[] = []): ImageAttachment[] {
  const found: ImageAttachment[] = [];
  const unusedDeclared = [...declaredPaths];
  const takeDeclared = (): string | null => unusedDeclared.shift() ?? null;

  const visit = (node: unknown, depth: number): void => {
    if (depth > 8 || node == null) return;
    if (typeof node === "string") {
      if (DATA_IMAGE.test(node) || (node.length > 32 && IMAGE_EXT.test(node) && /https?:\/\//i.test(node))) {
        const media = node.match(DATA_IMAGE)?.[1] ?? "url";
        found.push({
          kind: DATA_IMAGE.test(node) ? "data_uri" : "url",
          mediaHint: media,
          sourcePath: takeDeclared(),
        });
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    const type = typeof rec.type === "string" ? rec.type.toLowerCase() : "";
    const mediaType = typeof rec.media_type === "string" ? rec.media_type : typeof rec.mediaType === "string" ? rec.mediaType : "";
    const url =
      (typeof rec.url === "string" && rec.url) ||
      (rec.image_url && typeof rec.image_url === "object" && typeof (rec.image_url as { url?: unknown }).url === "string"
        ? String((rec.image_url as { url: string }).url)
        : "") ||
      (rec.source && typeof rec.source === "object" && typeof (rec.source as { data?: unknown }).data === "string"
        ? "data:image"
        : "");

    const isImagePart =
      type === "image" ||
      type === "image_url" ||
      type === "input_image" ||
      mediaType.startsWith("image/") ||
      (typeof url === "string" && url !== "" && looksLikeImageUrl(url));

    if (isImagePart) {
      found.push({
        kind: type === "image_url" || type === "input_image" || type === "image" ? "content_part" : "url",
        mediaHint: mediaType || type || "image",
        sourcePath: partPath(rec) ?? takeDeclared(),
      });
      return;
    }
    for (const v of Object.values(rec)) visit(v, depth + 1);
  };

  visit(input, 0);
  return found;
}

export function evaluateImagePromptPolicy(
  attachments: ImageAttachment[],
  rules: FileAclRuleLike[],
  mode: ImagePromptMode,
): ImagePolicyDecision {
  if (mode === "allow") {
    return { mode, imageCount: attachments.length, allowed: true, reason: "image policy is off", unauthorized: [] };
  }
  if (attachments.length === 0) {
    return { mode, imageCount: 0, allowed: true, reason: "no images in prompt", unauthorized: [] };
  }
  if (mode === "deny") {
    return {
      mode,
      imageCount: attachments.length,
      allowed: false,
      reason: "org denies images in prompts",
      unauthorized: attachments.map((a) => ({
        mediaHint: a.mediaHint,
        sourcePath: a.sourcePath,
        why: "deny_all",
      })),
    };
  }

  const allowRules = rules.filter((r) => r.action === "allow");
  const unauthorized: ImagePolicyDecision["unauthorized"] = [];
  for (const a of attachments) {
    if (!a.sourcePath) {
      unauthorized.push({ mediaHint: a.mediaHint, sourcePath: null, why: "undeclared_source" });
      continue;
    }
    if (allowRules.length === 0) {
      unauthorized.push({ mediaHint: a.mediaHint, sourcePath: a.sourcePath, why: "no_allow_rules" });
      continue;
    }
    const decision = resolveFileAcl(a.sourcePath, allowRules);
    if (!decision.matched || decision.action !== "allow") {
      unauthorized.push({ mediaHint: a.mediaHint, sourcePath: a.sourcePath, why: "path_not_allowlisted" });
    }
  }

  return {
    mode,
    imageCount: attachments.length,
    allowed: unauthorized.length === 0,
    reason:
      unauthorized.length === 0
        ? "all images sourced from allowlisted paths"
        : "image not sourced from an authorized directory",
    unauthorized,
  };
}
