import { loadConfig } from './config.js';
import { ActualClient } from './actual/client.js';
import { runMigrations } from './db/migrate.js';
import { createPool } from './db/pool.js';
import { buildServer } from './http/server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const actualClient = new ActualClient({
    stateDir: config.stateDir,
    serverUrl: config.actualServerUrl,
    password: config.actualPassword,
    budgets: config.budgets,
    pool,
  });

  const server = buildServer({ config, pool, actualClient });

  let isShuttingDown = false;

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    server.log.info({ signal }, 'Received shutdown signal, stopping gracefully...');

    const forceExitTimeout = setTimeout(() => {
      server.log.error('Graceful shutdown timed out after 10s, forcing exit');
      process.exit(1);
    }, 10000);
    forceExitTimeout.unref();

    try {
      await server.close();
      server.log.info('HTTP server closed');
      await actualClient.shutdown();
      server.log.info('Actual client shut down');
      await pool.end();
      server.log.info('Database pool drained');
      process.exit(0);
    } catch (err) {
      server.log.error({ err }, 'Error during graceful shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  try {
    const applied = await runMigrations(pool);
    if (applied > 0) {
      server.log.info({ applied }, `Applied ${applied} database migration(s)`);
    } else {
      server.log.info('Database migrations are up to date');
    }
  } catch (err) {
    server.log.error({ err }, 'Failed to run database migrations');
    await pool.end();
    process.exit(1);
  }

  try {
    await actualClient.init();
  } catch (err) {
    server.log.error({ err }, 'Failed to initialize Actual client');
    await pool.end();
    process.exit(1);
  }

  try {
    const address = await server.listen({
      port: config.port,
      host: config.host,
    });
    server.log.info({ address }, `Server listening on ${address}`);
  } catch (err) {
    server.log.error({ err }, 'Failed to start server');
    process.exit(1);
  }
}

void main();
