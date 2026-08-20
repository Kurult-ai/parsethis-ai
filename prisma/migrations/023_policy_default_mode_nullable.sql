-- "Unset" and "explicitly chose full" must be different values.
--
-- ScreeningPolicy.default_mode was NOT NULL DEFAULT 'full'. Every one of the 47
-- rows on production therefore read 'full', whether or not anyone had ever
-- chosen it. The resolver added in the run-21 remediation honours a stored
-- policy over the tier default — which is the right precedence — but with this
-- column there was no such thing as an unstored policy, so the tier default
-- could never apply and GET /v1/policy went on reporting `defaultMode: "full"`
-- for a Solo key that demonstrably ran pattern-only.
--
-- That is the defect prospect run 21 reported, one layer deeper than it first
-- appeared: fixing the resolver was necessary and not sufficient.
--
-- Backfill reasoning. Existing 'full' rows are indistinguishable from unset, so
-- they become NULL. The direction of that change is toward privacy and is
-- per-call overridable: a Solo key now defaults to pattern-only (its text stops
-- leaving for a model provider) and any call may still ask for "full". No key
-- loses a capability.

ALTER TABLE screening_policies ALTER COLUMN default_mode DROP DEFAULT;
ALTER TABLE screening_policies ALTER COLUMN default_mode DROP NOT NULL;

UPDATE screening_policies SET default_mode = NULL WHERE default_mode = 'full';
