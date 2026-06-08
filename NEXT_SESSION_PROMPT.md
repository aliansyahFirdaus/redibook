# Next Session Prompt

Use this prompt to continue this project in a fresh session:

---

Read these files first and use them as the primary continuation context:

1. `AGENTS.md`
2. `PROJECT_CONTEXT.md`
3. `SESSION_HANDOFF.md`
4. `DECISIONS.md`

Then inspect the actual repo state before making assumptions.

Repo: `redibook`

Important baseline:

- Node `22.22.0`
- use `nvm use 22.22.0`
- `pnpm` workspace
- API: NestJS
- worker: NestJS + BullMQ
- web: SolidStart
- env is loaded by runtime scripts using `node --env-file-if-exists`

Important project facts:

- OpenRouter support exists for both reasoning and embeddings
- Outline sync bugs previously involved both API injection issues and real `401` config/auth problems
- sidebar AI runtime info is sourced from `/api/v1/health`
- aggressive orange focus on the analyze textarea was intentionally softened

Important behavior expectations:

- verify bugs through the real code path and real endpoint
- do not rely on speculation from browser errors
- if `.env` changes, restart `dev:api` and `dev:worker`

When continuing work, prefer concise, surgical changes and verify them.

---

