import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { buildServer } from '../src/http/server.js';
import type { Config } from '../src/config.js';

describe('HTTP Server', () => {
  const testConfig: Config = {
    port: 4100,
    host: '127.0.0.1',
    databaseUrl: 'postgresql://localhost/test',
    stateDir: '.dev/test-state',
    apiKeys: ['test-api-key-123456789012345678901234'],
    logLevel: 'silent',
    budgets: ['test'],
  };

  const validKey = testConfig.apiKeys[0];

  it('GET /healthz returns 200 without authentication', async () => {
    const server = buildServer({ config: testConfig, logger: false });
    const response = await server.inject({
      method: 'GET',
      url: '/healthz',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    expect(response.headers['x-request-id']).toBeDefined();
  });

  it('GET /readyz returns 200 when checks succeed', async () => {
    const mockPool = {
      query: async () => ({ rows: [{ ok: 1 }] }),
    } as unknown as pg.Pool;

    const server = buildServer({
      config: testConfig,
      pool: mockPool,
      checkActualServer: async () => true,
      logger: false,
    });

    const response = await server.inject({
      method: 'GET',
      url: '/readyz',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      checks: { db: true, actual_server: true },
    });
  });

  it('GET /readyz returns 503 when DB check fails', async () => {
    const mockPool = {
      query: async () => {
        throw new Error('Connection refused');
      },
    } as unknown as pg.Pool;

    const server = buildServer({
      config: testConfig,
      pool: mockPool,
      logger: false,
    });

    const response = await server.inject({
      method: 'GET',
      url: '/readyz',
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: 'degraded',
      checks: { db: false },
    });
  });

  it('GET /ping returns 401 when X-API-Key is missing', async () => {
    const server = buildServer({ config: testConfig, logger: false });
    const response = await server.inject({
      method: 'GET',
      url: '/ping',
    });

    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body.error).toBe('unauthorized');
    expect(body.message).toContain('Missing');
  });

  it('GET /ping returns 401 when X-API-Key is invalid', async () => {
    const server = buildServer({ config: testConfig, logger: false });
    const response = await server.inject({
      method: 'GET',
      url: '/ping',
      headers: {
        'x-api-key': 'wrong-key',
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe('unauthorized');
  });

  it('GET /ping returns 200 with pong when authenticated', async () => {
    const server = buildServer({ config: testConfig, logger: false });
    const response = await server.inject({
      method: 'GET',
      url: '/ping',
      headers: {
        'x-api-key': validKey,
        'x-request-id': 'custom-req-id-123',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.pong).toBe(true);
    expect(body.req_id).toBe('custom-req-id-123');
    expect(response.headers['x-request-id']).toBe('custom-req-id-123');
  });

  it('POST /echo returns echoed payload when authenticated', async () => {
    const server = buildServer({ config: testConfig, logger: false });
    const payload = { message: 'hello world', count: 42 };

    const response = await server.inject({
      method: 'POST',
      url: '/echo',
      headers: {
        'x-api-key': validKey,
        'content-type': 'application/json',
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.echo).toEqual(payload);
    expect(body.req_id).toBeDefined();
  });

  it('POST /echo returns 415 for non-JSON content type', async () => {
    const server = buildServer({ config: testConfig, logger: false });

    const response = await server.inject({
      method: 'POST',
      url: '/echo',
      headers: {
        'x-api-key': validKey,
        'content-type': 'text/plain',
      },
      payload: 'not json',
    });

    expect(response.statusCode).toBe(415);
    expect(response.json().error).toBe('unsupported_media_type');
  });

  it('returns 404 for unknown route', async () => {
    const server = buildServer({ config: testConfig, logger: false });
    const response = await server.inject({
      method: 'GET',
      url: '/non-existent-route',
      headers: {
        'x-api-key': validKey,
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('not_found');
  });
});
