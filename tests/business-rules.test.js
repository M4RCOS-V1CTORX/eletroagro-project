import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { operationsTestHelpers } from '../apps/api/src/routes/operations.js';
import { companyTestHelpers } from '../apps/api/src/routes/companies.js';

const { validDate, money, moneyText, quantity, shiftedDate } = operationsTestHelpers;

test('datas financeiras validam calendário real', () => {
  assert.equal(validDate('2024-02-29'), true);
  assert.equal(validDate('2025-02-29'), false);
  assert.equal(validDate('2026-13-01'), false);
});

test('valores monetários usam centavos sem ponto flutuante', () => {
  assert.equal(money('123.45'), 12345n);
  assert.equal(moneyText(12345n), '123.45');
  assert.equal(money('-1'), null);
  assert.equal(money('1.999'), null);
});

test('quantidades aceitam até três casas e rejeitam zero', () => {
  assert.equal(quantity('1.250'), 1250n);
  assert.equal(quantity('0'), null);
  assert.equal(quantity('1.0001'), null);
});

test('parcelas mensais respeitam o último dia do mês', () => {
  assert.equal(shiftedDate('2026-01-31', 1, 'month'), '2026-02-28');
  assert.equal(shiftedDate('2026-01-31', 2, 'month'), '2026-03-31');
  assert.equal(shiftedDate('2026-10-23', 1, 'week'), '2026-10-30');
});

test('permissões ausentes são seguras e compatíveis com membros antigos', () => {
  assert.deepEqual(companyTestHelpers.normalizePermissions({ finance: false }), { commercial: true, operations: true, finance: false, reports: true, audit: true });
});

test('PWA não persiste sessão nem respostas privadas no service worker', async () => {
  const worker = await readFile(new URL('../apps/web/public/service-worker.js', import.meta.url), 'utf8');
  assert.doesNotMatch(worker, /authorization/i);
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(worker, /manifest\.webmanifest/);
});

test('migração final cria recursos sem apagar tabelas existentes', async () => {
  const migration = await readFile(new URL('../apps/api/src/db/migrations/009_product_completion.sql', import.meta.url), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.receipts/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.service_order_attachments/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS permissions/);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE/i);
});
