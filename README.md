# api

A generic self-hosted REST API service fronted by Caddy, running on NixOS.

## Overview

This repository provides independent HTTP backends mounted under path prefixes on `api.masu.rs`. Caddy terminates TLS and routes each prefix (`/actual/*`, etc.) to its corresponding backend service after stripping the prefix.

Key principles:
- **Modular backends:** Each backend is an independent service with its own dedicated PostgreSQL database (`api_<backend>`).
- **Nix-first:** All building, testing, and deployment happen exclusively through Nix flakes.
- **Strict process and HTTP contracts:** Predictable JSON logging, API key authentication, health and readiness checks, and structured error responses.

Available backends:
- **[`actual`](docs/backends/actual.md):** Actual Budget integration for tap-to-pay mobile automations, multi-budget switching, card mappings, and audit logging.

---

## Consuming in NixOS (e.g. Dotfiles)

In your system flake (e.g. `github:nmasur/dotfiles`):

```nix
# flake.nix
inputs = {
  api.url = "github:nmasur/api";
  api.inputs.nixpkgs.follows = "nixpkgs";
};
```

Apply the overlay and import the NixOS module:

```nix
# configuration.nix
{
  nixpkgs.overlays = [ inputs.api.overlays.default ];
  imports = [ inputs.api.nixosModules.default ];

  services.api = {
    enable = true;
    hostname = "api.masu.rs";
    backends.actual = {
      enable = true;
      port = 4100;
      actualServerUrl = "http://127.0.0.1:5006";
      apiKeysFile = "/run/credentials/api-actual.service/api-keys";
      serverPasswordFile = "/run/credentials/api-actual.service/actual-password";
      budgets.personal = {
        syncIdFile = "/run/credentials/api-actual.service/sync-id-personal";
      };
    };
  };

  # Append generated Caddy routes to Caddy configuration
  nmasur.presets.services.caddy.routes = config.services.api.caddyRoutes;
}
```

---

## Writing a Backend

Any new backend (regardless of language: Go, Python, Rust, Node.js) follows these shared conventions:

### Process Contract
- **Listen address:** `127.0.0.1` only; port from environment variable `PORT` (allocated in the `4100–4199` range).
- **Configuration:** Environment variables only. No configuration files. Secrets are provided via systemd `EnvironmentFile` / `LoadCredential`.
- **Database:** PostgreSQL libpq URI via `DATABASE_URL` (e.g. `postgresql:///api_<name>?host=/run/postgresql`). Role and database are named `api_<backend>` and connect via peer authentication in production.
- **Startup:** Run schema migrations before binding port. Exit non-zero if migrations fail.
- **Shutdown:** Handle `SIGTERM` gracefully: finish in-flight requests, drain database connections, and exit within 10 seconds.
- **Logging:** One JSON line per message to stdout with fields: `time`, `level`, `msg`, `req_id`. Never log secrets or API keys.
- **State directory:** `STATE_DIR` env (systemd `StateDirectory`).

### HTTP Contract
- **Prefix stripping:** Caddy strips the backend path prefix (e.g. `/actual/*` is received by the backend as `/*`). Use `X-Forwarded-Prefix` to construct absolute links if needed.
- **Health check:** `GET /healthz` (unauthenticated) returns `200 {"status":"ok"}`.
- **Readiness check:** `GET /readyz` (unauthenticated) checks database reachability and upstream dependencies; returns `200` or `503 {"status":"degraded","checks":{...}}`.
- **Authentication:** All other routes require `X-API-Key: <key>` checked in constant time. Return `401 {"error":"unauthorized"}` when missing or invalid.
- **Request IDs:** Read `X-Request-Id` or generate a UUIDv4; echo back in header and attach to all log entries.
- **Request bodies:** Enforce `application/json` (reject others with 415) and 1 MiB payload limit.
- **Standard errors:** JSON responses conforming to `{"error":"<snake_case_code>","message":"<human>","details":{...}}`.

---

## Development

Prerequisites:
- [Nix](https://nixos.org/) with flakes enabled
- [direnv](https://direnv.net/) (optional, but recommended)

### Entering the environment

```bash
direnv allow # or: nix develop
```

### Local PostgreSQL database

Use the helper script to manage a local PostgreSQL 15 instance:

```bash
./scripts/dev-db.sh start   # starts Postgres on 127.0.0.1:5433
./scripts/dev-db.sh psql    # opens psql session to api_actual
./scripts/dev-db.sh stop    # stops Postgres
./scripts/dev-db.sh reset   # resets database cluster
```

### Running the Actual backend locally

```bash
cd backends/actual
npm install
npm run dev
```

### Testing

```bash
cd backends/actual && npm test
nix flake check
```

## Structure

```
.
├── backends/          # Backend implementations (e.g. actual/)
├── docs/              # Specifications, API guides, and ADRs
│   ├── PLAN.md
│   ├── adrs/
│   └── backends/
│       └── actual.md
├── nix/               # NixOS modules, library helpers, and VM tests
├── scripts/           # Development scripts
├── flake.nix          # Nix flake definition
└── README.md
```

## License

[MIT](LICENSE)
