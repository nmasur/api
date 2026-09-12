import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

export interface MigrationFile {
  version: number;
  name: string;
  filePath: string;
  sql: string;
  sha256: string;
}

export function getDefaultMigrationsDir(): string {
  const dirSame = fileURLToPath(new URL('./migrations', import.meta.url));
  if (fs.existsSync(dirSame)) {
    return dirSame;
  }
  const dirDist = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
  if (fs.existsSync(dirDist)) {
    return dirDist;
  }
  return dirSame;
}

export function loadMigrationFiles(dir: string): MigrationFile[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const migrations: MigrationFile[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.sql')) {
      continue;
    }

    const match = /^(\d+)_(.+)\.sql$/.exec(entry.name);
    if (!match) {
      continue;
    }

    const version = parseInt(match[1], 10);
    const filePath = path.join(dir, entry.name);
    const sql = fs.readFileSync(filePath, 'utf8');
    const sha256 = createHash('sha256').update(sql).digest('hex');

    migrations.push({
      version,
      name: entry.name,
      filePath,
      sql,
      sha256,
    });
  }

  migrations.sort((a, b) => a.version - b.version);
  return migrations;
}

const ADVISORY_LOCK_ID = 82736451; // arbitrary 32-bit integer for api_actual migrations

export async function runMigrations(
  pool: pg.Pool,
  migrationsDir: string = getDefaultMigrationsDir()
): Promise<number> {
  const files = loadMigrationFiles(migrationsDir);
  const client = await pool.connect();

  try {
    // Acquire session-level advisory lock to prevent concurrent runs
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_ID]);

    // Ensure migrations table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version integer PRIMARY KEY,
        name text NOT NULL,
        sha256 text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    const result = await client.query<{ version: number; name: string; sha256: string }>(
      'SELECT version, name, sha256 FROM schema_migrations ORDER BY version ASC'
    );
    const applied = result.rows;
    const appliedMap = new Map<number, { name: string; sha256: string }>();
    let maxAppliedVersion = 0;

    for (const row of applied) {
      appliedMap.set(row.version, { name: row.name, sha256: row.sha256 });
      if (row.version > maxAppliedVersion) {
        maxAppliedVersion = row.version;
      }
    }

    // Verify existing applied migrations
    for (const file of files) {
      const already = appliedMap.get(file.version);
      if (already) {
        if (already.sha256 !== file.sha256) {
          throw new Error(
            `Tampered migration detected: version ${file.version} (${file.name}) ` +
              `has hash ${file.sha256}, but was recorded as ${already.sha256}`
          );
        }
      }
    }

    let appliedCount = 0;

    for (const file of files) {
      if (appliedMap.has(file.version)) {
        continue;
      }

      if (file.version < maxAppliedVersion) {
        throw new Error(
          `Out-of-order migration: version ${file.version} (${file.name}) cannot be applied ` +
            `after version ${maxAppliedVersion}`
        );
      }

      await client.query('BEGIN');
      try {
        await client.query(file.sql);
        await client.query(
          'INSERT INTO schema_migrations (version, name, sha256) VALUES ($1, $2, $3)',
          [file.version, file.name, file.sha256]
        );
        await client.query('COMMIT');
        appliedCount++;
        maxAppliedVersion = file.version;
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Failed to apply migration ${file.name}: ${(err as Error).message}`);
      }
    }

    return appliedCount;
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_ID]);
    } catch {
      // ignore unlock error on disconnect
    }
    client.release();
  }
}
