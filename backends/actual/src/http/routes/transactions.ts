import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type pg from 'pg';
import type { ActualClient } from '../../actual/client.js';
import type { ActualTransaction } from '../../actual/types.js';
import type { Config } from '../../config.js';
import { AppError, BadRequestError, NotFoundError, UpstreamError, AccountUnresolvedError } from '../errors.js';

export interface TransactionsRouteOptions {
  config: Config;
  client: ActualClient;
  pool: pg.Pool;
}

export interface CreateTransactionBody {
  amount: number;
  type?: 'payment' | 'deposit';
  account?: string;
  card?: string;
  payee?: string;
  date?: string;
  notes?: string;
  category?: string;
  cleared?: boolean;
  idempotency_key?: string;
  save_card_mapping?: boolean;
}

function getTodayInTz(tz?: string): string {
  try {
    if (tz) {
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      return formatter.format(new Date());
    }
  } catch {
    // fallback
  }

  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function deriveIdempotencyKey(
  budget: string,
  account: string,
  date: string,
  amount: number,
  payee?: string
): string {
  const content = `${budget}|${account}|${date}|${amount}|${payee || ''}`;
  return createHash('sha256').update(content).digest('hex').substring(0, 32);
}

export function createTransactionsRoutes(options: TransactionsRouteOptions): FastifyPluginAsync {
  const { config, client, pool } = options;

  return async function transactionsRoutes(fastify: FastifyInstance) {
    // POST /budgets/:budget/transactions - Tap-to-pay transaction creation
    fastify.post<{
      Params: { budget: string };
      Body: CreateTransactionBody;
    }>('/budgets/:budget/transactions', async (request, reply) => {
      const { budget } = request.params;
      const normalizedBudget = budget.toLowerCase();
      const budgetConfig = config.budgets.get(normalizedBudget);
      if (!budgetConfig) {
        throw new NotFoundError(`Budget '${budget}' not found`);
      }

      const body = request.body;
      if (!body || typeof body.amount !== 'number' || isNaN(body.amount) || body.amount <= 0) {
        throw new BadRequestError('amount is required and must be a positive number');
      }

      const txType = body.type || 'payment';
      if (txType !== 'payment' && txType !== 'deposit') {
        throw new BadRequestError("type must be 'payment' or 'deposit'");
      }

      const date = body.date || getTodayInTz(config.tz);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new BadRequestError('date must be in YYYY-MM-DD format');
      }

      // 1. Resolve account: explicit account -> card mapping -> defaultAccount -> 400
      let resolvedAccount: string | undefined = body.account?.trim();

      if (!resolvedAccount && body.card) {
        const cardMapping = await pool.query<{ account_name: string }>(
          `SELECT account_name FROM card_mappings
           WHERE budget = $1 AND LOWER(card_name) = LOWER($2)
           LIMIT 1`,
          [normalizedBudget, body.card.trim()]
        );
        if (cardMapping.rows.length > 0) {
          resolvedAccount = cardMapping.rows[0].account_name;
        }
      }

      if (!resolvedAccount && budgetConfig.defaultAccount) {
        resolvedAccount = budgetConfig.defaultAccount;
      }

      if (!resolvedAccount) {
        const availableAccounts = await client.withBudget(normalizedBudget, async (api) => {
          const accounts = await api.getAccounts();
          return accounts.filter((a) => !a.closed).map((a) => a.name);
        });
        throw new AccountUnresolvedError('Account could not be resolved', availableAccounts);
      }

      if (body.card && body.account && body.save_card_mapping) {
        await pool.query(
          `INSERT INTO card_mappings (budget, card_name, account_name)
           VALUES ($1, $2, $3)
           ON CONFLICT (budget, card_name)
           DO UPDATE SET account_name = EXCLUDED.account_name`,
          [normalizedBudget, body.card.trim(), body.account.trim()]
        );
      }

      // 2. Compute Actual amount (in cents)
      const rawHeaderKey = request.headers['idempotency-key'];
      const idempotencyKey =
        body.idempotency_key?.trim() ||
        (typeof rawHeaderKey === 'string' ? rawHeaderKey.trim() : '') ||
        deriveIdempotencyKey(normalizedBudget, resolvedAccount, date, body.amount, body.payee);

      // 3. Check for existing created transaction with same idempotency key
      const existing = await pool.query<{
        status: string;
        response: Record<string, unknown>;
      }>(
        `SELECT status, response FROM transaction_log
         WHERE budget = $1 AND idempotency_key = $2`,
        [normalizedBudget, idempotencyKey]
      );

      if (existing.rows.length > 0 && existing.rows[0].status === 'created') {
        const originalResponse = existing.rows[0].response || {};
        return reply.status(200).send({
          ...originalResponse,
          duplicate: true,
        });
      }

      // 4. Insert transaction_log row with 'failed' placeholder
      const placeholderRes = await pool.query<{ id: string }>(
        `INSERT INTO transaction_log (budget, idempotency_key, request, status)
         VALUES ($1, $2, $3, 'failed')
         ON CONFLICT (budget, idempotency_key)
         DO UPDATE SET received_at = now(), request = EXCLUDED.request, status = 'failed', error = null
         RETURNING id`,
        [normalizedBudget, idempotencyKey, JSON.stringify(body)]
      );
      const logId = placeholderRes.rows[0].id;

      try {
        const result = await client.withBudget(normalizedBudget, async (api) => {
          const cents = Math.abs(api.utils.amountToInteger(body.amount));
          const actualAmount = txType === 'payment' ? -cents : cents;

          // Resolve account in Actual
          const accounts = await api.getAccounts();
          const matchedAccount = accounts.find(
            (a) => a.name.toLowerCase() === resolvedAccount!.toLowerCase() && !a.closed
          );
          if (!matchedAccount) {
            throw new BadRequestError(
              `Account '${resolvedAccount}' not found in Actual Budget`
            );
          }

          // Resolve category if provided
          let categoryId: string | undefined;
          if (body.category) {
            const categories = await api.getCategories();
            const matchedCategory = categories.find(
              (c) => c.name.toLowerCase() === body.category!.toLowerCase()
            );
            if (!matchedCategory) {
              throw new BadRequestError(
                `Category '${body.category}' not found in Actual Budget`
              );
            }
            categoryId = matchedCategory.id;
          }

          const tx: ActualTransaction = {
            account: matchedAccount.id,
            date,
            amount: actualAmount,
            payee_name: body.payee,
            category: categoryId,
            notes: body.notes,
            cleared: body.cleared ?? false,
          };

          const txIds = await api.addTransactions(matchedAccount.id, [tx], {
            learnCategories: true,
            runTransfers: true,
          });

          await api.sync();

          const responseData = {
            id: txIds[0],
            budget: normalizedBudget,
            account: resolvedAccount,
            amount: actualAmount,
            date,
            payee: body.payee,
            category: body.category,
            duplicate: false,
          };

          return responseData;
        });

        // 5. Update transaction_log to 'created'
        await pool.query(
          `UPDATE transaction_log
           SET status = 'created', actual_transaction_id = $1, response = $2, error = null
           WHERE id = $3`,
          [result.id, JSON.stringify(result), logId]
        );

        return reply.status(201).send(result);
      } catch (err) {
        // Record failure in log
        await pool.query(
          `UPDATE transaction_log SET status = 'failed', error = $1 WHERE id = $2`,
          [(err as Error).message, logId]
        );

        if (err instanceof AppError) {
          throw err;
        }

        throw new UpstreamError(
          `Failed to create transaction in Actual: ${(err as Error).message}`
        );
      }
    });

    // GET /budgets/:budget/transactions?account=&since=&until=
    fastify.get<{
      Params: { budget: string };
      Querystring: { account?: string; since?: string; until?: string };
    }>('/budgets/:budget/transactions', async (request, reply) => {
      const { budget } = request.params;
      const { account, since, until } = request.query;

      const transactions = await client.withBudget(budget, async (api) => {
        let accountId: string | undefined;
        if (account) {
          const accounts = await api.getAccounts();
          const matched = accounts.find(
            (a) => a.name.toLowerCase() === account.toLowerCase()
          );
          if (!matched) {
            throw new BadRequestError(`Account '${account}' not found in Actual Budget`);
          }
          accountId = matched.id;
        }

        return await api.getTransactions(accountId as string, since, until);
      });

      return reply.status(200).send({ transactions });
    });

    // GET /budgets/:budget/log?limit=50 - Recent rows of transaction_log
    fastify.get<{
      Params: { budget: string };
      Querystring: { limit?: string };
    }>('/budgets/:budget/log', async (request, reply) => {
      const normalizedBudget = request.params.budget.toLowerCase();
      if (!config.budgets.has(normalizedBudget)) {
        throw new NotFoundError(`Budget '${request.params.budget}' not found`);
      }

      const limit = Math.max(1, Math.min(100, parseInt(request.query.limit || '50', 10) || 50));

      const result = await pool.query(
        `SELECT id, budget, idempotency_key, received_at, request, actual_transaction_id, status, error, response
         FROM transaction_log
         WHERE budget = $1
         ORDER BY received_at DESC
         LIMIT $2`,
        [normalizedBudget, limit]
      );

      return reply.status(200).send({
        log: result.rows,
      });
    });
  };
}
