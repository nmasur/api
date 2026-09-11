# Changelog

## 2026-09-11: Initial implementation plan

- Added `docs/PLAN.md`: full specification for a generic multi-backend REST
  API served by Caddy on `flame`, with an Actual Budget backend
  (TypeScript, `@actual-app/api`, multi-budget via mutex), Postgres per
  backend, Nix-only dev/build/deploy, flake outputs, and the dotfiles
  integration steps that replace the existing `actualtap` instances.
- Added `docs/adrs/README.md` with the ADR template and the initial ADR list.
