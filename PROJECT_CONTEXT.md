# Project Context

This file captures stable project context and important cross-session knowledge.

## Sacred file rule

This repo treats the following files as sacred context files:

- `AGENTS.md`
- `PROJECT_CONTEXT.md`
- `DECISIONS.md`
- `SESSION_HANDOFF.md`

Policy:

- They are expected to keep growing as the project changes.
- They should capture important changes, ideas, decisions, debugging outcomes, and project-memory context.
- `NEXT_SESSION_PROMPT.md` is not required to evolve continuously.
- These sacred files may only be modified when the user explicitly approves that update in the current session.
- Without explicit approval, agents must treat them as read-only.

## Product intent

Build a product knowledge impact analyzer MVP with this workflow:

1. create or sync a source
2. normalize into chunks
3. embed chunks
4. submit a requirement
5. run quality check
6. retrieve evidence with hybrid search
7. run reasoning
8. validate evidence references
9. persist and display the result

Delivery-analysis intent:

- `Sources` is the indexed product knowledge base, typically synced from an
  Outline collection such as `Lab`
- sprint or planning docs are delivery input, not product source knowledge
- delivery analysis should accept an Outline sprint URL directly from
  `Planning`, read its subtree live from Outline, and analyze the impact of
  those changes against the indexed `Sources`
- delivery reporting is per sprint doc, not only one bundle summary

## Stack

- Frontend: SolidStart + TanStack Solid Query + Tailwind/CSS
- API: NestJS
- Worker: NestJS + BullMQ
- Database: PostgreSQL + pgvector, raw SQL migrations, `pg`
- Queue: Redis + BullMQ
- AI:
  - mock providers by default
  - OpenRouter supported for both reasoning and embeddings
  - direct Anthropic reasoning and direct OpenAI embeddings still supported

## Runtime model/provider policy

Provider selection order is:

### Embeddings

1. `OPENROUTER_API_KEY`
2. otherwise `OPENAI_API_KEY`
3. otherwise mock embeddings

### Reasoning

1. `OPENROUTER_API_KEY`
2. otherwise `ANTHROPIC_API_KEY`
3. otherwise mock reasoning

## Environment loading policy

The repo no longer depends on source-level dotenv bootstrap hacks.

Current policy:

- env is loaded by runtime scripts using Node's `--env-file-if-exists`
- this applies to:
  - `apps/api/package.json`
  - `apps/worker/package.json`
  - `packages/database/package.json`

Consequence:

- changing `.env` requires restarting API and worker processes

## Outline sync context

Outline sync is implemented in:

- `apps/api/src/sources.module.ts`

Important operational facts:

- `OUTLINE_BASE_URL` must point to the real Outline host in use
- `OUTLINE_API_KEY` must belong to that Outline instance and have the needed scope
- an Outline `401` is a real auth/config failure, not a fake frontend error
- collection sync is now the primary UI flow
- collection sync calls Outline `collections.documents`, then fetches each leaf document via `documents.info`
- collection parents / hierarchy containers should not be indexed as standalone sources
- source reset is supported and deletes all synced source documents plus downstream chunks/evidence

URL handling note:

- URLs like `https://docs.redikru.com/doc/crew-lvvQXRsfmu`
- are currently reduced to the last path segment:
  - `crew-lvvQXRsfmu`
- collection URLs like `https://docs.redikru.com/collection/redibook-abc123`
- are currently reduced to the last path segment:
  - `redibook-abc123`

## Important UI context

### Sidebar nav

- old initial-letter nav markers were removed
- icons now use `lucide-solid`

### Sidebar footer

- old hardcoded `Mock-first workspace` text was removed
- sidebar now shows runtime AI information from `/api/v1/health`
- this area was iterated repeatedly because long provider/model strings can make the sidebar feel visually dense

### Analyze textarea focus

- the strong global orange focus outline was too aggressive on the `Product requirement` textarea
- a local override now softens focus styling for `.requirement-input`

### Analyze route persistence

- analysis execution is queue-backed and continues after navigation or refresh once `POST /analyses` has been accepted
- the `Analyze` route now behaves as a resume entrypoint for the last analysis run, not just a blank form
- if the last run is still active, `/analyze` shows the in-progress panel and keeps the sidebar `Analyze` nav item marked as active work
- if the last run has completed or failed, returning to `/analyze` redirects to `/analysis/:id`
- starting a genuinely new run from the report screen should use `/analyze?fresh=1`, which clears the remembered run and opens the blank form

### Delivery analysis

- `Analyze > Delivery` should not depend on synced `source_groups`
- delivery input is an Outline document URL, not a synced source reference
- the backend resolves the delivery document live via Outline `documents.info`
  and `documents.documents`
- the worker expands the sprint subtree to leaf docs and analyzes each sprint
  doc independently against indexed `Sources`
- the delivery report should show per-doc impact rather than one combined
  bundle result

### Sources page sync UI

- the large collection sync card was removed
- the primary sync control now lives in the page header as a lightweight URL/ID input plus ghost `Sync` action
- the header sync field suppresses the strong orange focus outline locally
- the inventory header keeps only document count + `Reset docs`

## Known debugging traps

- Do not assume Docker or Redis explains every bug.
- Do not assume a browser error means frontend code is wrong.
- Do not assume live env changes are picked up without process restart.
- Do not over-normalize provider/model names in UI if it introduces tricky logic.

## Verification culture for this repo

The user prefers repo-grounded verification:

- inspect the real code path
- hit the real endpoint
- verify the actual rendered UI
- do not stop at speculation
