-- Initial schema for api-actual

CREATE TABLE IF NOT EXISTS budgets_seen (
  name text PRIMARY KEY,
  sync_id text,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_used timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS card_mappings (
  id serial PRIMARY KEY,
  budget text NOT NULL,
  card_name text NOT NULL,
  account_name text NOT NULL,
  UNIQUE (budget, card_name)
);

CREATE TABLE IF NOT EXISTS transaction_log (
  id bigserial PRIMARY KEY,
  budget text NOT NULL,
  idempotency_key text,
  received_at timestamptz NOT NULL DEFAULT now(),
  request jsonb NOT NULL,
  actual_transaction_id text,
  status text NOT NULL CHECK (status IN ('created', 'duplicate', 'failed')),
  error text,
  response jsonb,
  UNIQUE (budget, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_card_mappings_budget ON card_mappings (budget);
CREATE INDEX IF NOT EXISTS idx_transaction_log_budget_received ON transaction_log (budget, received_at DESC);
