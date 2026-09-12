import { describe, expect, it, vi } from 'vitest';
import { ActualClient } from '../src/actual/client.js';
import type { ActualApi, ActualAccount, ActualCategory, ActualPayee } from '../src/actual/types.js';
import type { Config } from '../src/config.js';
import { buildServer } from '../src/http/server.js';

describe('Budgets and Actual API Client', () => {
  const mockAccounts: ActualAccount[] = [
    { id: 'acc-1', name: 'Checking', offbudget: false, closed: false },
    { id: 'acc-2', name: 'Savings', offbudget: false, closed: false },
  ];

  const mockPayees: ActualPayee[] = [
    { id: 'payee-1', name: 'Supermarket' },
    { id: 'payee-2', name: 'Coffee Shop' },
  ];

  const mockCategories: ActualCategory[] = [
    { id: 'cat-1', name: 'Groceries' },
    { id: 'cat-2', name: 'Dining Out' },
  ];

  const createMockApi = (): ActualApi => {
    return {
      init: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
      downloadBudget: vi.fn().mockResolvedValue(undefined),
      sync: vi.fn().mockResolvedValue(undefined),
      getAccounts: vi.fn().mockResolvedValue(mockAccounts),
      getPayees: vi.fn().mockResolvedValue(mockPayees),
      getCategories: vi.fn().mockResolvedValue(mockCategories),
      getTransactions: vi.fn().mockResolvedValue([]),
      addTransactions: vi.fn().mockResolvedValue(['tx-1']),
      utils: {
        amountToInteger: (val: number) => Math.round(val * 100),
        integerToAmount: (val: number) => val / 100,
      },
    };
  };

  const testConfig: Config = {
    port: 4100,
    host: '127.0.0.1',
    databaseUrl: 'postgresql://localhost/test',
    stateDir: '.dev/test-state',
    apiKeys: ['test-secret-key-12345678901234567890'],
    logLevel: 'silent',
    budgets: new Map([
      ['personal', { name: 'personal', syncId: 'sync-personal-123' }],
      ['business', { name: 'business', syncId: 'sync-business-456' }],
    ]),
  };

  const validKey = testConfig.apiKeys[0];

  it('handles multi-budget switching with mutex and caches current budget', async () => {
    const mockApi = createMockApi();
    const client = new ActualClient({
      stateDir: testConfig.stateDir,
      budgets: testConfig.budgets,
      api: mockApi,
    });

    // First call to personal budget -> calls downloadBudget
    const res1 = await client.withBudget('personal', async (api) => {
      return await api.getAccounts();
    });
    expect(res1).toEqual(mockAccounts);
    expect(mockApi.downloadBudget).toHaveBeenCalledTimes(1);
    expect(mockApi.downloadBudget).toHaveBeenCalledWith('sync-personal-123', { password: undefined });
    expect(client.currentBudgetName).toBe('personal');

    // Second call to personal budget -> should NOT call downloadBudget again
    const res2 = await client.withBudget('personal', async (api) => {
      return await api.getPayees();
    });
    expect(res2).toEqual(mockPayees);
    expect(mockApi.downloadBudget).toHaveBeenCalledTimes(1);

    // Call to business budget -> calls downloadBudget for business
    const res3 = await client.withBudget('business', async (api) => {
      return await api.getCategories();
    });
    expect(res3).toEqual(mockCategories);
    expect(mockApi.downloadBudget).toHaveBeenCalledTimes(2);
    expect(mockApi.downloadBudget).toHaveBeenCalledWith('sync-business-456', { password: undefined });
    expect(client.currentBudgetName).toBe('business');
  });

  it('GET /budgets returns budget list without sync IDs', async () => {
    const mockApi = createMockApi();
    const client = new ActualClient({
      stateDir: testConfig.stateDir,
      budgets: testConfig.budgets,
      api: mockApi,
    });

    const server = buildServer({
      config: testConfig,
      actualClient: client,
      logger: false,
    });

    const res = await server.inject({
      method: 'GET',
      url: '/budgets',
      headers: { 'x-api-key': validKey },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.budgets).toEqual(['personal', 'business']);
    expect(JSON.stringify(body)).not.toContain('sync-personal');
  });

  it('GET /budgets/:budget/accounts returns accounts', async () => {
    const mockApi = createMockApi();
    const client = new ActualClient({
      stateDir: testConfig.stateDir,
      budgets: testConfig.budgets,
      api: mockApi,
    });

    const server = buildServer({
      config: testConfig,
      actualClient: client,
      logger: false,
    });

    const res = await server.inject({
      method: 'GET',
      url: '/budgets/personal/accounts',
      headers: { 'x-api-key': validKey },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(mockAccounts);
  });

  it('GET /budgets/:budget/payees and categories return data', async () => {
    const mockApi = createMockApi();
    const client = new ActualClient({
      stateDir: testConfig.stateDir,
      budgets: testConfig.budgets,
      api: mockApi,
    });

    const server = buildServer({
      config: testConfig,
      actualClient: client,
      logger: false,
    });

    const payeeRes = await server.inject({
      method: 'GET',
      url: '/budgets/personal/payees',
      headers: { 'x-api-key': validKey },
    });
    expect(payeeRes.statusCode).toBe(200);
    expect(payeeRes.json()).toEqual(mockPayees);

    const catRes = await server.inject({
      method: 'GET',
      url: '/budgets/personal/categories',
      headers: { 'x-api-key': validKey },
    });
    expect(catRes.statusCode).toBe(200);
    expect(catRes.json()).toEqual(mockCategories);
  });

  it('returns 404 for non-existent budget', async () => {
    const mockApi = createMockApi();
    const client = new ActualClient({
      stateDir: testConfig.stateDir,
      budgets: testConfig.budgets,
      api: mockApi,
    });

    const server = buildServer({
      config: testConfig,
      actualClient: client,
      logger: false,
    });

    const res = await server.inject({
      method: 'GET',
      url: '/budgets/nonexistent/accounts',
      headers: { 'x-api-key': validKey },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('not_found');
  });

  it('POST /budgets/:budget/sync executes sync', async () => {
    const mockApi = createMockApi();
    const client = new ActualClient({
      stateDir: testConfig.stateDir,
      budgets: testConfig.budgets,
      api: mockApi,
    });

    const server = buildServer({
      config: testConfig,
      actualClient: client,
      logger: false,
    });

    const res = await server.inject({
      method: 'POST',
      url: '/budgets/personal/sync',
      headers: { 'x-api-key': validKey },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.budget).toBe('personal');
    expect(body.status).toBe('synced');
    expect(typeof body.duration_ms).toBe('number');
    expect(mockApi.sync).toHaveBeenCalled();
  });
});
