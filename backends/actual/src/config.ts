import { randomBytes } from 'node:crypto';

export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  stateDir: string;
  apiKeys: string[];
  logLevel: string;
  actualServerUrl?: string;
  actualPassword?: string;
  budgets: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = env.PORT ? parseInt(env.PORT, 10) : 4100;
  if (isNaN(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT environment variable: ${env.PORT}`);
  }

  const host = '127.0.0.1';

  const databaseUrl =
    env.DATABASE_URL ||
    'postgresql://api_actual@127.0.0.1:5433/api_actual';

  const stateDir = env.STATE_DIR || '.dev/state';

  const rawKeys = env.API_KEYS || '';
  const apiKeys = rawKeys
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k.length > 0);

  // If no keys configured in dev mode, generate a temporary dev key
  if (apiKeys.length === 0 && env.NODE_ENV !== 'production') {
    const devKey = 'dev-key-' + randomBytes(16).toString('hex');
    apiKeys.push(devKey);
    // In dev, warn that a temporary key was generated
    console.warn(
      JSON.stringify({
        level: 'warn',
        msg: `No API_KEYS configured. Generated temporary dev API key: ${devKey}`,
        time: new Date().toISOString(),
      })
    );
  } else if (apiKeys.length === 0) {
    throw new Error('API_KEYS environment variable is required in production');
  }

  const budgets = env.BUDGETS
    ? env.BUDGETS.split(',')
        .map((b) => b.trim())
        .filter((b) => b.length > 0)
    : [];

  return {
    port,
    host,
    databaseUrl,
    stateDir,
    apiKeys,
    logLevel: env.LOG_LEVEL || 'info',
    actualServerUrl: env.ACTUAL_SERVER_URL,
    actualPassword: env.ACTUAL_PASSWORD,
    budgets,
  };
}
