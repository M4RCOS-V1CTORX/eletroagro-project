import '../env.js';
import {readProtectedBackup,restoreBackup} from '../lib/backup.js';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const file = process.argv.find((value) => value.endsWith('.json.gz.enc'));
const confirmed = process.argv.includes('--confirm=RESTORE');
if (!file || !confirmed) { console.error('Restauração bloqueada. Use: npm --prefix apps/api run db:restore -- <arquivo.json.gz.enc> --confirm=RESTORE'); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL não configurada.'); process.exit(1); }
if (!process.env.BACKUP_ENCRYPTION_KEY) { console.error('BACKUP_ENCRYPTION_KEY não configurada.'); process.exit(1); }
const payload = readProtectedBackup(await readFile(file), process.env.BACKUP_ENCRYPTION_KEY);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false, max: 1 });
const client = await pool.connect();
try {
  await restoreBackup(client,payload); console.log('Restauração concluída com sucesso.');
} catch (error) { console.error('Falha na restauração; nenhuma alteração foi mantida:', error.message); process.exitCode = 1; }
finally { client.release(); await pool.end(); }
