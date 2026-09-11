# 0004: Single process multi-budget with mutex for Actual backend

- Status: accepted
- Date: 2026-09-11

## Context

`@actual-app/api` maintains global state per Node process (only one budget file can be open at a time via `init` / `downloadBudget`).

The previous setup (`actualtap`) ran one OS service per budget file. For N budgets, this required N systemd services, N ports, and N separate routes, and made shared card mappings or multi-budget management difficult.

## Decision

Run a single `api-actual` process that supports multiple budgets using an in-process async mutex:
- On startup, the SDK initializes once with credentials and `dataDir`.
- Budget access is wrapped in `withBudget(name, fn)` guarded by an async mutex (promise-chain lock).
- When a request requires budget `B` and the currently loaded budget is not `B`, `downloadBudget(syncId)` switches to `B` (which performs a quick sync if already cached locally).
- If budget switching latency in production consistently exceeds 2 seconds, we will revisit this decision and evaluate child processes with IPC proxying as a fallback.

## Consequences

- A single port and single service manages all budgets.
- Requests across different budgets are serialized by the mutex, which is completely adequate for personal tap-to-pay and automated sync workloads.
- Cache files are retained across calls in `$STATE_DIR/actual`.
