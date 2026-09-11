import { randomUUID } from 'node:crypto';
import Fastify, { LogController, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type pg from 'pg';
import type { Config } from '../config.js';
import { createAuthHook } from './auth.js';
import { handleFastifyError, UnsupportedMediaTypeError } from './errors.js';
import { createHealthRoutes } from './routes/health.js';
import { pingRoutes } from './routes/ping.js';

export interface BuildServerOptions {
  config: Config;
  pool?: pg.Pool;
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

  // Register routes
  fastify.register(createHealthRoutes({ pool, checkActualServer }));
  fastify.register(pingRoutes);

  return fastify;
}
