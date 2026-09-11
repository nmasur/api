# 0005: API key authentication only

- Status: accepted
- Date: 2026-09-11

## Context

The service is accessed predominantly by automated clients, iOS Shortcuts (e.g. tap-to-pay), and scheduled tasks (e.g. n8n). These clients cannot complete interactive browser-based OpenID Connect (OIDC) flows.

## Decision

Authentication is performed strictly via static API keys passed in the `X-API-Key` HTTP header.
- Multiple active keys are supported via a comma-separated `API_KEYS` environment variable to allow key rotation.
- Key comparison is done in constant time to prevent timing attacks.
- Only `/healthz` and `/readyz` endpoints are exempt from authentication.

## Consequences

- Simple and robust for headless and mobile automation.
- Zero external auth dependencies.
- Zero cookie or session state.
