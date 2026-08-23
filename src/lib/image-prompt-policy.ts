/**
 * File-in-prompt policy (was image-only).
 *
 * Any file carried in a prompt — JPEG, PDF, CSV, doc, data URI, content part —
 * is unauthorized unless it declares a source path that matches an *allow*
 * File ACL rule written in the org dashboard.
 *
 * Raw bytes have no directory. We do not invent one.
 *
 * Modes:
 *   allow     — no-op
 *   deny      — any detected file is refused
 *   whitelist — every detected file needs a source path matching an allow rule
 */

import { resolveFileAcl, type FileAclRuleLike } from "./file-acl.js";

export type ImagePromptMode = "allow" | "deny" | "whitelist";
export type AttachmentPromptMode = ImagePromptMode;

export interface ImageAttachment {
  kind: "data_uri" | "content_part" | "url" | "path";
  mediaHint: string;
  sourcePath: string | null;
}
export type PromptAttachment = ImageAttachment;

export interface ImagePolicyDecision {
  mode: ImagePromptMode;
  imageCount: number;
  allowed: boolean;
  reason: string;
  unauthorized: Array<{ mediaHint: string; sourcePath: string | null; why: string }>;
}
export type AttachmentPolicyDecision = ImagePolicyDecision;

const FILE_EXT =
  /\.(jpe?g|png|gif|webp|bmp|tif|tiff|heic|heif|pdf|csv|tsv|xlsx?|docx?|pptx?|txt|json|xml|ya?ml|zip|gz|tgz|tar|parquet|md|rtf|odt|ods|mp3|mp4|wav|mov|webm|svg)(\?|#|$)/i;
const DATA_URI = /data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,/i;
const FILE_PART_TYPES = new Set([
  "image",
  "image_url",
  "input_image",
  "file",
  "input_file",
  "document",
  "file_url",
  "attachment",
]);

export function isImagePromptMode(v: unknown): v is ImagePromptMode {
  return v === "allow" || v === "deny" || v === "whitelist";
}

export function extractDeclaredImagePaths(metadata: unknown): string[] {
  return extractDeclaredFilePaths(metadata);
}

export function extractDeclaredFilePaths(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object") return [];
  const rec = metadata as Record<string, unknown>;
  const buckets = [rec.image_sources, rec.file_sources, rec.attachments];
  const out: string[] = [];
  for (const raw of buckets) {
    if (!Array.isArray(raw)) continue;
    for (const item of raw) {
      if (typeof item === "string" && item.trim()) out.push(item.trim());
      else if (item && typeof item === "object") {
        const p = (item as { path?: unknown; file_path?: unknown }).path ?? (item as { file_path?: unknown }).file_path;
        if (typeof p === "string" && p.trim()) out.push(p.trim());
      }
    }
  }
  return out;
}

function partPath(part: Record<string, unknown>): string | null {
  for (const key of ["path", "file_path", "filepath", "source_path"]) {
    const v = part[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const filename = typeof part.filename === "string" ? part.filename.trim() : "";
  if (filename && (filename.includes("/") || filename.startsWith("~") || filename.startsWith("file://"))) {
    return filename;
  }
  for (const nestedKey of ["image_url", "file", "document", "source"]) {
    const nested = part[nestedKey];
    if (nested && typeof nested === "object") {
      const p = (nested as { path?: unknown }).path;
      if (typeof p === "string" && p.trim()) return p.trim();
    }
  }
  return null;
}

function looksLikeFileUrl(url: string): boolean {
  if (DATA_URI.test(url)) return true;
  if (url.startsWith("file://")) return true;
  return FILE_EXT.test(url) && (/https?:\/\//i.test(url) || url.includes("/") || url.startsWith("~"));
}

function looksLikeFilePath(s: string): boolean {
  if (s.startsWith("file://")) return true;
  if (!FILE_EXT.test(s)) return false;
  return s.includes("/") || s.startsWith("~") || s.startsWith(".");
}

export function extractImageAttachments(input: unknown, declaredPaths: string[] = []): ImageAttachment[] {
  return extractPromptAttachments(input, declaredPaths);
}

export function extractPromptAttachments(input: unknown, declaredPaths: string[] = []): PromptAttachment[] {
  const found: PromptAttachment[] = [];
  const unusedDeclared = [...declaredPaths];
  const takeDeclared = (): string | null => unusedDeclared.shift() ?? null;

  const visit = (node: unknown, depth: number): void => {
    if (depth > 8 || node == null) return;
    if (typeof node === "string") {
      const data = node.match(DATA_URI);
      if (data && data[1] !== "text/plain") {
        found.push({ kind: "data_uri", mediaHint: data[1], sourcePath: takeDeclared() });
        return;
      }
      if (looksLikeFileUrl(node) || looksLikeFilePath(node)) {
        found.push({
          kind: node.startsWith("file://") || looksLikeFilePath(node) ? "path" : "url",
          mediaHint: node.match(FILE_EXT)?.[1] ?? "file",
          sourcePath: looksLikeFilePath(node) ? node : takeDeclared(),
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
    const mediaType =
      typeof rec.media_type === "string" ? rec.media_type : typeof rec.mediaType === "string" ? rec.mediaType : "";
    const url =
      (typeof rec.url === "string" && rec.url) ||
      (rec.image_url && typeof rec.image_url === "object" && typeof (rec.image_url as { url?: unknown }).url === "string"
        ? String((rec.image_url as { url: string }).url)
        : "") ||
      (rec.file && typeof rec.file === "object" && typeof (rec.file as { url?: unknown }).url === "string"
        ? String((rec.file as { url: string }).url)
        : "") ||
      (rec.source && typeof rec.source === "object" && typeof (rec.source as { data?: unknown }).data === "string"
        ? `data:${mediaType || "application/octet-stream"}`
        : "");

    const isFilePart =
      FILE_PART_TYPES.has(type) ||
      (mediaType !== "" && mediaType !== "text/plain") ||
      (typeof url === "string" && url !== "" && looksLikeFileUrl(url));

    if (isFilePart) {
      found.push({
        kind: "content_part",
        mediaHint: mediaType || type || "file",
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
  return evaluateAttachmentPromptPolicy(attachments, rules, mode);
}

export function evaluateAttachmentPromptPolicy(
  attachments: PromptAttachment[],
  rules: FileAclRuleLike[],
  mode: ImagePromptMode,
): AttachmentPolicyDecision {
  if (mode === "allow") {
    return { mode, imageCount: attachments.length, allowed: true, reason: "file-in-prompt policy is off", unauthorized: [] };
  }
  if (attachments.length === 0) {
    return { mode, imageCount: 0, allowed: true, reason: "no files in prompt", unauthorized: [] };
  }
  if (mode === "deny") {
    return {
      mode,
      imageCount: attachments.length,
      allowed: false,
      reason: "org denies files in prompts",
      unauthorized: attachments.map((a) => ({
        mediaHint: a.mediaHint,
        sourcePath: a.sourcePath,
        why: "deny_all",
      })),
    };
  }

  const allowRules = rules.filter((r) => r.action === "allow");
  const unauthorized: AttachmentPolicyDecision["unauthorized"] = [];
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
        ? "all files sourced from allowlisted paths"
        : "file not sourced from an authorized directory",
    unauthorized,
  };
}
