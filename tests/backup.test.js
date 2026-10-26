import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readdir,readFile} from 'node:fs/promises';
import {backupTables,protectBackup,readProtectedBackup,restoreBackup} from '../apps/api/src/lib/backup.js';
const password='somente-teste-chave-temporaria-2026';
test('backup criptografado restaura banco isolado e reverte restauração inválida',async()=>{
 const db=new PGlite();try{
  for(const name of (await readdir(new URL('../apps/api/src/db/migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort())await db.exec(await readFile(new URL(`../apps/api/src/db/migrations/${name}`,import.meta.url),'utf8'));
  const company=(await db.query("INSERT INTO companies(name) VALUES('Empresa de recuperação') RETURNING id")).rows[0].id;
  await db.query("INSERT INTO company_memberships(company_id,auth_issuer,auth_subject,role) VALUES($1,'test','recovery','owner')",[company]);
  await db.query("INSERT INTO sales(company_id,sale_year,sale_number,customer_name,sale_date,payment_method,payment_status,subtotal,total,amount_paid,created_by_subject) VALUES($1,2026,9,'Cliente preservado','2026-10-26','pix','pending',123.45,123.45,0,'recovery')",[company]);
  const tables={};for(const table of backupTables)tables[table]=(await db.query(`SELECT * FROM public.${table}`)).rows;
  const payload=JSON.parse(JSON.stringify({backupVersion:1,createdAt:new Date().toISOString(),tables}));
  const encrypted=protectBackup(payload,password);assert(!encrypted.includes(Buffer.from('Cliente preservado')));
  assert.throws(()=>readProtectedBackup(encrypted,'senha-incorreta'));
  const damaged=Buffer.from(encrypted);damaged[damaged.length-1]^=1;assert.throws(()=>readProtectedBackup(damaged,password));
  await db.query("UPDATE companies SET name='Alteração temporária'");
  await restoreBackup(db,readProtectedBackup(encrypted,password));
  assert.equal((await db.query('SELECT name FROM companies')).rows[0].name,'Empresa de recuperação');
  assert.equal((await db.query('SELECT total FROM sales')).rows[0].total,'123.45');
  assert.equal(String((await db.query('SELECT last_number FROM sale_year_counters')).rows[0].last_number),'9');
  const incomplete=structuredClone(payload);delete incomplete.tables.sales;await assert.rejects(()=>restoreBackup(db,incomplete),/incompleto/);
  const invalid=structuredClone(payload);invalid.tables.sales[0].total='999.00';await assert.rejects(()=>restoreBackup(db,invalid));
  assert.equal((await db.query('SELECT total FROM sales')).rows[0].total,'123.45');
 }finally{await db.close();}
});
