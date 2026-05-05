# Candidate Holdouts

This directory stores candidate screening holdout evidence for Parse Agents.

## Evidence Lanes

- `sota-synthetic-12000/` contains synthetic frozen holdout candidate rows generated outside the Parse repo. These rows are useful for schema validation, scale checks, review workflows, and future evaluation rehearsals.
- Rows in this directory are not externally claimable evidence unless a manifest explicitly says `pass_claimable` and records independent provenance, detector/config lock, dedupe proof, confidence interval pass, and no-post-freeze tuning.
- Do not tune detectors, thresholds, or policies on these rows before deciding whether they are being used as a holdout candidate.

## Current Corpus

`sota-synthetic-12000/` currently freezes:

- 12,000 synthetic rows.
- 48 JSONL batch files.
- 1,000 rows for each tracked Hermes/runtime metric slice.
- 0 duplicate IDs or prompts against the corpus.
- 0 exact ID or normalized-prompt overlaps against tracked in-repo screening fixtures.

Current blockers are recorded in `sota-synthetic-12000/screening-synthetic-holdout-freeze-manifest.json`.

