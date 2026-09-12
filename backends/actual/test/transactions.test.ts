import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { ActualClient } from '../src/actual/client.js';
import type { ActualAccount, ActualApi, ActualCategory } from '../src/actual/types.js';
import type { Config } from '../src/config.js';
import { runMigrations } from '../src/db/migrate.js';
import { checkDb } from '../src/db/pool.js';
import { buildServer } from '../src/http/server.js';
import { deriveIdempotencyKey } from '../src/http/routes/transactions.js';

const dbUrl = process.env.DATABASE_URL || 'postgresql://api_actual@127.0.0.1:5433/api_actual';

describe('Transactions, Mappings, and Idempotency', () => {
  let pool: pg.Pool | null = null;
  let isDbAvailable = false;

  const mockAccounts: ActualAccount[] = [
    { id: 'acc-checking', name: 'Checking' },
    { id: 'acc-credit', name: 'Credit Card' },
  ];

  const mockCategories: ActualCategory[] = [
    { id: 'cat-groceries', name: 'Groceries' },
    { id: 'cat-dining', name: 'Dining Out' },
  ];

  let addedTxs: Array<{ accountId: string; txs: any[] }> = [];

  const createMockApi = (failAdd = false): ActualApi => ({
    init: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    downloadBudget: vi.fn().mockResolvedValue(undefined),
    sync: vi.fn().mockResolvedValue(undefined),
    getAccounts: vi.fn().mockResolvedValue(mockAccounts),
    getPayees: vi.fn().mockResolvedValue([]),
    getCategories: vi.fn().mockResolvedValue(mockCategories),
    getTransactions: vi.fn().mockResolvedValue([
      { id: 'tx-existing-1', account: 'acc-checking', date: '2026-09-10', amount: -500 },
    ]),
    addTransactions: vi.fn().mockImplementation((accountId, txs) => {
      if (failAdd) {
        throw new Error('Actual upstream service error');
      }
      addedTxs.push({ accountId, txs });
      return Promise.resolve(['tx-' + Date.now()]);
    }),
    utils: {
      amountToInteger: (val: number) => Math.round(val * 100),
      integerToAmount: (val: number) => val / 100,
    },
  });

  const testConfig: Config = {
    port: 4100,
    host: '127.0.0.1',
    databaseUrl: dbUrl,
    stateDir: '.dev/test-state',
    apiKeys: ['test-secret-key-12345678901234567890'],
    logLevel: 'silent',
    budgets: new Map([
      [
        'personal',
        {
          name: 'personal',
          syncId: 'sync-personal-123',
          defaultAccount: 'Checking',
        },
      ],
    ]),
  };

  const validKey = testConfig.apiKeys[0];

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: dbUrl });
    isDbAvailable = await checkDb(pool);
    if (isDbAvailable) {
      await runMigrations(pool);
      // Clean test data
      await pool.query('DELETE FROM transaction_log WHERE budget = $1', ['personal']);
      await pool.query('DELETE FROM card_mappings WHERE budget = $1', ['personal']);
    }
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  it('derives consistent idempotency keys', () => {
    const key1 = deriveIdempotencyKey('personal', 'Checking', '2026-09-11', 12.34, 'Coffee');
    const key2 = deriveIdempotencyKey('personal', 'Checking', '2026-09-11', 12.34, 'Coffee');
    const key3 = deriveIdempotencyKey('personal', 'Checking', '2026-09-11', 12.34, 'Other');

    expect(key1).toBe(key2);
    expect(key1).not.toBe(key3);
    expect(key1.length).toBe(32);
  });

  it('manages card mappings CRUD', async () => {
    if (!isDbAvailable || !pool) return;

    const mockApi = createMockApi();
    const client = new ActualClient({
      stateDir: testConfig.stateDir,
      budgets: testConfig.budgets,
      pool,
      api: mockApi,
    });

    const server = buildServer({
      config: testConfig,
      actualClient: client,
      pool,
      logger: false,
    });

    // 1. PUT card mapping
    const putRes = await server.inject({
      method: 'PUT',
      url: '/budgets/personal/mappings/Apple%20Card',
      headers: { 'x-api-key': validKey },
      payload: { account: 'Credit Card' },
    });
    expect(putRes.statusCode).toBe(200);
    const putBody = putRes.json();
    expect(putBody.card_name).toBe('Apple Card');
    expect(putBody.account_name).toBe('Credit Card');

    // 2. GET card mappings
    const getRes = await server.inject({
      method: 'GET',
      url: '/budgets/personal/mappings',
      headers: { 'x-api-key': validKey },
    });
    expect(getRes.statusCode).toBe(200);
    const getBody = getRes.json();
    expect(getBody.mappings).toHaveLength(1);
    expect(getBody.mappings[0].card_name).toBe('Apple Card');

    // 3. DELETE card mapping
    const delRes = await server.inject({
      method: 'DELETE',
      url: '/budgets/personal/mappings/Apple%20Card',
      headers: { 'x-api-key': validKey },
    });
    expect(delRes.statusCode).toBe(200);
    expect(delRes.json()).toEqual({ deleted: true });

    // Verify deleted
    const verifyGet = await server.inject({
      method: 'GET',
      url: '/budgets/personal/mappings',
      headers: { 'x-api-key': validKey },
    });
    expect(verifyGet.json().mappings).toHaveLength(0);
  });

  it('creates transaction via POST /budgets/:budget/transactions and de-duplicates', async () => {
    if (!isDbAvailable || !pool) return;
    addedTxs = [];

    const mockApi = createMockApi();
    const client = new ActualClient({
      stateDir: testConfig.stateDir,
      budgets: testConfig.budgets,
      pool,
      api: mockApi,
    });

    const server = buildServer({
      config: testConfig,
      actualClient: client,
      pool,
      logger: false,
    });

    // Set up a card mapping
    await server.inject({
      method: 'PUT',
      url: '/budgets/personal/mappings/Visa',
      headers: { 'x-api-key': validKey },
      payload: { account: 'Credit Card' },
    });

    const payload = {
      amount: 14.99,
      type: 'payment',
      card: 'Visa',
      payee: 'Coffee Shop',
      category: 'Dining Out',
      date: '2026-09-12',
    };

    // 1. First POST: creates transaction
    const res1 = await server.inject({
      method: 'POST',
      url: '/budgets/personal/transactions',
      headers: { 'x-api-key': validKey },
      payload,
    });

    expect(res1.statusCode).toBe(201);
    const body1 = res1.json();
    expect(body1.id).toBeDefined();
    expect(body1.account).toBe('Credit Card');
    expect(body1.amount).toBe(-1499); // payment converted to negative cents
    expect(body1.duplicate).toBe(false);
    expect(addedTxs).toHaveLength(1);
    expect(addedTxs[0].accountId).toBe('acc-credit');
    expect(addedTxs[0].txs[0].amount).toBe(-1499);
    expect(addedTxs[0].txs[0].category).toBe('cat-dining');

    // 2. Second POST with identical payload: returns duplicate (idempotent 200)
    const res2 = await server.inject({
      method: 'POST',
      url: '/budgets/personal/transactions',
      headers: { 'x-api-key': validKey },
      payload,
    });

    expect(res2.statusCode).toBe(200);
    const body2 = res2.json();
    expect(body2.id).toBe(body1.id);
    expect(body2.duplicate).toBe(true);
    // Crucially: no new transaction sent to Actual
    expect(addedTxs).toHaveLength(1);

    // 3. Verify audit log endpoint GET /budgets/:budget/log
    const logRes = await server.inject({
      method: 'GET',
      url: '/budgets/personal/log',
      headers: { 'x-api-key': validKey },
    });

    expect(logRes.statusCode).toBe(200);
    const logBody = logRes.json();
    expect(logBody.log.length).toBeGreaterThanOrEqual(1);
    expect(logBody.log[0].status).toBe('created');
    expect(logBody.log[0].actual_transaction_id).toBe(body1.id);
  });

  it('handles deposit type and default account fallback', async () => {
    if (!isDbAvailable || !pool) return;
    addedTxs = [];

    const mockApi = createMockApi();
    const client = new ActualClient({
      stateDir: testConfig.stateDir,
      budgets: testConfig.budgets,
      pool,
      api: mockApi,
    });

    const server = buildServer({
      config: testConfig,
      actualClient: client,
      pool,
      logger: false,
    });

    // Post without account or card -> should fall back to defaultAccount 'Checking'
    const res = await server.inject({
      method: 'POST',
      url: '/budgets/personal/transactions',
      headers: { 'x-api-key': validKey },
      payload: {
        amount: 100.5,
        type: 'deposit',
        payee: 'Employer',
        idempotency_key: 'custom-salary-key-1',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.account).toBe('Checking');
    expect(body.amount).toBe(10050); // deposit is positive cents
    expect(addedTxs[0].accountId).toBe('acc-checking');
  });

  it('records failed status and returns 502 when Actual API fails', async () => {
    if (!isDbAvailable || !pool) return;

    const failingApi = createMockApi(true);
    const client = new ActualClient({
      stateDir: testConfig.stateDir,
      budgets: testConfig.budgets,
      pool,
      api: failingApi,
    });

    const server = buildServer({
      config: testConfig,
      actualClient: client,
      pool,
      logger: false,
    });

    const res = await server.inject({
      method: 'POST',
      url: '/budgets/personal/transactions',
      headers: { 'x-api-key': validKey },
      payload: {
        amount: 25.0,
        idempotency_key: 'will-fail-tx-1',
      },
    });

    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe('upstream_error');

    // Verify row in transaction_log is 'failed'
    const dbCheck = await pool.query<{ status: string; error: string }>(
      `SELECT status, error FROM transaction_log WHERE idempotency_key = 'will-fail-tx-1'`
    );
    expect(dbCheck.rows).toHaveLength(1);
    expect(dbCheck.rows[0].status).toBe('failed');
    expect(dbCheck.rows[0].error).toContain('Actual upstream service error');
  });

  it('GET /budgets/:budget/transactions proxies transactions list', async () => {
    if (!isDbAvailable || !pool) return;

    const mockApi = createMockApi();
    const client = new ActualClient({
      stateDir: testConfig.stateDir,
      budgets: testConfig.budgets,
      pool,
      api: mockApi,
    });

    const server = buildServer({
      config: testConfig,
      actualClient: client,
      pool,
      logger: false,
    });

    const res = await server.inject({
      method: 'GET',
      url: '/budgets/personal/transactions?account=Checking&since=2026-09-01',
      headers: { 'x-api-key': validKey },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.transactions).toHaveLength(1);
    expect(body.transactions[0].id).toBe('tx-existing-1');
  });
});
