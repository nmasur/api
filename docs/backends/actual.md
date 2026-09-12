# Actual Budget Backend (`/actual`)

The `actual` backend provides an HTTP REST API for integrating external services and mobile automations (such as iOS Shortcuts and tap-to-pay) with [Actual Budget](https://actualbudget.org/).

It replaces legacy `actualtap` instances with a single unified service supporting:
- **Multiple budgets** from a single process with synchronization and caching
- **PostgreSQL audit logging** with duplicate detection and idempotency
- **Dynamic card-to-account mappings** editable via API without updating client automations
- **Strict authentication** via rotating API keys

---

## Base URL and Routing

In production, all endpoints are fronted by Caddy at:

```
https://api.masu.rs/actual/...
```

Caddy strips the `/actual` prefix before forwarding requests to the backend listening on `127.0.0.1:4100`.

---

## Authentication

All endpoints (except `/healthz` and `/readyz`) require an API key passed in the `X-API-Key` header:

```http
X-API-Key: <your-api-key>
```

Requests with missing or invalid keys return `401 Unauthorized`:

```json
{
  "error": "unauthorized",
  "message": "Missing or invalid API key"
}
```

---

## Endpoints

### 1. Health and Readiness

#### `GET /healthz`
Process liveness check. Does not require authentication.

**Response:** `200 OK`
```json
{
  "status": "ok"
}
```

#### `GET /readyz`
Dependency readiness check (verifies PostgreSQL database and upstream Actual server reachability). Does not require authentication.

**Response:** `200 OK` (or `503 Service Unavailable` if degraded)
```json
{
  "status": "ok",
  "checks": {
    "db": true,
    "actual_server": true
  }
}
```

---

### 2. Budgets & Metadata

#### `GET /budgets`
List configured budget names (never exposes internal sync IDs).

**Response:** `200 OK`
```json
{
  "budgets": ["personal", "business"]
}
```

#### `GET /budgets/:budget/accounts`
List accounts in the specified budget.

**Response:** `200 OK`
```json
[
  {
    "id": "acc-checking-uuid",
    "name": "Checking",
    "offbudget": false,
    "closed": false
  },
  {
    "id": "acc-credit-uuid",
    "name": "Apple Card",
    "offbudget": false,
    "closed": false
  }
]
```

#### `GET /budgets/:budget/payees`
List payees in the specified budget.

**Response:** `200 OK`
```json
[
  { "id": "payee-1", "name": "Coffee Shop" },
  { "id": "payee-2", "name": "Supermarket" }
]
```

#### `GET /budgets/:budget/categories`
List category groups and categories in the specified budget.

**Response:** `200 OK`
```json
[
  { "id": "cat-1", "name": "Dining Out", "is_income": false },
  { "id": "cat-2", "name": "Groceries", "is_income": false }
]
```

#### `POST /budgets/:budget/sync`
Force an immediate budget download and synchronization with the upstream Actual server.

**Response:** `200 OK`
```json
{
  "budget": "personal",
  "status": "synced",
  "duration_ms": 142
}
```

---

### 3. Transactions (Tap-to-Pay)

#### `POST /budgets/:budget/transactions`
Create a new transaction in the specified budget.

**Headers:**
- `Content-Type: application/json`
- `X-API-Key: <key>`
- `Idempotency-Key: <key>` *(optional)*

**Request Body:**
```json
{
  "amount": 12.34,
  "type": "payment",
  "account": "Checking",
  "card": "Apple Card",
  "payee": "Blue Bottle Coffee",
  "category": "Dining Out",
  "date": "2026-09-12",
  "notes": "Morning coffee",
  "cleared": true,
  "idempotency_key": "unique-client-key-123"
}
```

#### Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `amount` | number | **Yes** | Decimal transaction amount (e.g. `12.34`). Always positive. |
| `type` | string | No | `"payment"` (outflow/expense, default) or `"deposit"` (inflow/income). |
| `account` | string | No | Target account name in Actual. Highest priority in account resolution. |
| `card` | string | No | Card name to look up in `card_mappings` if `account` is omitted. |
| `payee` | string | No | Name of the payee. Automatically created in Actual if new. |
| `category` | string | No | Target category name in Actual. Case-insensitive. |
| `date` | string | No | `YYYY-MM-DD`. Defaults to current date in configured `TZ`. |
| `notes` | string | No | Notes/memo for the transaction. |
| `cleared` | boolean | No | Whether the transaction is marked as cleared (default `false`). |
| `idempotency_key` | string | No | Explicit client idempotency key. Can also be sent via `Idempotency-Key` header. |

#### Account Resolution Order
1. Explicit `account` field if provided.
2. `card` field looked up against database `card_mappings` for the budget.
3. Fallback to `DEFAULT_ACCOUNT_<NAME>` environment variable if configured.
4. If unresolved, returns `400 Bad Request` with `{"error":"account_unresolved"}`.

#### Idempotency and De-duplication
- If an `idempotency_key` is provided (or derived from `sha256(budget|account|date|amount|payee)`), repeated requests with the same key return the original response with `200 OK` and `"duplicate": true`.
- No duplicate transactions are created in Actual Budget.

**Response (Created):** `201 Created`
```json
{
  "id": "tx-actual-uuid-1234",
  "budget": "personal",
  "account": "Checking",
  "amount": -1234,
  "date": "2026-09-12",
  "payee": "Blue Bottle Coffee",
  "category": "Dining Out",
  "duplicate": false
}
```

**Response (Duplicate):** `200 OK`
```json
{
  "id": "tx-actual-uuid-1234",
  "budget": "personal",
  "account": "Checking",
  "amount": -1234,
  "date": "2026-09-12",
  "payee": "Blue Bottle Coffee",
  "category": "Dining Out",
  "duplicate": true
}
```

#### `GET /budgets/:budget/transactions`
Query transactions from Actual Budget.

**Query Parameters:**
- `account`: Filter by account name
- `since`: Start date (`YYYY-MM-DD`)
- `until`: End date (`YYYY-MM-DD`)

**Response:** `200 OK`
```json
{
  "transactions": [ ... ]
}
```

#### `GET /budgets/:budget/log`
Query recent requests and idempotency status from the PostgreSQL audit log.

**Query Parameters:**
- `limit`: Number of records to return (default 50, max 100)

**Response:** `200 OK`
```json
{
  "log": [
    {
      "id": 1,
      "budget": "personal",
      "idempotency_key": "c3ab8ff13720e8ad9047dd39466b3c89",
      "received_at": "2026-09-12T12:00:00.000Z",
      "request": { "amount": 12.34, "card": "Apple Card" },
      "actual_transaction_id": "tx-actual-uuid-1234",
      "status": "created",
      "error": null,
      "response": { ... }
    }
  ]
}
```

---

### 4. Card Mappings

Card mappings allow Apple Pay / Google Wallet card names to map to Actual accounts dynamically.

#### `GET /budgets/:budget/mappings`
List all card mappings for the budget.

**Response:** `200 OK`
```json
{
  "mappings": [
    {
      "id": 1,
      "budget": "personal",
      "card_name": "Apple Card",
      "account_name": "Checking"
    }
  ]
}
```

#### `PUT /budgets/:budget/mappings/:card`
Create or update a card mapping.

**Request Body:**
```json
{
  "account": "Amex Blue Cash"
}
```

**Response:** `200 OK`
```json
{
  "id": 2,
  "budget": "personal",
  "card_name": "Apple Card",
  "account_name": "Amex Blue Cash"
}
```

#### `DELETE /budgets/:budget/mappings/:card`
Delete an existing card mapping.

**Response:** `200 OK`
```json
{
  "deleted": true
}
```

---

## iOS Shortcut Setup

To trigger a transaction automatically on tap-to-pay in iOS:

1. Open the **Shortcuts** app and create an **Automation** triggered on **Transaction** (Apple Pay).
2. Select your Card (e.g. `Apple Card`).
3. Add a **Get Contents of URL** action:
   - **URL:** `https://api.masu.rs/actual/budgets/personal/transactions`
   - **Method:** `POST`
   - **Headers:**
     - `Content-Type`: `application/json`
     - `X-API-Key`: `your-api-key`
   - **Request Body:** `JSON`
     - `amount` (Number): Shortcut Transaction Amount
     - `card` (Text): `Apple Card` (or pass Shortcut Card Name)
     - `payee` (Text): Shortcut Merchant Name
     - `date` (Text): Shortcut Date formatted as `yyyy-MM-dd`
