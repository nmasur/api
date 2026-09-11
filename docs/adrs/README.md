# Architecture Decision Records

One Markdown file per decision, numbered `NNNN-short-title.md`. Use the
template below. Never edit an accepted ADR's decision; supersede it with a
new ADR and link both ways.

```markdown
# NNNN: Title

- Status: proposed | accepted | superseded by NNNN
- Date: YYYY-MM-DD

## Context
## Decision
## Consequences
```

## Decisions

- [0001: Caddy is the router](0001-caddy-is-the-router.md)
- [0002: One process and one database per backend](0002-one-process-one-database-per-backend.md)
- [0003: Actual backend implemented in TypeScript](0003-actual-backend-in-typescript.md)
- [0004: Single process multi-budget with mutex for Actual backend](0004-single-process-multi-budget-with-mutex.md)
- [0005: API key authentication only](0005-api-key-auth-only.md)
- [0006: Hand-rolled SQL migrations](0006-hand-rolled-sql-migrations.md)
