import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

export const backupTables = ['companies','company_access_profiles','company_memberships','customers','catalog_items','suppliers','document_counters','sale_year_counters','transport_profiles','quotes','quote_items','quote_status_history','quote_versions','sales','sale_items','sale_payments','company_invitations','financial_entries','financial_payments','service_orders','service_order_items','appointments','stock_movements','purchases','purchase_items','receipts','service_order_attachments','notification_preferences','idempotency_keys','audit_logs'];

export function protectBackup(payload, password) {
  if (!password || password.length < 20) throw new Error('A chave do backup deve ter pelo menos 20 caracteres.');
  const salt = randomBytes(16), iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', scryptSync(password, salt, 32), iv);
  const encrypted = Buffer.concat([cipher.update(gzipSync(Buffer.from(JSON.stringify(payload)))), cipher.final()]);
  return Buffer.concat([Buffer.from('EAGB1'), salt, iv, cipher.getAuthTag(), encrypted]);
}

export function readProtectedBackup(buffer, password) {
  if (buffer.length < 50 || buffer.subarray(0, 5).toString() !== 'EAGB1') throw new Error('Formato de backup inválido.');
  const decipher = createDecipheriv('aes-256-gcm', scryptSync(password, buffer.subarray(5, 21), 32), buffer.subarray(21, 33));
  decipher.setAuthTag(buffer.subarray(33, 49));
  const payload = JSON.parse(gunzipSync(Buffer.concat([decipher.update(buffer.subarray(49)), decipher.final()])).toString('utf8'));
  validateBackup(payload);
  return payload;
}

export function validateBackup(payload) {
  if (payload?.backupVersion !== 1 || !payload.tables || typeof payload.tables !== 'object') throw new Error('Estrutura de backup inválida.');
  for (const table of backupTables) {
    // These tables were introduced after the original backup format.
    if (['sale_year_counters', 'transport_profiles','company_access_profiles'].includes(table) && payload.tables[table] === undefined) continue;
    if (!Array.isArray(payload.tables[table])) throw new Error(`Backup incompleto: tabela ${table} ausente.`);
    for (const row of payload.tables[table]) {
      if (!row || Array.isArray(row) || typeof row !== 'object' || !Object.keys(row).length || Object.keys(row).some(key => !/^[a-z][a-z0-9_]*$/.test(key))) throw new Error(`Registro inválido em ${table}.`);
    }
  }
}

// The caller supplies a dedicated client. No connection or production URL here.
export async function restoreBackup(client, payload) {
  validateBackup(payload);
  await client.query('BEGIN');
  try {
    await client.query(`TRUNCATE ${[...backupTables].reverse().map(table => `public.${table}`).join(', ')} CASCADE`);
    for (const table of backupTables) for (const source of payload.tables[table] || []) {
      const row = { ...source };
      if (table === 'sales' && row.sale_year == null) row.sale_year = Number(String(row.sale_date).slice(0, 4));
      const columns = Object.keys(row);
      await client.query(`INSERT INTO public.${table} (${columns.map(column => `"${column}"`).join(',')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(',')})`, columns.map(column => row[column]));
    }
    await client.query(`INSERT INTO public.sale_year_counters(company_id,sale_year,last_number)
      SELECT company_id,sale_year,MAX(sale_number) FROM public.sales GROUP BY company_id,sale_year
      ON CONFLICT(company_id,sale_year) DO UPDATE SET last_number=GREATEST(public.sale_year_counters.last_number,EXCLUDED.last_number)`);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}
