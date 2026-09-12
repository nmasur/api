import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { ActualClient } from '../../actual/client.js';
import type { Config } from '../../config.js';

export interface BudgetRouteOptions {
  config: Config;
  client: ActualClient;
}

export function createBudgetRoutes(options: BudgetRouteOptions): FastifyPluginAsync {
  const { config, client } = options;

  return async function budgetRoutes(fastify: FastifyInstance) {
    // GET /budgets - List configured budget names (never sync IDs)
    fastify.get('/budgets', async (_request, reply) => {
      const budgetNames = Array.from(config.budgets.keys());
      return reply.status(200).send({
        budgets: budgetNames,
      });
    });

    // GET /budgets/:budget/accounts - Proxy getAccounts()
    fastify.get<{ Params: { budget: string } }>(
      '/budgets/:budget/accounts',
      async (request, reply) => {
        const { budget } = request.params;
        const accounts = await client.withBudget(budget, async (api) => {
          const rawAccounts = await api.getAccounts();
          return rawAccounts.map((acc) => ({
            id: acc.id,
            name: acc.name,
            offbudget: acc.offbudget ?? false,
            closed: acc.closed ?? false,
          }));
        });

        return reply.status(200).send(accounts);
      }
    );

    // GET /budgets/:budget/payees - Proxy getPayees()
    fastify.get<{ Params: { budget: string } }>(
      '/budgets/:budget/payees',
      async (request, reply) => {
        const { budget } = request.params;
        const payees = await client.withBudget(budget, async (api) => {
          return await api.getPayees();
        });

        return reply.status(200).send(payees);
      }
    );

    // GET /budgets/:budget/categories - Proxy getCategories()
    fastify.get<{ Params: { budget: string } }>(
      '/budgets/:budget/categories',
      async (request, reply) => {
        const { budget } = request.params;
        const categories = await client.withBudget(budget, async (api) => {
          return await api.getCategories();
        });

        return reply.status(200).send(categories);
      }
    );

    // POST /budgets/:budget/sync - Force downloadBudget + sync. Returns timing.
    fastify.post<{ Params: { budget: string } }>(
      '/budgets/:budget/sync',
      async (request, reply) => {
        const { budget } = request.params;
        const result = await client.syncBudget(budget);
        return reply.status(200).send({
          budget,
          status: 'synced',
          duration_ms: result.durationMs,
        });
      }
    );
  };
}
