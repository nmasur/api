# 0003: Actual backend implemented in TypeScript

- Status: accepted
- Date: 2026-09-11

## Context

The initial backend integrates with Actual Budget to record transactions, list accounts, and manage card mappings.

Actual Budget's API is only published as the `@actual-app/api` Node.js package. The Actual maintainers officially state that other languages are unsupported, and direct manipulation of Actual's SQLite / sync protocol from another language would be brittle and high-maintenance.

## Decision

The `actual` backend is implemented in TypeScript on Node.js 22, using Fastify as the HTTP framework and `pg` for PostgreSQL access.

## Consequences

- Full compatibility with `@actual-app/api`.
- Packaging in Nix uses `buildNpmPackage`.
- Low-overhead HTTP handling with Fastify's schema validation and async handlers.
