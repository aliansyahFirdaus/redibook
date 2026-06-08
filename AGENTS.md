# AGENTS.md

Start here in a new session.

## Scope

This repo is `redibook`, a product knowledge impact analyzer MVP.

- `apps/web`: SolidStart frontend
- `apps/api`: NestJS API
- `apps/worker`: NestJS BullMQ worker
- `packages/*`: shared contracts, AI, database, retrieval, ingestion, queue, observability

## Read these files first

1. [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md)
2. [SESSION_HANDOFF.md](./SESSION_HANDOFF.md)
3. [DECISIONS.md](./DECISIONS.md)
4. [README.md](./README.md)

If the user asks to continue an in-flight task, read `SESSION_HANDOFF.md` first.

## Sacred context files

The following files are sacred project-context files:

- `AGENTS.md`
- `PROJECT_CONTEXT.md`
- `DECISIONS.md`
- `SESSION_HANDOFF.md`

Rules:

- These files are expected to evolve with the project.
- They should capture important changes, ideas, decisions, debugging outcomes, and continuation context.
- `SESSION_HANDOFF.md` is special: treat it as a resettable per-session handoff snapshot, not a cumulative running log.
- When updating `SESSION_HANDOFF.md`, prefer replacing stale or no-longer-relevant content so the file stays focused on the latest session state and immediate continuation context.
- `NEXT_SESSION_PROMPT.md` is not subject to the same always-evolving requirement.
- An agent must not modify these sacred files unless the user explicitly gives permission in the current session.
- Without explicit user approval, treat these files as operationally read-only.
- If approval is given, update them carefully and intentionally.

## Runtime baseline

- Node: `22.22.0`
- Package manager: `pnpm`
- `.nvmrc` exists and should be respected
- Docker is mainly for Postgres and Redis

## Important commands

```bash
nvm use 22.22.0
docker compose up -d postgres redis
pnpm dev:api
pnpm dev:worker
pnpm dev:web
pnpm db:migrate
pnpm typecheck
pnpm lint
pnpm test
```

## Non-obvious repo rules from prior work

- Do not guess from browser errors alone. Verify with `curl` against the API.
- If `.env` changes, restart `dev:api` and `dev:worker`.
- OpenRouter support exists for both reasoning and embeddings.
- Outline sync failures with `401` were real auth/base-url issues, not frontend issues.
- The API dev runtime had a controller injection bug before. That was fixed with explicit `@Inject(...)`.

## About the context files

These files are a structured continuation aid built from:

- the currently available conversation context in this session
- repo state and actual code changes
- verified debugging outcomes

They are not a guaranteed verbatim raw transcript of every historical chat bubble.
