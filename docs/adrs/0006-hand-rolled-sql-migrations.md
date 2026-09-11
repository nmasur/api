# 0006: Hand-rolled SQL migrations

- Status: accepted
- Date: 2026-09-11

## Context

Database migrations must run automatically on service startup before accepting incoming HTTP requests.

Third-party Node migration frameworks (like Knex, TypeORM, Prisma, or node-pg-migrate) add numerous transitive dependencies, native build tools, or complex CLI generators that complicate Nix packaging (`buildNpmPackage`) and increase attack surface.

## Decision

Implement a lightweight, self-contained migration runner directly in the codebase (~60 lines of TypeScript):
- Reads numbered SQL migration files (`NNNN_name.sql`) in order.
- Applies each inside a PostgreSQL transaction.
- Tracks applied migrations and their SHA-256 hashes in a `schema_migrations` table.
- Rejects startup if a previously applied migration's content hash changed.

## Consequences

- Minimal dependencies (relies only on `pg` and Node's built-in `crypto`).
- Deterministic, fast, and simple to debug.
- Trivially packaged in Nix.
