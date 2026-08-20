import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { LEGAL_ENTITY, entityDisclosureHtml } from "./product-facts.js";

describe("legal entity disclosure", () => {
  it("names Kurultai Labs LLC on the public disclosure", () => {
    assert.equal(LEGAL_ENTITY.registeredEntity?.publiclyNamed, true);
    assert.match(entityDisclosureHtml(), /Kurultai Labs LLC/);
  });

  it("does not invent a Secretary of State id or LEI", () => {
    assert.equal(LEGAL_ENTITY.registeredEntity?.registrationNumber, null);
    assert.equal(LEGAL_ENTITY.registeredEntity?.lei, null);
  });
});
