---
description: Security audit of the current changes (or a specified scope)
argument-hint: [optional scope — file or directory]
---

Delegate to the `valentin-security-reviewer` subagent.

## Scope

If `$ARGUMENTS` is provided, audit that file or directory.

Otherwise audit the current branch diff against the default branch.

## Output

Return findings grouped by severity (Critical / High / Medium / Low) with concrete fixes for each.
