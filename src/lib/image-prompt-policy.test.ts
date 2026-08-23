import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractDeclaredImagePaths,
  extractImageAttachments,
  evaluateImagePromptPolicy,
} from "./image-prompt-policy.js";

const ALLOW = [{ pathPattern: "/approved-share/**", action: "allow" as const, priority: 0 }];

describe("image-prompt-policy", () => {
  it("allow mode never refuses", () => {
    const atts = extractImageAttachments("data:image/jpeg;base64,/9j/4AAQ");
    const d = evaluateImagePromptPolicy(atts, ALLOW, "allow");
    assert.equal(d.allowed, true);
  });

  it("deny mode refuses any jpeg data uri", () => {
    const atts = extractImageAttachments("please see data:image/jpeg;base64,/9j/4AAQ");
    const d = evaluateImagePromptPolicy(atts, ALLOW, "deny");
    assert.equal(d.allowed, false);
    assert.equal(d.imageCount, 1);
  });

  it("whitelist refuses undeclared image bytes", () => {
    const atts = extractImageAttachments({
      type: "image_url",
      image_url: { url: "data:image/jpeg;base64,/9j/xx" },
    });
    const d = evaluateImagePromptPolicy(atts, ALLOW, "whitelist");
    assert.equal(d.allowed, false);
    assert.equal(d.unauthorized[0].why, "undeclared_source");
  });

  it("whitelist allows a path under the authorized directory", () => {
    const atts = extractImageAttachments(
      { type: "image", path: "/approved-share/logo.jpg", media_type: "image/jpeg" },
      ["/approved-share/logo.jpg"],
    );
    const d = evaluateImagePromptPolicy(atts, ALLOW, "whitelist");
    assert.equal(d.allowed, true, d.reason);
  });

  it("whitelist refuses a path outside the authorized directory", () => {
    const atts = extractImageAttachments(
      { type: "image", path: "/Downloads/secret.jpg", media_type: "image/jpeg" },
    );
    const d = evaluateImagePromptPolicy(atts, ALLOW, "whitelist");
    assert.equal(d.allowed, false);
    assert.equal(d.unauthorized[0].why, "path_not_allowlisted");
  });

  it("reads metadata.image_sources", () => {
    assert.deepEqual(extractDeclaredImagePaths({ image_sources: ["/approved-share/a.jpg", { path: "/approved-share/b.jpg" }] }), [
      "/approved-share/a.jpg",
      "/approved-share/b.jpg",
    ]);
  });
});
