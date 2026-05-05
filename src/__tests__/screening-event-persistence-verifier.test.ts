import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function runVerifier(env: Record<string, string>) {
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/verify-screening-event-persistence.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: "",
      SCREENING_EVENT_DB_VERIFY_WRITE: "",
      SCREENING_EVENT_DB_VERIFY_ALLOW_SHARED_DB: "",
      ...env,
    },
    encoding: "utf8",
  });
  const output = JSON.parse(result.stdout.slice(result.stdout.indexOf("{"))) as {
    status: string;
    reason: string;
    database_url_present: boolean;
    write_enabled: boolean;
    allow_shared_db_override?: boolean;
    claimability_status: string;
  };
  return { result, output };
}

describe("screening event persistence verifier command", () => {
  it("skips safely when DATABASE_URL is not set", () => {
    const { result, output } = runVerifier({});

    assert.equal(result.status, 0, result.stderr);
    assert.equal(output.status, "skipped");
    assert.match(output.reason, /DATABASE_URL is not set/);
    assert.equal(output.database_url_present, false);
    assert.equal(output.claimability_status, "pass_internal_not_claimable");
  });

  it("refuses production-looking write targets before connecting", () => {
    const { result, output } = runVerifier({
      DATABASE_URL: "postgresql://user:secret@prod-db.example.com/parse_for_agents",
      SCREENING_EVENT_DB_VERIFY_WRITE: "1",
    });

    assert.equal(result.status, 1);
    assert.equal(output.status, "blocked_unsafe_target");
    assert.match(output.reason, /production-like/);
    assert.equal(output.database_url_present, true);
    assert.equal(output.write_enabled, true);
    assert.equal(output.allow_shared_db_override, false);
    assert.equal(result.stdout.includes("secret"), false);
  });

  it("refuses shared-looking write targets unless explicitly overridden", () => {
    const { result, output } = runVerifier({
      DATABASE_URL: "postgresql://user:secret@db.example.com/parse_for_agents",
      SCREENING_EVENT_DB_VERIFY_WRITE: "1",
    });

    assert.equal(result.status, 1);
    assert.equal(output.status, "blocked_unsafe_target");
    assert.match(output.reason, /does not look local\/disposable/);
  });
});
