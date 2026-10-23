import 'dotenv/config';
import { createDecipheriv, scryptSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import pg from 'pg';

const file = process.argv.find((value) => value.endsWith('.json.gz.enc'));
const confirmed = process.argv.includes('--confirm=RESTORE');
if (!file || !confirmed) { console.error('Restauração bloqueada. Use: npm --prefix apps/api run db:restore -- <arquivo.json.gz.enc> --confirm=RESTORE'); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL não configurada.'); process.exit(1); }
if (!process.env.BACKUP_ENCRYPTION_KEY) { console.error('BACKUP_ENCRYPTION_KEY não configurada.'); process.exit(1); }
const order = ['companies','company_memberships','customers','catalog_items','suppliers','document_counters','quotes','quote_items','quote_status_history','quote_versions','sales','sale_items','sale_payments','company_invitations','financial_entries','financial_payments','service_orders','service_order_items','appointments','stock_movements','purchases','purchase_items','receipts','service_order_attachments','notification_preferences','idempotency_keys','audit_logs'];
const protectedBackup=await readFile(file);if(protectedBackup.subarray(0,5).toString()!=='EAGB1'){console.error('Formato de backup inválido.');process.exit(1);}const salt=protectedBackup.subarray(5,21);const iv=protectedBackup.subarray(21,33);const tag=protectedBackup.subarray(33,49);const encrypted=protectedBackup.subarray(49);const key=scryptSync(process.env.BACKUP_ENCRYPTION_KEY,salt,32);const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAuthTag(tag);
const payload = JSON.parse(gunzipSync(Buffer.concat([decipher.update(encrypted),decipher.final()])).toString('utf8'));
if (payload.backupVersion !== 1) { console.error('Versão de backup não suportada.'); process.exit(1); }
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false, max: 1 });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(`TRUNCATE ${[...order].reverse().map((table) => `public.${table}`).join(', ')} CASCADE`);
  for (const table of order) for (const row of payload.tables[table] || []) {
    const columns = Object.keys(row); const values = columns.map((column) => row[column]); const placeholders = columns.map((_, index) => `$${index + 1}`);
    await client.query(`INSERT INTO public.${table} (${columns.map((column) => `"${column}"`).join(',')}) VALUES (${placeholders.join(',')})`, values);
  }
  await client.query('COMMIT'); console.log('Restauração concluída com sucesso.');
} catch (error) { await client.query('ROLLBACK'); console.error('Falha na restauração; nenhuma alteração foi mantida:', error.message); process.exitCode = 1; }
finally { client.release(); await pool.end(); }
