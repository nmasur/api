import fs from 'node:fs';
import path from 'node:path';
import * as actualApi from '@actual-app/api';
import type pg from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import type { BudgetConfig } from '../config.js';
import { NotFoundError, UpstreamError } from '../http/errors.js';
import type { ActualApi } from './types.js';

export class AsyncMutex {
  private queue: Promise<void> = Promise.resolve();

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    let release: () => void;
    const nextLock = new Promise<void>((resolve) => {
      release = resolve;
    });

    const currentQueue = this.queue;
    this.queue = this.queue.then(() => nextLock);

    await currentQueue;
    try {
      return await fn();
    } finally {
      release!();
    }
  }
}

export interface ActualClientOptions {
  stateDir: string;
  serverUrl?: string;
  password?: string;
  budgets: Map<string, BudgetConfig>;
  pool?: pg.Pool;
  api?: ActualApi;
  logger?: FastifyBaseLogger;
}

export class ActualClient {
  private readonly options: ActualClientOptions;
  private readonly api: ActualApi;
  private readonly mutex = new AsyncMutex();
  private currentBudget: string | null = null;
  private isInitialized = false;

  constructor(options: ActualClientOptions) {
    this.options = options;
    this.api = options.api || (actualApi as unknown as ActualApi);
  }

  get initialized(): boolean {
    return this.isInitialized;
  }

  get currentBudgetName(): string | null {
    return this.currentBudget;
  }

  async init(): Promise<void> {
    if (!this.options.serverUrl) {
      return;
    }

    const dataDir = path.join(this.options.stateDir, 'actual');
    fs.mkdirSync(dataDir, { recursive: true });

    await this.api.init({
      dataDir,
      serverURL: this.options.serverUrl,
      password: this.options.password,
    });

    this.isInitialized = true;
    this.options.logger?.info('Initialized Actual Budget SDK client');
  }

  async shutdown(): Promise<void> {
    await this.mutex.runExclusive(async () => {
      if (this.isInitialized) {
        try {
          await this.api.shutdown();
        } catch (err) {
          this.options.logger?.error({ err }, 'Error during Actual client shutdown');
        }
        this.isInitialized = false;
        this.currentBudget = null;
      }
    });
  }

  async withBudget<T>(
    budgetName: string,
    fn: (api: ActualApi, budgetConfig: BudgetConfig) => Promise<T>
  ): Promise<T> {
    const normalizedName = budgetName.toLowerCase();
    const budgetConfig = this.options.budgets.get(normalizedName);
    if (!budgetConfig) {
      throw new NotFoundError(`Budget '${budgetName}' not found`);
    }

    return await this.mutex.runExclusive(async () => {
      if (this.currentBudget !== normalizedName) {
        const startTime = Date.now();
        try {
          await this.api.downloadBudget(budgetConfig.syncId, {
            password: budgetConfig.encryptionPassword,
          });
        } catch (err) {
          throw new UpstreamError(
            `Failed to switch/download budget '${budgetName}': ${(err as Error).message}`
          );
        }

        const durationMs = Date.now() - startTime;
        this.currentBudget = normalizedName;
        this.options.logger?.info(
          { budget: normalizedName, duration_ms: durationMs },
          `Switched to budget '${normalizedName}' in ${durationMs}ms`
        );

        if (this.options.pool) {
          try {
            await this.options.pool.query(
              `INSERT INTO budgets_seen (name, sync_id, first_seen, last_used)
               VALUES ($1, $2, now(), now())
               ON CONFLICT (name) DO UPDATE SET last_used = now(), sync_id = EXCLUDED.sync_id`,
              [normalizedName, budgetConfig.syncId]
            );
          } catch (err) {
            this.options.logger?.warn(
              { err, budget: normalizedName },
              'Failed to update budgets_seen in database'
            );
          }
        }
      }

      return await fn(this.api, budgetConfig);
    });
  }

  async syncBudget(budgetName: string): Promise<{ durationMs: number }> {
    const startTime = Date.now();
    await this.withBudget(budgetName, async (api) => {
      await api.sync();
    });
    return { durationMs: Date.now() - startTime };
  }
}
