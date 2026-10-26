import '../env.js';
import {backupTables,protectBackup} from '../lib/backup.js';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const tables = backupTables;
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL não configurada.'); process.exit(1); }
if (!process.env.BACKUP_ENCRYPTION_KEY || process.env.BACKUP_ENCRYPTION_KEY.length < 20) { console.error('BACKUP_ENCRYPTION_KEY deve ter pelo menos 20 caracteres.'); process.exit(1); }
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false, max: 1 });
try {
  await pool.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const data = {};
  for (const table of tables) {
    const exists=await pool.query('SELECT to_regclass($1) AS name',[`public.${table}`]);
    if(!exists.rows[0].name && ['sale_year_counters','transport_profiles'].includes(table))continue;
    data[table] = (await pool.query(`SELECT * FROM public.${table}`)).rows;
  }
  await pool.query('COMMIT');
  const protectedBackup = protectBackup({ backupVersion: 1, createdAt: new Date().toISOString(), tables: data },process.env.BACKUP_ENCRYPTION_KEY);
  const folder = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'backups');
  await mkdir(folder, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z');
  const file = join(folder, `eletroagro-${stamp}.json.gz.enc`);
  await writeFile(file, protectedBackup, { flag: 'wx' });
  await writeFile(`${file}.sha256`, `${createHash('sha256').update(protectedBackup).digest('hex')}  ${file.split(/[\\/]/).at(-1)}\n`, { flag: 'wx' });
  console.log(`Backup criado e protegido por checksum: ${file}`);
} catch (error) { console.error('Falha ao criar backup:', error.message); process.exitCode = 1; }
finally { await pool.end(); }
