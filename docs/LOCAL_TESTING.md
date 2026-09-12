# Local Development & Testing Guide

This guide describes how to run the API service locally and interact with it using `curl` or a web browser.

---

## 1. Start the service

From the repository root:

```bash
# 1. Enter the Nix dev shell (or use direnv allow)
nix develop

# 2. (Optional) Start the local PostgreSQL instance for readiness checks
./scripts/dev-db.sh start

# 3. Start the API server in dev mode with a key of your choice
cd backends/actual
export API_KEYS="mysecretkey"
npm run dev
```

The server will listen on `http://127.0.0.1:4100`.

> **Note:** If `API_KEYS` is not set in development mode, the server will automatically generate a temporary key and print it in the console logs on startup.

---

## 2. Testing with `curl`

### Unauthenticated endpoints

```bash
# Health check (returns 200 {"status":"ok"})
curl -i http://127.0.0.1:4100/healthz

# Readiness check (verifies database connectivity)
curl -i http://127.0.0.1:4100/readyz
```

### Authenticated endpoints (`X-API-Key` header)

```bash
# Basic call-and-response (ping/pong)
curl -i -H "X-API-Key: mysecretkey" http://127.0.0.1:4100/ping

# Echo JSON payload
curl -i -H "X-API-Key: mysecretkey" \
     -H "Content-Type: application/json" \
     -d '{"message": "hello from curl", "number": 42}' \
     http://127.0.0.1:4100/echo
```

### Testing error handling

```bash
# 401 Unauthorized (missing key)
curl -i http://127.0.0.1:4100/ping

# 401 Unauthorized (wrong key)
curl -i -H "X-API-Key: wrongkey" http://127.0.0.1:4100/ping

# 415 Unsupported Media Type (non-JSON payload)
curl -i -H "X-API-Key: mysecretkey" \
     -H "Content-Type: text/plain" \
     -d 'hello' \
     http://127.0.0.1:4100/echo
```

---

## 3. Testing in a Web Browser

1. **Directly in the address bar:**
   - Open `http://127.0.0.1:4100/healthz` or `http://127.0.0.1:4100/readyz` to inspect the JSON response.
   - Visiting `http://127.0.0.1:4100/ping` will return a `401 Unauthorized` JSON response because browsers do not send custom headers on direct navigation.

2. **From the DevTools Console:**
   Open the DevTools Console (press `F12` or `Cmd + Option + I`) on `http://127.0.0.1:4100/healthz` and run:

   ```javascript
   // Ping
   await fetch('/ping', {
     headers: { 'X-API-Key': 'mysecretkey' }
   }).then(res => res.json());

   // Echo
   await fetch('/echo', {
     method: 'POST',
     headers: {
       'X-API-Key': 'mysecretkey',
       'Content-Type': 'application/json'
     },
     body: JSON.stringify({ message: 'hello from browser console' })
   }).then(res => res.json());
   ```

---

## 4. Teardown

- Press `Ctrl + C` in the server terminal to stop the server (it will perform a graceful shutdown).
- Stop the local PostgreSQL instance:
  ```bash
  ./scripts/dev-db.sh stop
  ```
