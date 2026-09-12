# Changelog

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
