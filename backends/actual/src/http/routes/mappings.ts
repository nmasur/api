import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type pg from 'pg';
import { BadRequestError, NotFoundError } from '../errors.js';
import type { Config } from '../../config.js';

export interface MappingsRouteOptions {
  config: Config;
  pool: pg.Pool;
}

export function createMappingsRoutes(options: MappingsRouteOptions): FastifyPluginAsync {
  const { config, pool } = options;

  return async function mappingsRoutes(fastify: FastifyInstance) {
    // Check budget existence helper
    const ensureBudgetExists = (budget: string) => {
      const normalized = budget.toLowerCase();
      if (!config.budgets.has(normalized)) {
        throw new NotFoundError(`Budget '${budget}' not found`);
      }
      return normalized;
    };

    // GET /budgets/:budget/mappings - List card_mappings
    fastify.get<{ Params: { budget: string } }>(
      '/budgets/:budget/mappings',
      async (request, reply) => {
        const budget = ensureBudgetExists(request.params.budget);
        const result = await pool.query<{
          id: number;
          budget: string;
          card_name: string;
          account_name: string;
        }>(
          `SELECT id, budget, card_name, account_name
           FROM card_mappings
           WHERE budget = $1
           ORDER BY card_name ASC`,
          [budget]
        );

        return reply.status(200).send({
          mappings: result.rows,
        });
      }
    );

    // PUT /budgets/:budget/mappings/:card - Upsert {account}
    fastify.put<{
      Params: { budget: string; card: string };
      Body: { account?: string };
    }>('/budgets/:budget/mappings/:card', async (request, reply) => {
      const budget = ensureBudgetExists(request.params.budget);
      const cardName = decodeURIComponent(request.params.card).trim();
      const accountName = request.body?.account?.trim();

      if (!cardName) {
        throw new BadRequestError('Card name cannot be empty');
      }
      if (!accountName) {
        throw new BadRequestError('Account name is required in request body');
      }

      const result = await pool.query<{
        id: number;
        budget: string;
        card_name: string;
        account_name: string;
      }>(
        `INSERT INTO card_mappings (budget, card_name, account_name)
         VALUES ($1, $2, $3)
         ON CONFLICT (budget, card_name)
         DO UPDATE SET account_name = EXCLUDED.account_name
         RETURNING id, budget, card_name, account_name`,
        [budget, cardName, accountName]
      );

      return reply.status(200).send(result.rows[0]);
    });

    // DELETE /budgets/:budget/mappings/:card - Remove
    fastify.delete<{ Params: { budget: string; card: string } }>(
      '/budgets/:budget/mappings/:card',
      async (request, reply) => {
        const budget = ensureBudgetExists(request.params.budget);
        const cardName = decodeURIComponent(request.params.card).trim();

        const result = await pool.query(
          `DELETE FROM card_mappings WHERE budget = $1 AND card_name = $2 RETURNING id`,
          [budget, cardName]
        );

        if (result.rowCount === 0) {
          throw new NotFoundError(`Card mapping for '${cardName}' not found in budget '${budget}'`);
        }

        return reply.status(200).send({ deleted: true });
      }
    );
  };
}
