# api

A generic self-hosted REST API service fronted by Caddy, running on NixOS.

## Overview

This repository provides small, independent HTTP backends mounted under path prefixes on `api.masu.rs`. Caddy terminates TLS and routes each prefix (`/actual/*`, etc.) to its corresponding backend service after stripping the prefix.

Key principles:
- **Modular backends:** Each backend is an independent service with its own dedicated PostgreSQL database (`api_<backend>`).
- **Nix-first:** All building, testing, and deployment happen exclusively through Nix flakes.
- **Strict process and HTTP contracts:** Predictable JSON logging, API key authentication, health and readiness checks, and structured error responses.

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

### Running a backend

Each backend lives under `backends/<name>`. To run the `actual` backend locally:

```bash
cd backends/actual
npm install
npm run dev
```

## Structure

```
.
├── backends/          # Backend implementations (e.g. actual/)
├── docs/              # Specifications and Architecture Decision Records (ADRs)
├── nix/               # NixOS modules, overlays, and VM tests
├── scripts/           # Development scripts
├── flake.nix          # Nix flake definition
└── README.md
```

## License

[MIT](LICENSE)
