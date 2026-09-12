# Changelog

## 2026-09-12: Implement Actual client with multi-budget mutex and budget query endpoints

- Created `@actual-app/api` wrapper (`src/actual/client.ts`) with `AsyncMutex` for single-process multi-budget switching, caching, and lifecycle management.
- Added budget query routes in `src/http/routes/budgets.ts`:
  - `GET /budgets`: list configured budget names.
  - `GET /budgets/:budget/accounts`: proxy `getAccounts()` with closed/offbudget flags.
  - `GET /budgets/:budget/payees`: proxy `getPayees()`.
  - `GET /budgets/:budget/categories`: proxy `getCategories()`.
  - `POST /budgets/:budget/sync`: force download and synchronization with timing.
- Added test suite in `test/budgets.test.ts` verifying concurrency mutex, budget switching, caching, and route behavior.

## 2026-09-12: Implement database migrations and initial schema

- Added database migration runner (`src/db/migrate.ts`) tracking applied migrations in `schema_migrations` with sha256 checksums and transaction safety.
- Created `0001_init.sql` schema defining `budgets_seen`, `card_mappings`, and `transaction_log` tables with indexes.
- Integrated migrations into backend startup lifecycle in `src/main.ts`.
- Added test suite verifying idempotency and tamper detection against PostgreSQL.

## 2026-09-11: Initial project scaffold and test endpoints

- Initialized flake development environment (`flake.nix`, `flake.lock`) supporting Darwin and Linux across x86_64 and aarch64 with Node.js 22, TypeScript, PostgreSQL 15, and nixfmt.
- Added project documentation, MIT license, `.envrc`, `.gitignore`, and `scripts/dev-db.sh` for local PostgreSQL cluster management.
- Documented initial Architecture Decision Records (`0001` through `0006`) in `docs/adrs/`.
- Added `docs/LOCAL_TESTING.md`: quickstart guide for running and testing the API locally with `curl` and browser.
- Created `backends/actual` HTTP service skeleton with Fastify:
  - Strict JSON logging with `req_id`, `time`, `level`, `msg` and header redaction.
  - Constant-time API key verification (`X-API-Key`) supporting key rotation via `API_KEYS`.
  - Unauthenticated `/healthz` and `/readyz` endpoints.
  - Authenticated call-and-response endpoints: `GET /ping` and `POST /echo`.
  - Structured error handling adhering to the HTTP contract.
  - Graceful shutdown on `SIGTERM` / `SIGINT`.
  - Comprehensive unit and integration test suite using Vitest.

## 2026-09-11: Initial implementation plan

- Added `docs/PLAN.md`: full specification for a generic multi-backend REST
  API served by Caddy on `flame`, with an Actual Budget backend
  (TypeScript, `@actual-app/api`, multi-budget via mutex), Postgres per
  backend, Nix-only dev/build/deploy, flake outputs, and the dotfiles
  integration steps that replace the existing `actualtap` instances.
- Added `docs/adrs/README.md` with the ADR template and the initial ADR list.
