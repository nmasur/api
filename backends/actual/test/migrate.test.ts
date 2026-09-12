import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { runMigrations, loadMigrationFiles } from '../src/db/migrate.js';
import { checkDb } from '../src/db/pool.js';

const dbUrl = process.env.DATABASE_URL || 'postgresql://api_actual@127.0.0.1:5433/api_actual';

describe('Database Migrations', () => {
  let pool: pg.Pool | null = null;
  let isDbAvailable = false;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: dbUrl });
    isDbAvailable = await checkDb(pool);
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  it('loadMigrationFiles correctly loads and parses SQL files', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-actual-test-migrations-'));
    try {
      fs.writeFileSync(path.join(tmpDir, '0001_first.sql'), 'SELECT 1;');
      fs.writeFileSync(path.join(tmpDir, '0002_second.sql'), 'SELECT 2;');
      fs.writeFileSync(path.join(tmpDir, 'not-a-migration.txt'), 'ignore me');

      const files = loadMigrationFiles(tmpDir);
      expect(files).toHaveLength(2);
      expect(files[0].version).toBe(1);
      expect(files[0].name).toBe('0001_first.sql');
      expect(files[1].version).toBe(2);
      expect(files[1].name).toBe('0002_second.sql');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('runs migrations, verifies idempotency, and detects tampering', async () => {
    if (!isDbAvailable || !pool) {
      console.warn('Skipping migration database test: database not available');
      return;
    }

    // Clean up tables for test isolation
    await pool.query('DROP TABLE IF EXISTS transaction_log CASCADE;');
    await pool.query('DROP TABLE IF EXISTS card_mappings CASCADE;');
    await pool.query('DROP TABLE IF EXISTS budgets_seen CASCADE;');
    await pool.query('DROP TABLE IF EXISTS schema_migrations CASCADE;');

    // 1. Initial run of real migrations
    const initialApplied = await runMigrations(pool);
    expect(initialApplied).toBeGreaterThanOrEqual(1);

    // Verify tables exist
    const tablesRes = await pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
    );
    const tableNames = tablesRes.rows.map((r) => r.tablename);
    expect(tableNames).toContain('schema_migrations');
    expect(tableNames).toContain('budgets_seen');
    expect(tableNames).toContain('card_mappings');
    expect(tableNames).toContain('transaction_log');

    // 2. Second run is a no-op
    const secondApplied = await runMigrations(pool);
    expect(secondApplied).toBe(0);

    // 3. Tampering a migration file causes failure
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-actual-tamper-test-'));
    try {
      // Create migration 1 with different content
      fs.writeFileSync(path.join(tmpDir, '0001_init.sql'), '-- Tampered content');
      await expect(runMigrations(pool, tmpDir)).rejects.toThrow(/Tampered migration detected/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
