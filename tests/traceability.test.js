import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createTraceabilityRouter } from '../apps/api/src/routes/traceability.js';
import { createPublicTraceabilityRouter } from '../apps/api/src/routes/public-traceability.js';
import { createRequestPool } from '../apps/api/src/lib/request-pool.js';
import { requireDatabase } from '../apps/api/src/middleware/neon-auth.js';
import { normalizePolicy } from '../shared/access-policy.js';

const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const express = require('express');

test('cadastros de rastreamento validam vínculos, isolamento, permissões, revisão e reenvio', async () => {
  const db = new PGlite();
  let server;
  try {
    for (const name of (await readdir(new URL('../apps/api/src/db/migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort()) {
      await db.exec(await readFile(new URL(`../apps/api/src/db/migrations/${name}`, import.meta.url), 'utf8'));
    }
    const company = (await db.query("INSERT INTO companies(name) VALUES('Rastreamento') RETURNING id")).rows[0].id;
    const other = (await db.query("INSERT INTO companies(name) VALUES('Outra empresa') RETURNING id")).rows[0].id;
    const viewer = normalizePolicy({ modules: { traceability: { view: true } } });
    const denied = normalizePolicy({ modules: {} });
    for (const [subject, companyId, role, policy] of [['owner', company, 'owner', {}], ['other', other, 'owner', {}], ['viewer', company, 'member', viewer], ['denied', company, 'member', denied], ['legacy-denied', company, 'member', { operations: false }]]) {
      await db.query('INSERT INTO company_memberships(company_id,auth_issuer,auth_subject,role,permissions) VALUES($1,\'test\',$2,$3,$4::jsonb)', [companyId, subject, role, JSON.stringify(policy)]);
    }
    const query = async (...args) => { const result = await db.query(...args); return { ...result, rowCount: result.rows.length || result.affectedRows || 0 }; };
    const pool = createRequestPool({ query, connect: async () => ({ query, release() {} }) });
    const app = express();
    app.use(express.json());
    app.use('/api/public/traceability', createPublicTraceabilityRouter({ pool, requireDatabase }));
    app.use('/api/traceability', createTraceabilityRouter({ pool, requireDatabase, requireAuth: (req, res, next) => {
      if (req.get('x-user') === 'anonymous') return res.status(401).json({});
      req.auth = { issuer: 'test', subject: req.get('x-user') || 'owner' }; next();
    } }));
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/traceability`;
    async function call(path, body, status = 200, user = 'owner', method = body ? 'POST' : 'GET', key) {
      const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'x-user': user, ...(key ? { 'X-Idempotency-Key': key } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = await response.json();
      assert.equal(response.status, status, JSON.stringify(result)); return result;
    }
    await call('/producers', null, 401, 'anonymous');
    await call('/producers', { name: 'A' }, 400);
    const key = randomUUID();
    const a = (await call('/producers', { name: 'Ana' }, 201, 'owner', 'POST', key)).producer;
    assert.equal((await call('/producers', { name: 'Ana' }, 201, 'owner', 'POST', key)).producer.id, a.id);
    const b = (await call('/producers', { name: 'Bruno' }, 201)).producer;
    const foreign = (await call('/producers', { name: 'Outro' }, 201, 'other')).producer;
    await call('/properties', { name: 'Fazenda', producerIds: [] }, 400);
    await call('/properties', { name: 'Fazenda', producerIds: [a.id, foreign.id] }, 400);
    assert.equal((await call('/properties')).pagination.total, 0);
    const property = (await call('/properties', { name: 'Fazenda', producerIds: [a.id, b.id, a.id] }, 201)).property;
    assert.equal(property.producer_ids.length, 2);
    await call('/properties', { name: 'Segunda fazenda', producerIds: [a.id] }, 201);
    assert.equal((await call('/properties')).pagination.total, 2);
    const product = (await db.query("INSERT INTO catalog_items(company_id,item_type,name,unit) VALUES($1,'product','Banana','kg') RETURNING id", [company])).rows[0];
    const service = (await db.query("INSERT INTO catalog_items(company_id,item_type,name,unit) VALUES($1,'service','Serviço','h') RETURNING id", [company])).rows[0];
    const foreignProduct = (await db.query("INSERT INTO catalog_items(company_id,item_type,name,unit) VALUES($1,'product','Outro produto','kg') RETURNING id", [other])).rows[0];
    const harvestBody = { productId: product.id, propertyId: property.id, producerIds: [a.id, b.id], harvestDate: '2026-11-04' };
    const harvestKey = randomUUID();
    const harvest = (await call('/harvests', harvestBody, 201, 'owner', 'POST', harvestKey)).harvest;
    assert.equal(harvest.producers.length, 2);
    assert.match(harvest.public_id, /^[a-f0-9]{64}$/);
    assert.equal((await call('/harvests', harvestBody, 201, 'owner', 'POST', harvestKey)).harvest.id, harvest.id);
    assert.equal((await call('/harvests')).pagination.total, 1);
    for (const invalid of [{ harvestDate: '2026-02-30' }, { harvestDate: '' }, { producerIds: [] }, { producerIds: [foreign.id] }, { productId: foreignProduct.id }, { productId: service.id }]) {
      await call('/harvests', { ...harvestBody, ...invalid }, 400);
    }
    await call('/harvests', harvestBody, 403, 'viewer');
    await call('/harvests', null, 403, 'denied');
    assert.equal((await call('/harvests', null, 200, 'other')).pagination.total, 0);
    const products = (await call('/harvest-products')).products;
    assert.deepEqual(products.map(row => row.id), [product.id]);
    assert.deepEqual(Object.keys(products[0]).sort(), ['id', 'name']);
    assert.equal((await call('/properties', null, 200, 'other')).pagination.total, 0);
    await call(`/properties/${property.id}`, { name: 'Inválido', revision: 1, producerIds: [foreign.id] }, 400, 'owner', 'PATCH');
    const updated = (await call(`/properties/${property.id}`, { name: 'Fazenda editada', revision: 1, producerIds: [b.id] }, 200, 'owner', 'PATCH')).property;
    assert.equal(updated.revision, 2);
    await call(`/properties/${property.id}`, { name: 'Conflito', revision: 1, producerIds: [a.id] }, 409, 'owner', 'PATCH');
    assert.deepEqual((await call('/properties?q=editada')).properties[0].producer_ids, [b.id]);
    await call(`/producers/${a.id}`, { name: 'Intruso', revision: 1 }, 404, 'other', 'PATCH');
    await call('/producers', null, 403, 'denied');
    await call('/producers', null, 403, 'legacy-denied');
    await call('/producers', null, 200, 'viewer');
    await call('/producers', { name: 'Sem permissão' }, 403, 'viewer');
    await call(`/producers/${a.id}`, { name: 'Sem permissão', revision: 1 }, 403, 'viewer', 'PATCH');
    assert.equal((await call(`/producers/${a.id}`, { name: 'Ana editada', revision: 1 }, 200, 'owner', 'PATCH')).producer.revision, 2);
    const savedHarvest = (await call('/harvests')).harvests[0];
    assert.equal(savedHarvest.property_name, 'Fazenda');
    assert(savedHarvest.producers.some(producer => producer.name === 'Ana'));
    assert.equal(savedHarvest.public_id, harvest.public_id);
    assert.equal((await call('/harvests?offset=100')).pagination.total, 1);
    const labelBody = { productName: 'Manga', propertyName: 'Sítio novo', producerNames: [' Alice ', 'Carlos'], harvestDate: '2026-11-05' };
    const labelKey = randomUUID();
    const label = (await call('/labels', labelBody, 201, 'owner', 'POST', labelKey)).label;
    assert.match(label.public_id, /^[a-f0-9]{64}$/);
    assert.equal((await call('/labels', labelBody, 201, 'owner', 'POST', labelKey)).label.id, label.id);
    const history = await call('/labels');
    assert.equal(history.pagination.total, 2);
    assert(history.labels.some(row => row.id === harvest.id && row.property_name === 'Fazenda'));
    assert.deepEqual(history.labels.find(row => row.id === label.id).producers.map(row => row.name), ['Alice', 'Carlos']);
    async function publicCall(id, status = 200) {
      const response = await fetch(`${base.replace('/api/traceability', '/api/public/traceability')}/${id}`);
      assert.equal(response.status, status);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
      return response.json();
    }
    const publicLabel = await publicCall(label.public_id);
    assert.deepEqual(publicLabel, { harvest: { product: 'Manga', property: 'Sítio novo', producers: ['Alice', 'Carlos'], harvestDate: '2026-11-05' } });
    assert.equal(history.labels.find(row => row.id === label.id).editable, true);
    assert.equal(history.labels.find(row => row.id === harvest.id).editable, false);
    const original = { ...labelBody, producerNames: ['Alice', 'Carlos'] };
    const correction = { productName: 'Manga corrigida', propertyName: 'Sítio corrigido', producerNames: ['Daniela'], harvestDate: '2026-11-06' };
    const editBody = { ...correction, original };
    const editPath = `/labels/${label.public_id}`;
    await call(editPath, editBody, 403, 'viewer', 'PATCH');
    await call(editPath, editBody, 401, 'anonymous', 'PATCH');
    await call(editPath, editBody, 404, 'other', 'PATCH');
    await call(`/labels/${harvest.public_id}`, editBody, 404, 'owner', 'PATCH');
    await call(editPath, { ...editBody, harvestDate: '2026-02-30' }, 400, 'owner', 'PATCH');
    await call(editPath, { ...editBody, original: null }, 400, 'owner', 'PATCH');
    await db.exec("ALTER TABLE audit_logs ADD CONSTRAINT qa_reject_label_edit CHECK (action <> 'updated' OR entity_type <> 'traceability_label') NOT VALID");
    await call(editPath, editBody, 500, 'owner', 'PATCH');
    assert.deepEqual(await publicCall(label.public_id), publicLabel);
    await db.exec('ALTER TABLE audit_logs DROP CONSTRAINT qa_reject_label_edit');
    await call(editPath, editBody, 200, 'owner', 'PATCH');
    assert.deepEqual(await publicCall(label.public_id), { harvest: { product: correction.productName, property: correction.propertyName,
      producers: correction.producerNames, harvestDate: correction.harvestDate } });
    await call(editPath, editBody, 409, 'owner', 'PATCH');
    await call(editPath, { ...original, original: correction }, 200, 'owner', 'PATCH');
    assert.deepEqual(await publicCall(label.public_id), publicLabel);
    assert.equal((await call('/labels')).pagination.total, 2);
    const publicHarvest = await publicCall(harvest.public_id);
    assert.deepEqual(Object.keys(publicHarvest.harvest).sort(), ['harvestDate', 'producers', 'product', 'property']);
    assert.equal(publicHarvest.harvest.property, 'Fazenda');
    assert(publicHarvest.harvest.producers.includes('Ana'));
    await publicCall('invalid', 404);
    await publicCall('f'.repeat(64), 404);
    const listing = await fetch(base.replace('/api/traceability', '/api/public/traceability'));
    assert.equal(listing.status, 404);
    await db.query('UPDATE companies SET archived_at=now() WHERE id=$1', [company]);
    await publicCall(label.public_id, 404);
    await publicCall(harvest.public_id, 404);
    await db.query('UPDATE companies SET archived_at=NULL WHERE id=$1', [company]);
    assert.equal((await call('/producers')).pagination.total, 2);
    assert.equal((await call('/properties')).pagination.total, 2);
    assert.equal((await call('/labels', null, 200, 'other')).pagination.total, 0);
    await call('/labels', labelBody, 403, 'viewer');
    await call('/labels', null, 403, 'denied');
    for (const invalid of [{ productName: '' }, { propertyName: 'A' }, { harvestDate: '2026-02-30' }, { producerNames: [] }, { producerNames: [null] }, { producerNames: ['A'] }, { producerNames: Array(101).fill('Nome') }]) {
      await call('/labels', { ...labelBody, ...invalid }, 400);
    }
    await call('/labels?offset=-1', null, 400);
    assert.equal((await call('/labels?offset=100')).pagination.total, 2);
    await db.exec("ALTER TABLE traceability_labels ADD CONSTRAINT qa_reject_label CHECK (product_name <> 'Falha') NOT VALID");
    await call('/labels', { ...labelBody, productName: 'Falha' }, 500, 'owner', 'POST', randomUUID());
    assert.equal((await call('/labels')).pagination.total, 2);
    await db.exec('ALTER TABLE traceability_labels DROP CONSTRAINT qa_reject_label');
    await db.query(`INSERT INTO traceability_labels(company_id,product_name,property_name,producer_names,harvest_date,public_id)
      SELECT $1,'Produto '||i,'Propriedade','["Pessoa"]'::jsonb,'2026-11-05',repeat(md5(i::text),2) FROM generate_series(1,26) i`, [company]);
    const firstPage = await call('/labels');
    const secondPage = await call('/labels?offset=25');
    assert.equal(firstPage.labels.length, 25);
    assert.equal(secondPage.labels.length, 3);
    assert.equal(firstPage.pagination.total, 28);
    assert(!secondPage.labels.some(row => firstPage.labels.some(first => first.id === row.id)));
    for (const term of ['mAnGa', 'sítio', 'alice']) {
      const found = await call(`/labels?q=${encodeURIComponent(term)}`);
      assert.equal(found.pagination.total, 1);
      assert.equal(found.labels[0].id, label.id);
    }
    assert.equal((await call('/labels?q=ana')).labels[0].id, harvest.id);
    const filteredPage = await call('/labels?q=Pessoa&offset=25');
    assert.equal(filteredPage.pagination.total, 26);
    assert.equal(filteredPage.labels.length, 1);
    assert.equal((await call('/labels?q=Pessoa', null, 200, 'other')).pagination.total, 0);
    assert.equal((await call('/labels?q=nao-existe')).pagination.total, 0);
    for (const term of ['%', '_', "' OR 1=1 --"]) {
      assert.equal((await call(`/labels?q=${encodeURIComponent(term)}`)).pagination.total, 0);
    }
    assert.equal((await call('/labels?q=%20%20')).pagination.total, 28);
    await call(`/labels?q=${'a'.repeat(201)}`, null, 400);
    await call('/labels?q=one&q=two', null, 400);
    await call('/harvests', { ...harvestBody, producerIds: [a.id] }, 400);
    // Simulated database failure must roll back the harvest and idempotency record.
    await db.exec("ALTER TABLE traceability_harvest_producers ADD CONSTRAINT qa_reject_harvest CHECK (producer_name <> 'Bruno') NOT VALID");
    await call('/harvests', { ...harvestBody, producerIds: [b.id] }, 500, 'owner', 'POST', randomUUID());
    assert.equal((await call('/harvests')).pagination.total, 1);
    await db.exec('ALTER TABLE traceability_harvest_producers DROP CONSTRAINT qa_reject_harvest');
    assert.equal((await call('/producers?offset=100')).pagination.total, 2);
    await assert.rejects(db.query('INSERT INTO traceability_property_producers(company_id,property_id,producer_id) VALUES($1,$2,$3)', [company, property.id, foreign.id]));
    // Deletion is company-scoped, permission-checked, audited and revokes the public URL.
    await call(`/labels/${label.public_id}`, null, 403, 'viewer', 'DELETE');
    await call(`/labels/${label.public_id}`, null, 401, 'anonymous', 'DELETE');
    await call(`/labels/${label.public_id}`, null, 404, 'other', 'DELETE');
    await call('/labels/invalid', null, 400, 'owner', 'DELETE');
    await publicCall(label.public_id);
    await db.exec("ALTER TABLE audit_logs ADD CONSTRAINT qa_reject_label_delete CHECK (action <> 'deleted' OR entity_type <> 'traceability_label') NOT VALID");
    await call(`/labels/${label.public_id}`, null, 500, 'owner', 'DELETE');
    await publicCall(label.public_id);
    await db.exec('ALTER TABLE audit_logs DROP CONSTRAINT qa_reject_label_delete');
    await call(`/labels/${label.public_id}`, null, 200, 'owner', 'DELETE');
    await publicCall(label.public_id, 404);
    await call(`/labels/${label.public_id}`, null, 404, 'owner', 'DELETE');
    await call(`/labels/${harvest.public_id}`, null, 200, 'owner', 'DELETE');
    await publicCall(harvest.public_id, 404);
    assert.equal((await call('/labels')).pagination.total, 26);
    assert.equal((await db.query('SELECT count(*)::int AS total FROM traceability_harvest_producers WHERE harvest_id=$1', [harvest.id])).rows[0].total, 0);
    assert.equal((await call('/producers')).pagination.total, 2);
    assert.equal((await call('/properties')).pagination.total, 2);
    assert.equal((await call('/harvest-products')).products.length, 1);
    assert.equal((await db.query("SELECT count(*)::int AS total FROM audit_logs WHERE entity_type='traceability_label' AND action='deleted' AND company_id=$1", [company])).rows[0].total, 2);
    // Company deletion remains compatible: only its own traceability data cascades.
    await db.query('DELETE FROM audit_logs WHERE company_id=$1', [other]);
    await db.query('DELETE FROM catalog_items WHERE company_id=$1', [other]);
    await db.query('DELETE FROM company_memberships WHERE company_id=$1', [other]);
    await db.query('DELETE FROM companies WHERE id=$1', [other]);
    assert.equal((await call('/producers')).pagination.total, 2);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await db.close();
  }
});
