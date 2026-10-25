---
description: Pre-merge review — qa + security + ux + product on the current diff
---

Run the full pre-merge review on the current branch's changes.

## Steps

1. Identify the diff scope: `git diff main...HEAD --stat` (adjust the base branch if the project uses another default).

2. Delegate in parallel:
   - `jean-christophe-qa-engineer` — test coverage and regression risk.
   - `valentin-security-reviewer` — realistic threats.
   - `camille-ux-reviewer` — usability and consistency (skip if no UI change).
   - `agnes-product-reviewer` — product coherence, scope, naming.

3. Aggregate findings by severity across all four reports.

4. Emit a final verdict: MERGE-READY / TWEAK-THEN-MERGE / REWORK-NEEDED.
