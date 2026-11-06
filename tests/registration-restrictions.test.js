import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createCompaniesRouter } from '../apps/api/src/routes/companies.js';
import { canCreateCompany } from '../apps/api/src/lib/company-admission.js';
import proxyHandler from '../apps/web/api/neon-auth.js';

test('criação de empresa exige liberação explícita no servidor', async () => {
  const environment = { COMPANY_CREATION_ALLOWED_EMAILS: ' admin@example.com, autorizado@example.com ' };
  assert.equal(canCreateCompany({ email: 'ADMIN@example.com' }, environment), true);
  assert.equal(canCreateCompany({ email: 'outro@example.com' }, environment), false);
  assert.equal(canCreateCompany({ email: 'admin@example.com' }, {}), false);
  assert.equal(canCreateCompany({}, environment), false);

  const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
  const express = require('express');
  const app = express();
  let databaseTouched = false;
  const pool = { query() { databaseTouched = true; throw new Error('Unexpected query'); } };
  app.use(express.json());
  app.use('/api/company', createCompaniesRouter({
    pool,
    environment: {},
    requireAuth(request, _response, next) {
      request.auth = { email: 'desconhecido@example.com', issuer: 'test', subject: 'unknown' };
      next();
    },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/company`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Empresa não autorizada' }),
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'COMPANY_CREATION_RESTRICTED');
    assert.equal(databaseTouched, false);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

function proxyResponse() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader() {},
    end(body) { this.body = body; },
  };
}

test('proxy bloqueia cadastro direto, reescrito e codificado antes de chamar o Neon', async () => {
  for (const request of [
    { url: '/neon-auth/sign-up/email' },
    { url: '/api/neon-auth', query: { __neonAuthPath: 'sign-up/email' } },
    { url: '/api/neon-auth', query: { path: ['sign-up', 'email'] } },
    { url: '/neon-auth/%73ign-up/email' },
    { url: '/neon-auth/sign-up%2Femail' },
  ]) {
    const response = proxyResponse();
    await proxyHandler({ ...request, method: 'POST', headers: {}, body: {} }, response);
    assert.equal(response.statusCode, 403);
    assert.equal(response.body.code, 'REGISTRATION_DISABLED');
  }
  const response = proxyResponse();
  await proxyHandler({ url: '/neon-auth/%zz', headers: {} }, response);
  assert.equal(response.statusCode, 400);
});

test('proxy mantém entrada e recuperação das contas existentes', async () => {
  const originalFetch = globalThis.fetch;
  const paths = [];
  globalThis.fetch = async (url) => {
    paths.push(new URL(url).pathname);
    return new Response('{}', { status: 200 });
  };
  try {
    for (const path of ['sign-in/email', 'request-password-reset', 'get-session']) {
      const response = proxyResponse();
      await proxyHandler({ url: '/neon-auth/' + path, method: 'POST', headers: {}, body: {} }, response);
      assert.equal(response.statusCode, 200);
      assert.equal(paths.at(-1), '/neondb/auth/' + path);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
