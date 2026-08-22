/**
 * Per-file ACL tests (plan 2026-08-22-file-acl-plan.md).
 * 1. Glob matcher semantics (exact, *, **, anchoring, traversal, comma lists)
 * 2. Rule resolution: priority ordering, fail-open, actions
 * 3. Path extraction from tool-call arguments
 * 4. Gateway integration shape: decisions become flags; block mode refuses
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizePath,
  pathMatchesPattern,
  resolveFileAcl,
  extractPathsFromToolArgs,
  type FileAclRuleLike,
} from "./file-acl.js";

// ── 1. normalizePath ──────────────────────────────────────────────────────

test("normalizePath collapses dots and rejects root escape", () => {
  assert.equal(normalizePath("/a/b/../c"), "/a/c");
  assert.equal(normalizePath("/a/./b"), "/a/b");
  assert.equal(normalizePath("../etc/passwd"), null); // escapes root
  assert.equal(normalizePath("a/../../b"), null);
  assert.equal(normalizePath("file:///mnt/payroll/x.csv"), "/mnt/payroll/x.csv");
  assert.equal(normalizePath(""), null);
  assert.equal(normalizePath("C:\\\\repo\\\\payroll"), "C:/repo/payroll");
});

// ── 2. pathMatchesPattern ─────────────────────────────────────────────────

test("glob: exact and single-star", () => {
  assert.ok(pathMatchesPattern("/payroll/june.csv", "payroll/june.csv"));
  assert.ok(pathMatchesPattern("/payroll/june.csv", "payroll/*.csv"));
  assert.ok(!pathMatchesPattern("/payroll/june.csv", "payroll/*.txt"));
  // * must not cross segments
  assert.ok(!pathMatchesPattern("/payroll/2026/june.csv", "payroll/*.csv"));
});

test("glob: double-star crosses segments", () => {
  assert.ok(pathMatchesPattern("/payroll/2026/june.csv", "payroll/**"));
  assert.ok(pathMatchesPattern("/mnt/payroll/2026/june.csv", "payroll/**")); // unanchored suffix
  assert.ok(pathMatchesPattern("/repo/payroll/a/b/c.txt", "payroll/**/c.txt"));
  assert.ok(!pathMatchesPattern("/payrollu/x", "payroll/**")); // segment boundary
});

test("glob: anchored patterns match from root only", () => {
  assert.ok(pathMatchesPattern("/contracts/a.md", "/contracts/**"));
  assert.ok(!pathMatchesPattern("/repo/contracts/a.md", "/contracts/**"));
});

test("glob: comma-separated entries and traversal collapse", () => {
  assert.ok(pathMatchesPattern("/secrets/key.pem", "payroll/**, secrets/*"));
  assert.ok(!pathMatchesPattern("/logs/x.log", "payroll/**, secrets/*"));
  // traversal is collapsed BEFORE matching, so no sneak-past
  assert.ok(pathMatchesPattern("/payroll/../payroll/x.csv", "payroll/**"));
  // a path whose collapse escapes root can't match anything
  assert.ok(!pathMatchesPattern("../payroll/x.csv", "payroll/**"));
});

// ── 3. resolveFileAcl ─────────────────────────────────────────────────────

const rules: FileAclRuleLike[] = [
  { id: "r1", pathPattern: "payroll/**", action: "block", priority: 0 },
  { id: "r2", pathPattern: "payroll/template.txt", action: "allow", priority: -1 },
  { id: "r3", pathPattern: "secrets/*", action: "require_approval", priority: 5 },
];

test("resolver: lowest priority value wins", () => {
  const d = resolveFileAcl("/payroll/template.txt", rules);
  assert.equal(d.action, "allow"); // r2 at priority -1 beats r1 at 0
  assert.equal(d.ruleId, "r2");
  const d2 = resolveFileAcl("/payroll/other.csv", rules);
  assert.equal(d2.action, "block");
  assert.equal(d2.ruleId, "r1");
});

test("resolver: no rules or no match fails open to allow", () => {
  assert.equal(resolveFileAcl("/anywhere/x", []).action, "allow");
  const d = resolveFileAcl("/docs/readme.md", rules);
  assert.equal(d.action, "allow");
  assert.equal(d.matched, false);
});

test("resolver: require_approval surfaces as its own action", () => {
  const d = resolveFileAcl("/secrets/api.key", rules);
  assert.equal(d.action, "require_approval");
});

// ── 4. extractPathsFromToolArgs ────────────────────────────────────────────

test("extraction: path-ish keys only, nested, deduped", () => {
  const args = {
    file_path: "/payroll/june.csv",
    note: "not a path",
    nested: { absolute_path: "/secrets/.env", filename: "readme.md" },
    command: "cat /etc/passwd", // NOT a path key — ignored
  };
  const paths = extractPathsFromToolArgs(args);
  assert.deepEqual([...paths].sort(), ["/payroll/june.csv", "/secrets/.env", "readme.md"]);
});

test("extraction: JSON string form parses", () => {
  const paths = extractPathsFromToolArgs('{"path": "/payroll/x.csv"}');
  assert.deepEqual(paths, ["/payroll/x.csv"]);
});

test("extraction: invalid JSON string returns empty", () => {
  assert.deepEqual(extractPathsFromToolArgs("{not json"), []);
});
