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
  const producer=(await db.query("INSERT INTO traceability_producers(company_id,name) VALUES($1,'Produtor preservado') RETURNING id",[company])).rows[0].id;
  const property=(await db.query("INSERT INTO traceability_properties(company_id,name) VALUES($1,'Propriedade preservada') RETURNING id",[company])).rows[0].id;
  await db.query('INSERT INTO traceability_property_producers(company_id,property_id,producer_id) VALUES($1,$2,$3)',[company,property,producer]);
  const harvest=(await db.query("INSERT INTO traceability_harvests(company_id,product_id,product_name,property_id,property_name,harvest_date,public_id) VALUES($1,gen_random_uuid(),'Banana',$2,'Propriedade preservada','2026-11-04',$3) RETURNING id",[company,property,'a'.repeat(64)])).rows[0].id;
  await db.query("INSERT INTO traceability_harvest_producers(company_id,harvest_id,producer_id,producer_name) VALUES($1,$2,$3,'Produtor preservado')",[company,harvest,producer]);
  await db.query("INSERT INTO traceability_labels(company_id,product_name,property_name,producer_names,harvest_date,public_id) VALUES($1,'Manga','Sítio','[\"Alice\",\"Carlos\"]'::jsonb,'2026-11-05',$2)",[company,'b'.repeat(64)]);
  const tables={};for(const table of backupTables)tables[table]=(await db.query(`SELECT * FROM public.${table}`)).rows;
  const payload=JSON.parse(JSON.stringify({backupVersion:1,createdAt:new Date().toISOString(),tables}));
  const encrypted=protectBackup(payload,password);assert(!encrypted.includes(Buffer.from('Cliente preservado')));
  assert.throws(()=>readProtectedBackup(encrypted,'senha-incorreta'));
  const damaged=Buffer.from(encrypted);damaged[damaged.length-1]^=1;assert.throws(()=>readProtectedBackup(damaged,password));
  await db.query("UPDATE companies SET name='Alteração temporária'");
  await restoreBackup(db,readProtectedBackup(encrypted,password));
  assert.equal((await db.query('SELECT name FROM companies')).rows[0].name,'Empresa de recuperação');
  assert.equal((await db.query('SELECT total FROM sales')).rows[0].total,'123.45');
  assert.equal((await db.query('SELECT name FROM traceability_producers')).rows[0].name,'Produtor preservado');
  assert.equal((await db.query('SELECT producer_id FROM traceability_property_producers')).rows[0].producer_id,producer);
  assert.equal((await db.query('SELECT public_id FROM traceability_harvests')).rows[0].public_id,'a'.repeat(64));
  assert.equal((await db.query('SELECT producer_name FROM traceability_harvest_producers')).rows[0].producer_name,'Produtor preservado');
  assert.deepEqual((await db.query('SELECT producer_names FROM traceability_labels')).rows[0].producer_names,['Alice','Carlos']);
  assert.equal(String((await db.query('SELECT last_number FROM sale_year_counters')).rows[0].last_number),'9');
  const incomplete=structuredClone(payload);delete incomplete.tables.sales;await assert.rejects(()=>restoreBackup(db,incomplete),/incompleto/);
  const invalid=structuredClone(payload);invalid.tables.sales[0].total='999.00';await assert.rejects(()=>restoreBackup(db,invalid));
  assert.equal((await db.query('SELECT total FROM sales')).rows[0].total,'123.45');
 }finally{await db.close();}
});

test('backup anterior ao rastreamento restaura antes da migração 016',async()=>{
 const db=new PGlite();try{
  for(const name of (await readdir(new URL('../apps/api/src/db/migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')&&n<'016').sort())await db.exec(await readFile(new URL(`../apps/api/src/db/migrations/${name}`,import.meta.url),'utf8'));
  await db.query("INSERT INTO companies(name) VALUES('Empresa anterior')");
  const tables={};for(const table of backupTables.filter(name=>!name.startsWith('traceability_')))tables[table]=(await db.query(`SELECT * FROM public.${table}`)).rows;
  const payload=JSON.parse(JSON.stringify({backupVersion:1,tables}));
  await restoreBackup(db,payload);
  assert.equal((await db.query('SELECT name FROM companies')).rows[0].name,'Empresa anterior');
  payload.tables.traceability_producers=[{name:'Dado novo'}];
  await assert.rejects(()=>restoreBackup(db,payload),/migração de rastreamento/);
  assert.equal((await db.query('SELECT name FROM companies')).rows[0].name,'Empresa anterior');
 }finally{await db.close();}
});
