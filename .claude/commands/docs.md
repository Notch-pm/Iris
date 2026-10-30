---
description: Update documentation for the most recent changes
---

Delegate to the `nicolas-documentation-writer` subagent.

## Scope

Update the project documentation based on the current branch's changes. Focus on:

- `CLAUDE.md` (root and per-folder) — index only: touch it only if the change affects golden
  rules, stack, or the index itself. Each is held under 40,000 characters by
  `src/claudeMd.test.ts`.
- `docs/features/*.md` — the feature fiche: this is where feature detail (decisions, pitfalls,
  code pointers) is written.
- `docs/*.md` — the specific file(s) covering the feature or module touched.
- `README.md` — only if setup, install, or usage instructions changed.

Do NOT create new docs unless necessary; prefer editing in place.
