# 0001: Caddy is the router

- Status: accepted
- Date: 2026-09-11

## Context

The API service hosts multiple independent backends (e.g. `actual`, and future services) behind a single public domain (`api.masu.rs`). We considered running an in-repo API gateway process (such as Traefik, Kong, or a custom reverse proxy) to route requests to backend processes.

However, the production host (`flame`) already runs Caddy, managed declaratively via NixOS. Running a second gateway inside the application layer would add an extra hop, redundant TLS/HTTP handling, and another service to supervise.

## Decision

Caddy on `flame` serves as the sole reverse proxy and router:
- Backends are mounted under path prefixes (e.g. `/actual/*`).
- Caddy strips the backend path prefix before proxying to `127.0.0.1:<port>`.
- Caddy passes `X-Forwarded-Prefix` so backends can construct external links if needed.
- The repo's NixOS module computes and exports Caddy route configuration (`caddyRoutes`) for the host configuration to consume.

## Consequences

- No gateway process in this repository.
- Backends are written as if mounted at root (`/`).
- Routing is defined declaratively through Nix and managed by Caddy.
