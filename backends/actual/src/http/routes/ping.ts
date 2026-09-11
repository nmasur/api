import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

export const pingRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.get('/ping', async (request, reply) => {
    return reply.status(200).send({
      pong: true,
      timestamp: new Date().toISOString(),
      req_id: request.id,
    });
  });

  fastify.post('/echo', async (request, reply) => {
    return reply.status(200).send({
      echo: request.body,
      req_id: request.id,
    });
  });
};
