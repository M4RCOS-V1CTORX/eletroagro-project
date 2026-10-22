import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false,
      max: 1,
      connectionTimeoutMillis: 5_000,
    })
  : null;

if (!pool) {
  console.error('DATABASE_URL não configurada. Copie apps/api/.env.example para apps/api/.env e configure o banco de desenvolvimento.');
  process.exit(1);
}

let client;
try {
  client = await pool.connect();
  await client.query('SELECT pg_advisory_lock(824730195)');
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      migration_name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(migrationsDirectory))
    .filter((file) => /^\d{3}_[a-z0-9_]+\.sql$/.test(file))
    .sort();

  for (const file of files) {
    const alreadyApplied = await client.query(
      'SELECT 1 FROM public.schema_migrations WHERE migration_name = $1',
      [file],
    );
    if (alreadyApplied.rowCount) {
      console.log(`Já aplicada: ${file}`);
      continue;
    }

    const sql = await readFile(join(migrationsDirectory, file), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO public.schema_migrations (migration_name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`Aplicada: ${file}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} catch (error) {
  console.error('Falha na migração:', error.message);
  process.exitCode = 1;
} finally {
  if (client) {
    try {
      await client.query('SELECT pg_advisory_unlock(824730195)');
    } catch {
      // A conexão pode já ter sido encerrada pelo PostgreSQL.
    }
    client.release();
  }
  await pool.end();
}
