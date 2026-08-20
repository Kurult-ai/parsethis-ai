---
title: "Screening Metrics And Evidence"
slug: screening-metrics
date: "2026-05-06"
lastUpdated: "2026-05-06"
description: "How Parse reports screening metrics, holdout evidence, false positives, recall, precision, and latency."
author: "Parse"
---

# Screening Metrics And Evidence

Parse reports screening performance as evidence, not as a guarantee. Prompt injection remains a residual-risk problem, so every metric should be read with corpus, mode, sample size, and false-positive context.

## Metrics to inspect

- Recall: malicious rows correctly flagged.
- Precision: flagged rows that were actually malicious.
- Benign false-positive rate: benign rows incorrectly flagged.
- F1: harmonic mean of precision and recall.
- p95 and p99 latency: time to decision at the screening boundary.
- Utility degradation: benign workflow success with Parse enabled versus without Parse.

## Claim discipline

Generated fixtures and internal adversarial runs are useful regression evidence, but public claims should use frozen manifests, content hashes, holdout separation, and confidence intervals.
