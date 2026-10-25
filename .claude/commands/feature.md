---
description: Full feature pipeline — spec → architecture → implementation → validation → docs
argument-hint: <feature description>
---

Run the full feature pipeline for the following request:

$ARGUMENTS

Execute the phases below in order. Stop and check with the user between phases if a blocker or open question surfaces.

## Phase 1 — Clarify requirements

Delegate to the `cecile-business-analyst` subagent. Wait for its specification.

## Phase 2 — Design

Delegate to the `loic-chief-architect` subagent, passing the specification from Phase 1. Wait for its implementation plan.

## Phase 3 — Implementation

Based on the architect's plan, delegate ONLY to the engineers whose work is required, in this order:

1. `david-database-expert` — if schema, migrations, RLS or indexes change.
2. `riadh-backend-engineer` — if APIs, edge functions, services or business logic change.
3. `corentin-frontend-engineer` — if UI, components, pages or client state change.

DB must come before backend (schema before code). Backend must come before frontend (UI cannot bind to a missing API).

## Phase 4 — Validation (in parallel)

- `jean-christophe-qa-engineer` — tests and coverage.
- `valentin-security-reviewer` — audit.
- `camille-ux-reviewer` — usability (only if UI was touched).
- `agnes-product-reviewer` — product coherence.

## Phase 5 — Documentation

Delegate to the `nicolas-documentation-writer` subagent to update the affected docs.

## Reporting

After each phase produce a one-paragraph summary and mark: DONE / BLOCKED / SKIPPED.

At the end, list what was shipped, what was tested, what remains open.
