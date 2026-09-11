import pg from 'pg';

const { Pool } = pg;

export function createPool(databaseUrl: string): pg.Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
}

export async function checkDb(pool: pg.Pool): Promise<boolean> {
  try {
    const res = await pool.query('SELECT 1 as ok');
    return res.rows.length === 1 && res.rows[0].ok === 1;
  } catch {
    return false;
  }
}
