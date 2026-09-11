# 0002: One process and one database per backend

- Status: accepted
- Date: 2026-09-11

## Context

Multiple backends will be hosted under this repository over time. They could share a monolithic process and a single database schema, or run as isolated services.

Shared databases and processes create coupling across unrelated backends: schema migrations could collide, memory leaks or crashes in one backend would take down others, and resource limits cannot be applied per backend.

## Decision

Each backend runs as an independent systemd service on its own loopback port (4100–4199) and connects to its own dedicated PostgreSQL database named `api_<backend>`.
- In production, each backend runs under its own system user (`api_<backend>`) and connects to `api_<backend>` via peer authentication over the `/run/postgresql` Unix socket without passwords.
- In local development, each backend connects via TCP (`127.0.0.1:5433`) using the `DATABASE_URL` environment variable.
- There is no cross-backend database access.

## Consequences

- Clean isolation: backends can be restarted, upgraded, or fail independently.
- Independent database schemas and migrations.
- Easy port and user mapping convention: backend `<name>` gets port `41xx`, user `api_<name>`, and DB `api_<name>`.
