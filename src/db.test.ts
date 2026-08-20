import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  databaseUrlSchema,
  databaseUrlWithoutPrismaSchemaParam,
  databaseUrlWithSchemaSearchPath,
} from "./db.js";

describe("databaseUrlWithSchemaSearchPath", () => {
  it("translates Prisma-style schema query param into Postgres search_path options", () => {
    const input = "postgresql://user:pass@example.com:5432/app?schema=agents";
    const output = databaseUrlWithSchemaSearchPath(input);
    const url = new URL(output);

    assert.equal(url.searchParams.get("schema"), null);
    assert.equal(url.searchParams.get("options"), "-c search_path=agents");
  });

  it("preserves existing connection params while adding schema search_path", () => {
    const input = "postgresql://user:pass@example.com/app?schema=agents&sslmode=require&connection_limit=5";
    const url = new URL(databaseUrlWithSchemaSearchPath(input));

    assert.equal(url.searchParams.get("sslmode"), "require");
    assert.equal(url.searchParams.get("connection_limit"), "5");
    assert.equal(url.searchParams.get("options"), "-c search_path=agents");
  });

  it("extracts and removes schema for PrismaPg adapter options", () => {
    const input = "postgresql://user:pass@example.com/app?schema=agents&sslmode=require";

    assert.equal(databaseUrlSchema(input), "agents");
    const stripped = new URL(databaseUrlWithoutPrismaSchemaParam(input));
    assert.equal(stripped.searchParams.get("schema"), null);
    assert.equal(stripped.searchParams.get("sslmode"), "require");
  });
});
