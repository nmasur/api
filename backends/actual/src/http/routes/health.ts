import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type pg from 'pg';
import { checkDb } from '../../db/pool.js';

export interface HealthRouteOptions {
  pool?: pg.Pool;
  checkActualServer?: () => Promise<boolean>;
}

export function createHealthRoutes(options: HealthRouteOptions = {}): FastifyPluginAsync {
  return async function healthRoutes(fastify: FastifyInstance) {
    fastify.get('/healthz', async (_request, reply) => {
      return reply.status(200).send({ status: 'ok' });
    });

    fastify.get('/readyz', async (_request, reply) => {
      const checks: Record<string, boolean> = {};
      let allOk = true;

      if (options.pool) {
        const dbOk = await checkDb(options.pool);
        checks.db = dbOk;
        if (!dbOk) allOk = false;
      }

      if (options.checkActualServer) {
        const actualOk = await options.checkActualServer();
        checks.actual_server = actualOk;
        if (!actualOk) allOk = false;
      }

      if (!allOk) {
        return reply.status(503).send({
          status: 'degraded',
          checks,
        });
      }

      return reply.status(200).send({
        status: 'ok',
        checks,
      });
    });
  };
}
