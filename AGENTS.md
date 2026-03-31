# AGENTS.md

## Cursor Cloud specific instructions

### Overview

Crabagent is a pnpm monorepo (pnpm@9.15.0, Node 22+) with three packages:

| Package | Path | Port |
|---------|------|------|
| `@crabagent/collector` | `services/collector` | 8787 |
| `@crabagent/web` | `apps/web` | 3000 |
| `@crabagent/openclaw-trace-plugin` | `packages/openclaw-trace-plugin` | N/A |

### Running services

Start both services: `pnpm dev` (from repo root). Or individually:
- `pnpm dev:collector` — Hono + SQLite backend on port 8787
- `pnpm dev:web` — Next.js 15 Turbopack frontend on port 3000

The web app needs `apps/web/.env.local` (copy from `.env.example`). Default `NEXT_PUBLIC_COLLECTOR_URL=http://127.0.0.1:8787` works for local dev.

Auth is off by default (`CRABAGENT_DISABLE_API_KEY_AUTH` not needed unless `CRABAGENT_API_KEY` is set).

### Lint / Test / Build

See root `package.json` scripts. Key commands:
- `pnpm lint` — runs lint across all packages (web uses `next lint`)
- `pnpm test` — runs plugin unit tests (may hang ~60s after all tests pass due to flush timer; safe to kill)
- `pnpm --filter @crabagent/collector test` — collector unit tests
- `pnpm build` — builds collector (tsc), plugin typecheck, web (next build)
- `pnpm smoke` — builds collector then runs full-stack smoke test (spins up temp collector on random port)

### Gotchas

- Plugin tests (`pnpm test`) may hang after all tests pass because `plugin-register-smoke.test.ts` starts a flush service with a keep-alive timer. All tests report OK before the hang; it is safe to terminate.
- Plugin `typecheck` has pre-existing errors related to cross-package imports in test files and a `string | null` type issue. This does not block runtime or tests.
- The collector uses embedded SQLite (auto-created at `services/collector/data/crabagent.db`). No external database needed.
- The `/v1/ingest` endpoint is deprecated (returns 410). Use `POST /v1/opik/batch` for trace ingestion.
