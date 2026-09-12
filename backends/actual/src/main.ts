import { loadConfig } from './config.js';
import { runMigrations } from './db/migrate.js';
import { createPool } from './db/pool.js';
import { buildServer } from './http/server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const server = buildServer({ config, pool });

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
