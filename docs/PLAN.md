# Implementation Plan: `api` — a generic self-hosted REST API service

This document is the full specification for building this repository. It is
written so that an implementer can follow it step by step without needing to
make architectural decisions. Where a decision has already been made, it is
stated as a rule. Where something must be checked at implementation time, it
is marked **VERIFY**.

Related repository: `../dotfiles` (github:nmasur/dotfiles). The `flame` host
(`hosts/aarch64-linux/flame`) is an Oracle free-tier `aarch64-linux` NixOS VM
that already runs Caddy, PostgreSQL 15, Actual Budget, and two `actualtap`
instances. This repository will replace those `actualtap` instances and
become the home for any future small HTTP backends.

---

## 1. Goals and non-goals

### Goals

1. A single public hostname, `api.masu.rs`, served by the existing Caddy on
   `flame`, that fronts **many independent backends**, each mounted under its
   own path prefix (`/actual/...`, `/foo/...`).
2. Backends may be written in **any language**. The repo provides shared
   conventions (auth, health, logging, config, database access) rather than a
   shared runtime.
3. All development, building, and deployment through **Nix flakes only**. No
   Docker, no `oci-containers`, no `npx`/`pip install` outside a Nix shell.
4. **PostgreSQL** is the only database. Local dev uses a Postgres started from
   the dev shell; production uses the existing shared Postgres on `flame`
   over its Unix socket.
5. The repo is **open source**, exposes `packages`, `nixosModules`, and
   `overlays` flake outputs, and the dotfiles flake consumes it as an input
   and enables it via an `nmasur.presets.services.api` preset.
6. First backend: **`actual`** — an Actual Budget integration inspired by
   [actualtap](https://github.com/MattFaz/actualtap), but supporting
   **multiple budget files** from one service, with a Postgres-backed audit
   log, idempotency, and editable card-to-account mappings.

### Non-goals (for the first release)

- No web UI. No OIDC login. API-key auth only.
- No in-repo reverse proxy or "gateway" process. Caddy on `flame` is the
  router. The repo only tells Nix what routes to add.
- No multi-host deployment; only `flame`.
- No generated client SDKs.

---

## 2. Architecture overview

```
 iOS Shortcut / curl / n8n
          │  HTTPS  https://api.masu.rs/actual/<budget>/transactions
          ▼
 ┌─────────────────────────── flame (NixOS) ───────────────────────────┐
 │  Caddy (already exists, JSON config assembled from Nix)             │
 │    host api.masu.rs                                                  │
 │      path /actual/*  ──strip prefix──▶ 127.0.0.1:4100  api-actual   │
 │      path /<next>/*  ──strip prefix──▶ 127.0.0.1:41xx  api-<next>   │
 │      path /healthz   ──▶ static 200 (Caddy itself)                   │
 │                                                                      │
 │  api-actual (systemd, Node.js)  ──▶ Actual server 127.0.0.1:5006     │
 │        │                                                             │
 │        └── unix socket /run/postgresql, db "api_actual"              │
 │  postgresql.service (already exists, PG15)                           │
 └──────────────────────────────────────────────────────────────────────┘
```

Rules that follow from this picture:

- **One systemd service per backend.** Each listens on `127.0.0.1:<port>`
  only. Ports are allocated in the 4100–4199 range; `actual` gets 4100.
- **Caddy strips the backend prefix.** A backend is written as if it were
  mounted at `/`. It must not hard-code its public prefix. It receives the
  original prefix via the `X-Forwarded-Prefix` header (Caddy adds it) so it
  can build absolute links if it ever needs to.
- **Each backend owns one Postgres database** named `api_<backend>`, owned
  by a Postgres role of the same name, connected via peer auth over the
  Unix socket in production (no password). See §6.
- **Nothing in this repo knows about `masu.rs`, Cloudflare, or secrets
  encryption.** Those live in dotfiles. This repo's NixOS module exposes
  options; the dotfiles preset fills them in.

---

## 3. Repository layout

```
api/
├── flake.nix
├── flake.lock
├── README.md                     # what it is, how to dev, how to consume
├── LICENSE                       # MIT
├── .envrc                        # `use flake`
├── .gitignore
├── .github/workflows/ci.yml      # nix flake check + build on push/PR
├── docs/
│   ├── PLAN.md                   # this file
│   ├── CHANGELOG.md
│   ├── adrs/                     # Architecture Decision Records (see README there)
│   │   ├── README.md
│   │   └── 0001-...md
│   └── backends/
│       └── actual.md             # user-facing API docs for the actual backend
├── nix/
│   ├── lib.nix                   # helpers: mkBackendModule, port table
│   ├── modules/
│   │   ├── default.nix           # nixosModules.default; imports every backend module
│   │   ├── api.nix               # services.api.* top-level options (shared)
│   │   └── backends/
│   │       └── actual.nix        # services.api.backends.actual.*
│   ├── overlay.nix               # overlays.default: adds pkgs.api-<backend>
│   └── checks/
│       └── actual-vm.nix         # NixOS VM test (Linux only)
├── backends/
│   └── actual/                   # Node.js + TypeScript backend
│       ├── package.nix           # buildNpmPackage derivation
│       ├── package.json
│       ├── package-lock.json
│       ├── tsconfig.json
│       ├── src/
│       │   ├── main.ts           # entrypoint: load config, run migrations, start HTTP
│       │   ├── config.ts         # env parsing + validation
│       │   ├── http/
│       │   │   ├── server.ts     # framework setup, middleware order
│       │   │   ├── auth.ts       # X-API-Key check
│       │   │   ├── errors.ts     # error → JSON problem response
│       │   │   └── routes/
│       │   │       ├── health.ts
│       │   │       ├── budgets.ts
│       │   │       ├── transactions.ts
│       │   │       └── mappings.ts
│       │   ├── actual/
│       │   │   ├── client.ts     # wraps @actual-app/api with a mutex + "current budget"
│       │   │   └── types.ts
│       │   └── db/
│       │       ├── pool.ts       # pg Pool from DATABASE_URL
│       │       ├── migrate.ts    # runs migrations/*.sql in order, tracked in a table
│       │       └── migrations/
│       │           └── 0001_init.sql
│       └── test/                 # vitest unit tests (no network, no Actual server)
└── scripts/
    ├── dev-db.sh                 # start/stop a local Postgres under .dev/pg
    └── new-backend.sh            # optional: scaffold a backend directory (can skip)
```

Backends in other languages later follow the same shape:
`backends/<name>/package.nix` + `nix/modules/backends/<name>.nix` +
`docs/backends/<name>.md`.

---

## 4. Shared conventions every backend must follow

These are documented in `README.md` under "Writing a backend" and enforced
by the VM test for each backend.

### 4.1 Process contract

| Item | Rule |
|---|---|
| Listen address | `127.0.0.1` only; port from env `PORT` |
| Config | Environment variables only. No config files. Secrets come via systemd `EnvironmentFile` / `LoadCredential`. |
| Database | `DATABASE_URL` (libpq URI). Production example: `postgresql:///api_actual?host=/run/postgresql` |
| Startup | Run DB migrations, then bind the port. Exit non-zero if migrations fail. |
| Shutdown | Handle `SIGTERM`: stop accepting, finish in-flight requests, close DB pool, exit 0 within 10 s. |
| Logging | One JSON object per line to stdout. Fields: `time`, `level`, `msg`, `req_id`, plus context. Never log API keys or budget passwords. |
| State dir | `STATE_DIR` env (systemd `StateDirectory`). Actual backend uses it for the SDK `dataDir`. |

### 4.2 HTTP contract

| Endpoint | Behaviour |
|---|---|
| `GET /healthz` | No auth. `200 {"status":"ok"}` if the process is up. Used by systemd/uptime-kuma. |
| `GET /readyz` | No auth. `200` only if DB reachable and backend-specific dependency (Actual server) reachable; otherwise `503` with `{"status":"degraded","checks":{...}}`. |
| Everything else | Requires header `X-API-Key: <key>`. Compare in constant time. Missing/invalid → `401 {"error":"unauthorized"}`. |
| Errors | JSON body `{"error":"<snake_case_code>","message":"<human>","details":{...}}`. 400 validation, 404 not found, 409 conflict/idempotency, 502 upstream (Actual) failure, 500 otherwise. |
| Request IDs | Read `X-Request-Id` if present, else generate UUIDv4; echo it back in the response header and include in every log line. |
| Body | JSON only (`application/json`); reject others with 415. Max 1 MiB. |

### 4.3 API keys

- Each backend has **one or more** API keys, supplied as env `API_KEYS`
  (comma-separated). Any listed key is accepted. This allows rotation:
  add the new key, roll clients, remove the old.
- Keys are opaque random strings of ≥32 bytes, base64url. Generate with
  `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`.

### 4.4 Versioning

- Repo uses semver tags `v0.x.y`. Each backend's `package.nix` `version`
  tracks the repo tag; a `CHANGELOG.md` entry accompanies each tag.
- HTTP paths are **not** versioned (`/v1`) for now. If a breaking change is
  needed later, add a new backend path such as `/actual2`. Record this in an
  ADR when it happens.

---

## 5. Nix design

### 5.1 `flake.nix` outputs

Use `flake-utils` `eachDefaultSystem` (covers x86_64/aarch64 × linux/darwin).

```
inputs:
  nixpkgs        github:nixos/nixpkgs/nixos-unstable
  flake-utils    github:numtide/flake-utils

outputs (per system unless noted):
  packages.api-actual          backends/actual/package.nix
  packages.default             = api-actual (for now)
  devShells.default            nodejs_22, nodePackages.npm, typescript-language-server,
                               postgresql_15, pgcli or psql, nixfmt, prefetch-npm-deps,
                               shellHook that exports DATABASE_URL, PORT, STATE_DIR
                               for local dev and prints `scripts/dev-db.sh` help
  checks.<name>                nix build of each package + `nix fmt --check` +
                               `npm test` run inside a derivation;
                               checks.actual-vm only on *-linux
  formatter                    nixfmt-rfc-style
  overlays.default (system-independent)   final: prev: { api-actual = ...; }
  nixosModules.default (system-independent)  import ./nix/modules
```

Rule: the NixOS module must **not** reference `self.packages.<system>`
directly; it must use `pkgs.api-actual` and expect the consumer to apply
`overlays.default` **or** set `services.api.backends.actual.package`. Do
both: default the option to `pkgs.api-actual or (import ../.. flake).packages...`
is messy, so the plain rule is: option `package` with default
`pkgs.api-actual`, and the README tells consumers to add the overlay. The
dotfiles side does exactly this (§8).

**VERIFY:** use `postgresql_15` in the dev shell to match `flame`'s
`services.postgresql.package = pkgs.postgresql_15`. If `flame` is bumped,
bump here too.

### 5.2 `backends/actual/package.nix`

- `buildNpmPackage` with `pname = "api-actual"`, `src = ./.`,
  `npmDepsHash` (compute with `prefetch-npm-deps package-lock.json`),
  `nodejs = nodejs_22`.
- `npmBuildScript = "build"` compiles TS to `dist/`.
- `postInstall` writes `$out/bin/api-actual` = `exec node $out/lib/node_modules/api-actual/dist/main.js`.
- `meta.mainProgram = "api-actual"`.
- Migrations (`src/db/migrations/*.sql`) must be included in `files` in
  `package.json` so they land under `$out/lib/node_modules/...`; `migrate.ts`
  locates them relative to `import.meta.url`, not `process.cwd()`.

**Note on `@actual-app/api` in Nix:** the package depends on `better-sqlite3`
(native). `buildNpmPackage` will need `python3`, `pkg-config`, and
`sqlite`/`node-gyp` in `nativeBuildInputs` unless the prebuilt binary is
downloaded (network is blocked in the sandbox, so it will not be). Set
`npmFlags = [ "--build-from-source" ]` if needed. The existing dotfiles
`pkgs/actualtap/package.nix` builds the same dependency successfully with
plain `buildNpmPackage`, so **VERIFY** by copying its approach first and only
add native build inputs if the build fails.

### 5.3 NixOS module: `nix/modules/api.nix` (shared options)

```
services.api = {
  enable            bool
  hostname          str          # e.g. "api.masu.rs"; used only for docs/links,
                                 # the actual Caddy wiring is done by the consumer
  user / group      str, default "api"
  caddyRoutes       READ-ONLY (lib.mkOption with readOnly=true) list of attrs.
                    Computed from enabled backends. Each entry is a Caddy JSON
                    route object matching {host=[hostname]; path=["/<name>/*"]}
                    with handlers [rewrite strip_path_prefix, reverse_proxy].
                    Consumer appends it to nmasur.presets.services.caddy.routes.
  postgres = {
    createLocally   bool, default true
                    # when true: services.postgresql.ensureDatabases +
                    # ensureUsers with ensureDBOwnership for each enabled backend
  }
}
```

Also emit one catch-all route in `caddyRoutes`, ordered **last**, matching
`host = [hostname]` with no path, returning `404 {"error":"not_found"}` so an
unknown prefix does not fall through to another site.

### 5.4 NixOS module: `nix/modules/backends/actual.nix`

```
services.api.backends.actual = {
  enable            bool
  package           package, default pkgs.api-actual
  port              port, default 4100
  actualServerUrl   str, e.g. "http://127.0.0.1:5006"
  apiKeysFile       path   # env file containing API_KEYS=...
  serverPasswordFile path  # env file containing ACTUAL_PASSWORD=...
  budgets           attrsOf submodule {
                      syncIdFile          path  # env file containing ACTUAL_SYNC_ID_<NAME>=...
                      encryptionPasswordFile  nullOr path  # ACTUAL_ENCRYPTION_PASSWORD_<NAME>=...
                    }
  extraEnvironment  attrsOf str
}
```

Generated systemd unit `api-actual.service`:

- `after = [ "network.target" "postgresql.service" "actual.service" ]`,
  `wants` the same; `wantedBy multi-user.target`.
- `User`/`Group` = `services.api.user` (static system user, **not**
  `DynamicUser`, because Postgres peer auth needs a stable OS username equal
  to the DB role. Since the DB role is `api_actual` and the OS user is `api`,
  add a `services.postgresql.identMap` line mapping `api` → `api_actual`.
  Simpler alternative that avoids ident maps: make the OS user for each
  backend `api-<name>`? Postgres roles cannot contain `-` without quoting.
  **Decision:** OS user `api_actual`, DB role `api_actual`, database
  `api_actual`, peer auth works with no ident map. Each backend gets its own
  OS user `api_<name>`. Drop the shared `services.api.user` option.)
- `Environment`: `PORT`, `STATE_DIR=/var/lib/api-actual`, `ACTUAL_SERVER_URL`,
  `BUDGETS=<comma-separated budget names>`, `DATABASE_URL=postgresql:///api_actual?host=/run/postgresql`,
  `NODE_ENV=production`, `TZ` inherited from system.
- `EnvironmentFile` = apiKeysFile, serverPasswordFile, every budget's
  syncIdFile and encryptionPasswordFile.
- `StateDirectory = "api-actual"`, `Restart = "on-failure"`, `RestartSec = 5`.
- Hardening: `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`,
  `PrivateTmp`, `RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6`.
- Contribute to `services.api.caddyRoutes` and, when
  `services.api.postgres.createLocally`, to `services.postgresql.ensureDatabases = ["api_actual"]`
  and `ensureUsers = [{ name = "api_actual"; ensureDBOwnership = true; }]`.

**VERIFY:** `flame`'s Postgres `authentication` block currently only lists
`local all postgres peer map=root` and `local all admin peer map=admin`.
NixOS appends a default `local all all peer` rule after user-provided rules
(check `services.postgresql.authentication` default in nixpkgs), so peer auth
for `api_actual` should already work. If not, the dotfiles preset must add
`local api_actual api_actual peer`.

### 5.5 VM test `nix/checks/actual-vm.nix`

A `nixosTest` with one machine that enables `services.postgresql`,
`services.api.enable`, `services.api.backends.actual.enable` with fake secret
files, and a stub Actual server (**not** the real `services.actual`, to keep
the test fast — a `python3 -m http.server` returning 200 is enough for
`/readyz` to be *degraded*, which is acceptable). Assert:

1. `api-actual.service` reaches `active`.
2. `curl 127.0.0.1:4100/healthz` returns `{"status":"ok"}`.
3. Request without key → 401; with key → not 401.
4. `psql -U api_actual -d api_actual -c '\dt'` shows the migrations table.

---

## 6. PostgreSQL

### 6.1 Naming

| Thing | Value |
|---|---|
| Database | `api_<backend>` |
| Role (owner) | `api_<backend>` |
| Auth (prod) | peer over `/run/postgresql` |
| Auth (dev) | trust over TCP `127.0.0.1:5433` from `scripts/dev-db.sh` |
| Schema | `public` |
| Migrations table | `schema_migrations(version int primary key, applied_at timestamptz)` |

### 6.2 Migrations

- Plain SQL files `NNNN_description.sql`, applied in filename order inside a
  transaction each, recorded in `schema_migrations`. No down migrations.
- Run on every start; idempotent; the process refuses to start if a file's
  version is already applied but its content hash differs (store
  `sha256` column too).
- Keep a hand-rolled ~60-line runner in the backend rather than a migration
  library, to minimise Node dependencies that must build under Nix.

### 6.3 Local dev database (`scripts/dev-db.sh`)

Subcommands `init | start | stop | psql | reset`. Uses `initdb -D .dev/pg`,
`pg_ctl -o "-p 5433 -k $PWD/.dev"`, creates role+db `api_actual`. The dev
shell exports `DATABASE_URL=postgresql://api_actual@127.0.0.1:5433/api_actual`.
`.dev/` is git-ignored.

---

## 7. Backend: `actual`

### 7.1 Language and runtime

**TypeScript on Node.js 22.** This is forced: the Actual Budget API is only
published as the Node package `@actual-app/api`; the docs state other
languages are unsupported. HTTP framework: **Fastify** (built-in JSON schema
validation, low dependency count, first-class TypeScript). Postgres driver:
`pg`. Tests: `vitest`. No ORM.

### 7.2 Multiple budgets: the core design problem

`@actual-app/api` keeps **one budget file open per process** (global state:
`init()` → `downloadBudget(syncId)` → operations → `shutdown()`). Two designs
were considered:

1. **One OS process per budget** (what the current two `actualtap` units do).
   Simple, but needs N ports/N routes/N units, and cannot offer cross-budget
   endpoints.
2. **One process, serialised access, switch budget on demand.** Chosen.

Implementation rules for `src/actual/client.ts`:

- On startup call `init({ dataDir: $STATE_DIR/actual, serverURL, password })`
  once. Do **not** download any budget yet.
- Keep `currentBudget: string | null` and an **async mutex** (a tiny
  promise-chain lock; no library needed). Every operation acquires the mutex.
- `withBudget(name, fn)`: acquire mutex → if `currentBudget !== name`, call
  `downloadBudget(syncId, { password: encryptionPassword? })` and set
  `currentBudget` → run `fn(api)` → release. `downloadBudget` on an
  already-cached file performs a sync rather than a full download, so
  switching is cheap after the first time. **VERIFY** timing in dev; if a
  switch takes >2 s consistently, revisit with an ADR (fallback: fork one
  child process per budget and proxy over IPC).
- After each write operation, the SDK syncs automatically at the end of
  `downloadBudget`/`sync()`; call `api.sync()` explicitly after writes so the
  transaction appears on the server without waiting for the next switch.
- On `SIGTERM` call `shutdown()` after releasing the mutex.
- Budget names come from env `BUDGETS=budget1,budget2`; for each `NAME`
  (upper-cased) read `ACTUAL_SYNC_ID_<NAME>` and optional
  `ACTUAL_ENCRYPTION_PASSWORD_<NAME>`. Fail fast on startup if any is missing.

### 7.3 Database schema (`0001_init.sql`)

```
budgets_seen        (name text pk, sync_id text, first_seen timestamptz, last_used timestamptz)
card_mappings       (id serial pk, budget text not null, card_name text not null,
                     account_name text not null, unique(budget, card_name))
transaction_log     (id bigserial pk, budget text not null, idempotency_key text,
                     received_at timestamptz default now(), request jsonb not null,
                     actual_transaction_id text, status text check in ('created','duplicate','failed'),
                     error text, unique(budget, idempotency_key))
```

`transaction_log` is the audit trail and the idempotency store. `card_mappings`
replaces the dictionary that actualtap makes users maintain inside the iOS
Shortcut, so a card→account change no longer requires editing the phone
automation.

### 7.4 HTTP API (after Caddy strips `/actual`)

All except health require `X-API-Key`. Public URLs are
`https://api.masu.rs/actual/...`.

| Method & path | Purpose |
|---|---|
| `GET /healthz`, `GET /readyz` | §4.2. `readyz` checks DB + `GET <ACTUAL_SERVER_URL>/` reachable. |
| `GET /budgets` | List configured budget names (never sync IDs). |
| `GET /budgets/:budget/accounts` | Proxy `getAccounts()`; returns `[{id,name,offbudget,closed}]`. |
| `GET /budgets/:budget/payees` | Proxy `getPayees()`. |
| `GET /budgets/:budget/categories` | Proxy `getCategories()`. |
| `POST /budgets/:budget/transactions` | **The tap-to-pay endpoint.** See body below. |
| `GET /budgets/:budget/transactions?account=&since=&until=` | Proxy `getTransactions(accountId, start, end)`; resolve account name → id. |
| `GET /budgets/:budget/log?limit=50` | Recent rows of `transaction_log` for that budget. |
| `GET /budgets/:budget/mappings` | List `card_mappings`. |
| `PUT /budgets/:budget/mappings/:card` | Upsert `{account}`. |
| `DELETE /budgets/:budget/mappings/:card` | Remove. |
| `POST /budgets/:budget/sync` | Force `downloadBudget` + `sync`. Returns timing. |

`POST /budgets/:budget/transactions` body (JSON schema in code):

```
{
  "amount":   12.34,          // required, decimal in currency units, positive = money spent
  "type":     "payment" | "deposit",   // default "payment"
  "account":  "Checking",     // account name; optional if "card" resolves
  "card":     "Apple Card",   // optional; looked up in card_mappings
  "payee":    "Coffee Shop",  // optional; payee_name
  "date":     "2026-09-11",   // optional; default today in TZ
  "notes":    "…",            // optional
  "category": "Eating Out",   // optional; category name → id, 400 if unknown
  "cleared":  false,          // optional
  "idempotency_key": "…"      // optional; also read from header Idempotency-Key
}
```

Processing steps, in order:

1. Validate schema. Resolve account: explicit `account` wins; else `card` via
   `card_mappings`; else env `DEFAULT_ACCOUNT_<NAME>` if set; else 400
   `account_unresolved`.
2. Compute Actual amount: `utils.amountToInteger(amount)` then negate for
   `payment` (Actual stores outflows as negative integers in cents).
3. If `idempotency_key` present and a `transaction_log` row exists with
   status `created` → return `200` with the original response and
   `"duplicate": true`. If none provided, derive one as
   `sha256(budget|account|date|amount|payee)` truncated, so the same tap
   received twice within the same day is still de-duplicated. Document that
   two genuinely identical purchases on one day need an explicit key.
4. Insert `transaction_log` row with status `failed` placeholder inside the
   same request; `withBudget(...)`: resolve account/category ids by name
   (case-insensitive), call `addTransactions(accountId, [tx], {learnCategories:true, runTransfers:true})`, `sync()`.
5. Update the log row to `created` with the returned id; respond `201`
   `{ "id": "...", "budget": "...", "account": "...", "amount": -1234, "date": "..." }`.
   On failure update to `failed` with error text and respond 502 with
   `upstream_error`.

### 7.5 Configuration (env)

| Var | Required | Notes |
|---|---|---|
| `PORT` | yes | 4100 in prod |
| `STATE_DIR` | yes | SDK `dataDir` = `$STATE_DIR/actual` |
| `DATABASE_URL` | yes | |
| `API_KEYS` | yes | comma-separated |
| `ACTUAL_SERVER_URL` | yes | `http://127.0.0.1:5006` |
| `ACTUAL_PASSWORD` | yes | server password |
| `BUDGETS` | yes | comma-separated names, `[a-z0-9_]+` |
| `ACTUAL_SYNC_ID_<NAME>` | yes per budget | |
| `ACTUAL_ENCRYPTION_PASSWORD_<NAME>` | no | |
| `DEFAULT_ACCOUNT_<NAME>` | no | fallback account name |
| `LOG_LEVEL` | no | default `info` |
| `TZ` | no | affects default `date` |

**Important:** `flame`'s Actual server uses OIDC login (`loginMethod =
"openid"`). **VERIFY** that `@actual-app/api` `init({password})` still works
against an OIDC-configured server; Actual supports a server password
alongside OIDC for API/bootstrap use, and the existing `actualtap` units use
`actualbudget-password` for this, which shows it works today. Reuse that
secret.

### 7.6 Tests

- Unit: amount conversion/sign, idempotency key derivation, account/card
  resolution order, API key constant-time compare, migration runner against a
  real local Postgres (use `DATABASE_URL` if set, else skip).
- Mock `@actual-app/api` via a module-level injectable interface
  (`ActualApi` type in `actual/types.ts`) so route tests do not need a server.
- VM test in §5.5.

---

## 8. Dotfiles integration (changes in `../dotfiles`)

Do these **after** the repo is pushed and tagged.

1. `flake.nix` inputs: add
   `api = { url = "github:nmasur/api"; inputs.nixpkgs.follows = "nixpkgs"; };`.
2. `flake.nix` hostnames: add `api = "api.${baseName}";`.
3. `lib/default.nix` `overlays`: add `inputs.api.overlays.default`.
4. `lib/default.nix` `buildNixos` modules: add `inputs.api.nixosModules.default`
   (same list style as `inputs.disko.nixosModules.disko`).
5. New preset `platforms/nixos/modules/nmasur/presets/services/api/api.nix`
   with `options.nmasur.presets.services.api.enable` that, when enabled:
   - `services.api.enable = true; services.api.hostname = hostnames.api;`
   - `services.api.backends.actual = { enable = true; actualServerUrl = "http://127.0.0.1:${toString config.nmasur.presets.services.actualbudget.port}"; ... }`
   - Declares `secrets.api-actual-keys`, `secrets.api-actual-budget1-sync-id`,
     `secrets.api-actual-budget2-sync-id` with `prefix = "API_KEYS="` /
     `"ACTUAL_SYNC_ID_BUDGET1="` etc., owner `api_actual`, and points the
     module's `*File` options at their `dest`. Reuse
     `config.secrets.actualbudget-password.dest` for `serverPasswordFile`
     (it already has the `ACTUAL_PASSWORD=` prefix — **VERIFY** by reading
     the existing `.age` handling; the current `actualtap` unit consumes it
     as an `EnvironmentFile`, so the prefix is present).
     Re-encrypt the two existing budget IDs (`actualtap/budget1-id.age`,
     `budget2-id.age`) under the new names if their env var names differ,
     using `nix run github:nmasur/dotfiles#encrypt-secret`.
   - Orders `systemd.services.api-actual` `after`/`requires` the
     `*-secret.service` units, same pattern as `actual.service`.
   - `nmasur.presets.services.caddy.routes = config.services.api.caddyRoutes;`
   - `services.cloudflare-dyndns.domains = [ hostnames.api ];`
   - `services.restic.backups.default.paths = [ "/var/lib/api-actual" ];`
     (optional: the SDK cache is re-downloadable; the DB is backed up via the
     existing Postgres backup, **VERIFY** one exists — `litestream` is for
     SQLite, so check for a `pg_dump` job; if none, add `services.postgresqlBackup.databases = ["api_actual"]`).
6. `profiles/communications.nix`: `api.enable = lib.mkDefault true;` and set
   `actualtap.enable = lib.mkDefault false;`. Remove the `actualtap` preset,
   package, and `.age` files in a later change once the new endpoint is
   confirmed working from the phone.
7. Update the iOS Shortcut: URL `https://api.masu.rs/actual/budgets/budget1/transactions`,
   header `X-API-Key`, body per §7.4, and optionally drop the card dictionary
   in favour of sending `card`.
8. Add a `docs/CHANGELOG.md` entry in dotfiles and an ADR if that repo has
   `docs/adrs/` (it currently does not).

Caddy notes: the dotfiles Caddy preset 403s any source IP not in
`cidrAllowlist`; traffic through the Cloudflare tunnel arrives from
`127.0.0.1`, so `api.masu.rs` must be exposed via **cloudflared** the same
way the other hosts are. **VERIFY** how `hostnames.budget` is published
(tunnel ingress vs. dyndns) and copy that exactly.

---

## 9. Step-by-step implementation order

Each step ends with a `jj describe` and a `docs/CHANGELOG.md` entry. Do not
start a step until the previous one's acceptance check passes.

| # | Step | Acceptance check |
|---|---|---|
| 1 | Scaffold: `flake.nix` (devShell only), `.envrc`, `.gitignore`, `README.md`, `LICENSE`, `docs/adrs/README.md`, `scripts/dev-db.sh` | `nix develop -c node --version` prints 22.x; `scripts/dev-db.sh start && psql $DATABASE_URL -c 'select 1'` |
| 2 | `backends/actual` skeleton: `package.json`, `tsconfig.json`, Fastify server with `/healthz`, `/readyz` (DB only), auth middleware, JSON logging, request IDs, error handler | `npm run dev` then `curl -i :4100/healthz` → 200; no key → 401 |
| 3 | Migration runner + `0001_init.sql` | tables exist after start; second start is a no-op; tampering a file fails start |
| 4 | `actual/client.ts` with `init`, mutex, `withBudget`; `GET /budgets`, `/accounts`, `/payees`, `/categories` | against a local `nix run nixpkgs#actual-server` with a test budget, list endpoints return data; switching budgets logs timing |
| 5 | `POST /budgets/:budget/transactions` with idempotency + log; mappings CRUD; `/log`; `/sync` | transaction appears in Actual UI; repeated POST returns duplicate; unit tests pass |
| 6 | `backends/actual/package.nix`, `overlay.nix`, `packages`, `checks` | `nix build .#api-actual && result/bin/api-actual` starts with env set |
| 7 | NixOS modules (`api.nix`, `backends/actual.nix`) + VM test | `nix flake check` passes on `aarch64-linux` (use `nix build .#checks.aarch64-linux.actual-vm` on a Linux builder or the `flame` host itself) |
| 8 | `docs/backends/actual.md`, README "Writing a backend", CI workflow | CI green on push |
| 9 | Tag `v0.1.0`, push | `nix flake show github:nmasur/api` lists outputs |
| 10 | Dotfiles integration (§8), deploy to `flame`, phone shortcut updated | `curl -H "X-API-Key: …" https://api.masu.rs/actual/budgets` returns names; tap-to-pay creates a transaction |
| 11 | Remove `actualtap` preset/package/secrets from dotfiles | `flame` rebuild succeeds, no `actualtap-*` units |

---

## 10. Decisions recorded as ADRs

Create these in `docs/adrs/` during step 1 (they are short):

- `0001-caddy-is-the-router.md` — no in-repo gateway; path-prefix per backend; Caddy strips prefix.
- `0002-one-process-one-database-per-backend.md` — `api_<name>` OS user/role/db, peer auth, no shared schema.
- `0003-actual-backend-in-typescript.md` — forced by SDK availability.
- `0004-single-process-multi-budget-with-mutex.md` — chosen over process-per-budget; records the fallback.
- `0005-api-key-auth-only.md` — no OIDC for machine clients; multiple keys for rotation.
- `0006-hand-rolled-sql-migrations.md` — fewer native deps in Nix builds.

---

## 11. Open questions for the repo owner

Not blockers for steps 1–8; decide before step 10.

1. Should `api.masu.rs` be reachable only through the Cloudflare tunnel (like
   other services) or also via LAN? Affects `cidrAllowlist`.
2. Should the two budget names be `budget1`/`budget2` (matching existing
   secret names) or human names? Names appear in URLs and the phone shortcut.
3. Whether to keep `DEFAULT_ACCOUNT_<NAME>` as env or move it into
   `card_mappings` with a reserved card name `*`. Plan assumes env for v0.1.
