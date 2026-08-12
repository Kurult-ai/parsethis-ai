import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { SELF_SERVICE_USER_ID } from "./constants.js";

/**
 * Every key minted by the public signup paths is owned by one sentinel user
 * row, and `api_keys.user_id` has a foreign key to it. When the row was absent,
 * the insert failed, the key fell to the Redis store with an id present in no
 * table, and `checkout.session.completed` could not write the Subscription —
 * so a customer could pay and never receive the plan, with an empty-string
 * error as the only trace.
 *
 * Nothing here needs a database. What these pin is the agreement between the
 * id the code writes and the id the row is created under: a divergence between
 * the two is precisely the outage, and it is invisible until someone buys.
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("self-service sentinel user", () => {
  it("is the id the signup path writes", () => {
    const auth = read("../auth.ts");
    assert.match(
      auth,
      /createApiKeyFromService\(SELF_SERVICE_USER_ID,/,
      "createApiKey must own its user id from the shared constant, not a literal",
    );
  });

  it("leaves no competing literal behind in the key service", () => {
    const service = read("../api-key-service.ts");
    assert.doesNotMatch(
      service,
      /"self-service"/,
      "a hardcoded id here can drift from the row the bootstrap creates",
    );
  });

  it("is created by the migration under exactly that id", () => {
    const sql = read("../../prisma/migrations/013_add_self_service_user.sql");
    assert.ok(
      sql.includes(`'${SELF_SERVICE_USER_ID}'`),
      `013 must insert the row as '${SELF_SERVICE_USER_ID}'`,
    );
    assert.match(sql, /ON CONFLICT \(id\) DO NOTHING/, "the migration must be re-runnable");
  });

  it("is created at boot too, for databases built by prisma db push", () => {
    const bootstrap = read("./self-service-user.ts");
    assert.match(bootstrap, /prisma\.user\.upsert/, "boot path must be idempotent");
    assert.match(bootstrap, /SELF_SERVICE_USER_ID/);

    const index = read("../index.ts");
    assert.match(index, /ensureSelfServiceUser\(\)/, "index.ts must run the bootstrap on startup");
  });

  it("cannot be logged into", () => {
    const bootstrap = read("./self-service-user.ts");
    assert.match(bootstrap, /\.invalid/, "sentinel email must be undeliverable (RFC 2606)");
    assert.doesNotMatch(bootstrap, /\$2[aby]\$/, "must not carry a real bcrypt hash");
  });
});
