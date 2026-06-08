# Redibook

Product knowledge impact analyzer MVP. It indexes product knowledge from
Outline collections, retrieves relevant knowledge with PostgreSQL full-text
search and pgvector, then produces evidence-backed impact analyses
asynchronously through BullMQ.

## Local development

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres redis migrate
pnpm dev:api
pnpm dev:worker
pnpm dev:web
```

The default AI providers are deterministic local mocks. Add `OPENROUTER_API_KEY`
to route both reasoning and embeddings through OpenRouter, or use
`OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY` to activate the direct providers
independently.

## Analysis flow

- Submitting a requirement enqueues an asynchronous analysis job; the worker
  continues even if the user navigates away or refreshes after the request is
  accepted.
- The `Analyze` route now resumes the most recent analysis run and shows the
  in-progress state while that run is still active.
- If the most recent remembered run has completed or failed, returning to
  `/analyze` redirects to its report.
- To intentionally start a brand-new requirement from the report screen, use
  the `Analyze another requirement` action, which opens `/analyze?fresh=1`.

## Delivery analysis

- `Analyze > Delivery` accepts an Outline document URL for a sprint or delivery
  folder, for example `https://docs.redikru.com/doc/sprint-2-2KehWiBDfH`.
- Delivery input is read live from Outline and does not need to be synced into
  `Sources` first.
- The worker expands the sprint subtree into leaf documents and compares those
  changes against the indexed product knowledge in `Sources`.
- Delivery results are now `per-doc`, not only bundle-level:
  each sprint doc gets its own impact summary, impacted areas, possible
  conflicts, dependencies, missing clarifications, and evidence.
- Legacy bundle-level delivery results are still readable in the report UI for
  older runs.

## Source sync

- The current primary ingestion flow is Outline collection sync from the
  `Sources` page.
- Paste a collection URL or collection ID into the header input and trigger
  `Sync`.
- Collection sync traverses the Outline tree but only indexes leaf documents,
  not intermediate hierarchy containers.
- `Reset docs` clears all synced source documents and their indexed chunks.

## Verification

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm test:promptfoo
docker compose config
```
