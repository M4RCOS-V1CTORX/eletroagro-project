import 'dotenv/config';
import { createCipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import pg from 'pg';

const tables = ['companies','company_memberships','customers','catalog_items','suppliers','document_counters','quotes','quote_items','quote_status_history','quote_versions','sales','sale_items','sale_payments','company_invitations','financial_entries','financial_payments','service_orders','service_order_items','appointments','stock_movements','purchases','purchase_items','receipts','service_order_attachments','notification_preferences','idempotency_keys','audit_logs'];
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL não configurada.'); process.exit(1); }
if (!process.env.BACKUP_ENCRYPTION_KEY || process.env.BACKUP_ENCRYPTION_KEY.length < 20) { console.error('BACKUP_ENCRYPTION_KEY deve ter pelo menos 20 caracteres.'); process.exit(1); }
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false, max: 1 });
try {
  const data = {};
  for (const table of tables) data[table] = (await pool.query(`SELECT * FROM public.${table}`)).rows;
  const payload = JSON.stringify({ backupVersion: 1, createdAt: new Date().toISOString(), tables: data });
  const compressed = gzipSync(Buffer.from(payload));
  const salt = randomBytes(16); const iv = randomBytes(12); const key = scryptSync(process.env.BACKUP_ENCRYPTION_KEY, salt, 32); const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]); const tag = cipher.getAuthTag();
  const protectedBackup = Buffer.concat([Buffer.from('EAGB1'), salt, iv, tag, encrypted]);
  const folder = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'backups');
  await mkdir(folder, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z');
  const file = join(folder, `eletroagro-${stamp}.json.gz.enc`);
  await writeFile(file, protectedBackup, { flag: 'wx' });
  await writeFile(`${file}.sha256`, `${createHash('sha256').update(protectedBackup).digest('hex')}  ${file.split(/[\\/]/).at(-1)}\n`, { flag: 'wx' });
  console.log(`Backup criado e protegido por checksum: ${file}`);
} catch (error) { console.error('Falha ao criar backup:', error.message); process.exitCode = 1; }
finally { await pool.end(); }
