import { randomUUID } from 'node:crypto';
import Fastify, { LogController, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type pg from 'pg';
import type { Config } from '../config.js';
import type { ActualClient } from '../actual/client.js';
import { createAuthHook } from './auth.js';
import { handleFastifyError, UnsupportedMediaTypeError } from './errors.js';
import { createHealthRoutes } from './routes/health.js';
import { createBudgetRoutes } from './routes/budgets.js';
import { createMappingsRoutes } from './routes/mappings.js';
import { createTransactionsRoutes } from './routes/transactions.js';
import { pingRoutes } from './routes/ping.js';

export interface BuildServerOptions {
  config: Config;
  pool?: pg.Pool;
  actualClient?: ActualClient;
  checkActualServer?: () => Promise<boolean>;
  logger?: FastifyServerOptions['logger'];
}

export function buildServer(options: BuildServerOptions): FastifyInstance {
  const { config, pool, checkActualServer } = options;

  const defaultLogger: FastifyServerOptions['logger'] = {
    level: config.logLevel,
    messageKey: 'msg',
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    formatters: {
      level: (label) => ({ level: label }),
    },
    redact: {
      paths: ['req.headers["x-api-key"]', 'req.headers.authorization'],
      censor: '[REDACTED]',
    },
  };

  const fastify = Fastify({
    logger: options.logger !== undefined ? options.logger : defaultLogger,
    bodyLimit: 1048576, // 1 MiB
    requestIdHeader: 'x-request-id',
    logController: new LogController({
      requestIdLogLabel: 'req_id',
    }),
    genReqId: (req) => {
      const headerId = req.headers['x-request-id'];
      if (typeof headerId === 'string' && headerId.length > 0) {
        return headerId;
      }
      return randomUUID();
    },
  });

  // Ensure X-Request-Id is included on all responses
  fastify.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  // Enforce JSON only for request bodies
  fastify.addHook('preValidation', async (request, _reply) => {
    const method = request.method;
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      const contentType = request.headers['content-type'];
      if (contentType && !contentType.includes('application/json')) {
        throw new UnsupportedMediaTypeError('Content-Type must be application/json');
      }
    }
  });

  // Register authentication hook
  fastify.addHook('onRequest', createAuthHook(config.apiKeys));

  // Custom error and 404 handlers
  fastify.setErrorHandler(handleFastifyError);
  fastify.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({
      error: 'not_found',
      message: 'Resource not found',
    });
  });

  const defaultCheckActualServer = config.actualServerUrl
    ? async () => {
        try {
          const res = await fetch(config.actualServerUrl!, {
            signal: AbortSignal.timeout(3000),
          });
          return res.status < 500;
        } catch {
          return false;
        }
      }
    : undefined;

  const actualServerCheck = checkActualServer !== undefined ? checkActualServer : defaultCheckActualServer;

  // Register routes
  fastify.register(createHealthRoutes({ pool, checkActualServer: actualServerCheck }));
  fastify.register(pingRoutes);

  if (options.actualClient) {
    fastify.register(createBudgetRoutes({ config, client: options.actualClient }));
  }

  if (pool) {
    fastify.register(createMappingsRoutes({ config, pool }));
  }

  if (pool && options.actualClient) {
    fastify.register(createTransactionsRoutes({ config, client: options.actualClient, pool }));
  }

  return fastify;
}
