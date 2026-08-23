import { prisma } from "../db.js";
import { isImagePromptMode, type ImagePromptMode } from "./image-prompt-policy.js";
import type { FileAclRuleLike } from "./file-acl.js";

export async function loadImagePromptContext(orgId: string): Promise<{
  mode: ImagePromptMode;
  rules: FileAclRuleLike[];
}> {
  const [org, rules] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: orgId },
      select: { imagePromptPolicy: true },
    }),
    prisma.fileAclRule.findMany({
      where: { orgId },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      select: { id: true, pathPattern: true, action: true, priority: true, comment: true },
    }),
  ]);
  const raw = org?.imagePromptPolicy;
  return {
    mode: isImagePromptMode(raw) ? raw : "allow",
    rules: rules.map((r) => ({
      id: r.id,
      pathPattern: r.pathPattern,
      action: r.action as FileAclRuleLike["action"],
      priority: r.priority,
      comment: r.comment,
    })),
  };
}
