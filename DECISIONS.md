# Decisions

This is a concise log of major decisions and why they were made.

## 2026-06-07: Sacred context files require explicit user approval before edits

Why:

- the user wants project memory to be preserved and intentionally updated
- these files should evolve, but not be changed casually or implicitly

Impact:

- `AGENTS.md`, `PROJECT_CONTEXT.md`, `DECISIONS.md`, and `SESSION_HANDOFF.md` are sacred context files
- they should continue to grow with important project changes and decisions
- they must not be edited without explicit user approval in the current session
- `NEXT_SESSION_PROMPT.md` is not under the same always-evolving rule

## 2026-06-08: `SESSION_HANDOFF.md` should reset to the latest session snapshot

Why:

- the user wants the handoff file to describe only the current session state and immediate continuation context
- letting the handoff keep growing makes it noisier and less useful as an actual continuation aid

Impact:

- `SESSION_HANDOFF.md` should be treated as a replaceable current snapshot, not a cumulative history log
- when a new handoff is requested, stale or superseded content should be removed instead of appended to
- longer-lived project facts should stay in `PROJECT_CONTEXT.md` or `DECISIONS.md`, not be repeatedly accumulated in the handoff

## 2026-06-07: Use Node 22.22.0 as baseline

Why:

- Promptfoo `latest` and the repo engine constraint were aligned to Node `22.22.0+`

Impact:

- `.nvmrc` pinned to `22.22.0`
- new sessions should start with `nvm use 22.22.0`

## 2026-06-07: Keep Promptfoo on `latest`

Why:

- the user explicitly asked to revert changes caused by downgrading Promptfoo

Impact:

- repo uses `promptfoo: latest`

## 2026-06-07: Env loading via Node script flags, not source-level dotenv hacks

Why:

- source-level dotenv bootstrapping and custom path discovery added fragility
- the runtime already targets modern Node

Impact:

- `apps/api`, `apps/worker`, and database migrate scripts use `node --env-file-if-exists=...`
- source bootstrapping helpers were removed

## 2026-06-07: Fix API dev controller injection with explicit `@Inject(...)`

Why:

- API routes returned:
  - `Cannot read properties of undefined (reading 'syncOutline')`
  - and similar errors for `list` and `createManual`
- controller property injection via type metadata was not reliable in the dev runtime

Impact:

- explicit `@Inject(SourcesService)` and `@Inject(AnalysesService)` were added

## 2026-06-07: Fix evidence FK problem on re-index

Why:

- re-index failed because `knowledge_chunks` deletion conflicted with `retrieved_evidence`

Impact:

- migration `003_evidence_cascade.sql`
- app-layer cleanup in `apps/worker/src/document.processor.ts`

## 2026-06-07: Support OpenRouter for reasoning and embeddings

Why:

- user wanted live AI to work via OpenRouter, not only direct Anthropic/OpenAI

Impact:

- `OpenRouterReasoningProvider`
- `OpenRouterEmbeddingProvider`
- provider selection updated
- `.env.example` and `README.md` updated

## 2026-06-07: Sidebar runtime info should come from backend health, not inferred from latest run

Why:

- inferring from latest analysis run was incomplete and misleading
- embedding model also needed to be shown

Impact:

- `/api/v1/health` now includes runtime AI provider/model info
- sidebar reads from `/health`

## 2026-06-07: Keep sidebar AI footer visually secondary

Why:

- long model names make the footer dense quickly
- this is metadata, not a primary UX element

Impact:

- footer styling should remain minimal and non-heroic
- avoid overcomplicated “smart” shortening logic unless clearly useful

## 2026-06-07: Make Outline collection sync the primary source-ingestion flow

Why:

- the user did not want manual source entry exposed in the current MVP
- the real ingestion source is an Outline collection, not one-off document pasting

Impact:

- the main UI sync action targets Outline collections
- backend supports collection-level sync and fans out into per-document indexing
- manual source creation remains implemented but hidden

## 2026-06-07: Sync only leaf Outline documents from collection trees

Why:

- hierarchy containers such as `Sprint 1` were being indexed as if they were real source documents
- the user wanted only actual docs, not intermediate collection structure

Impact:

- collection tree flattening skips parent nodes that still have children
- only leaf documents are enqueued for indexing from collection sync

## 2026-06-07: Keep source sync UI as a lightweight header utility

Why:

- large sync cards on the `Sources` page wasted space and distracted from the indexed inventory
- the user wanted a simple place to paste the Outline collection URL/ID without extra chrome

Impact:

- the `Sources` page header now carries the collection sync input
- the sync action uses a ghost treatment without border
- the strong orange focus outline is suppressed locally for this header sync field

## 2026-06-07: Support full source reset from the Sources page

Why:

- the user needed a fast way to clear all synced docs and start over

Impact:

- `POST /sources/reset` deletes all `source_documents`
- cascades remove downstream chunks and retrieved evidence
- the worker tolerates stale embed jobs after a reset by returning early when chunks are gone

## 2026-06-08: Treat `/analyze` as the resume entrypoint for the last run

Why:

- the user wanted analysis progress to survive refresh/navigation and for returning to `Analyze` to reopen the relevant result instead of dropping back to an empty form
- a plain blank-form `Analyze` route made completed work feel lost unless the user manually reopened the report

Impact:

- the frontend now stores both the last active run and the last run overall
- `/analyze` shows the active-run state while a run is still `queued`, `retrieving`, or `analyzing`
- once that run completes or fails, `/analyze` redirects to `/analysis/:id`
- `Analyze another requirement` now uses `/analyze?fresh=1` to intentionally clear the remembered run and open a fresh form

## 2026-06-08: Delivery analysis must accept Outline sprint URLs directly

Why:

- the user does not want planning or sprint docs to be synced into `Sources`
- `Sources` is the product knowledge base, while sprint folders from `Planning`
  are live delivery input
- coupling delivery analysis to synced `source_groups` blocked valid sprint
  URLs and was the wrong product model

Impact:

- delivery analysis now accepts an Outline document URL directly
- the API resolves the delivery document live from Outline
- the worker reads the sprint subtree from Outline at analysis time
- `source_groups` are no longer required for delivery analysis input

## 2026-06-08: Delivery reports should be per-doc, not only bundle-level

Why:

- the user needs to see which specific sprint docs impact which parts of the
  product knowledge base
- a single bundle-level summary hides which delivery document causes which
  impact or conflict

Impact:

- delivery analysis now runs per sprint doc against indexed `Sources`
- delivery result shape stores one analysis block per sprint doc
- report UI shows every sprint doc even when no clear cross-source impact is
  found yet
- legacy bundle-level delivery results remain readable for older runs
