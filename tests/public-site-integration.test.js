import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createCorsOptions } from '../apps/api/src/lib/cors-policy.js';
import { PUBLIC_SITE_ORIGIN } from '../shared/public-site.js';

const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const express = require('express');
const cors = require('cors');

test('site público recebe CORS somente na consulta pública e sem credenciais', async () => {
  const adminOrigin = 'https://admin.example';
  const app = express();
  app.use(cors(createCorsOptions(new Set([adminOrigin]))));
  app.use((_request, response) => response.json({ fixture: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(path, origin, options = {}) {
    return fetch(base + path, { ...options, headers: { Origin: origin, ...options.headers } });
  }

  try {
    const publicResponse = await call('/api/public/traceability/invalido', PUBLIC_SITE_ORIGIN);
    assert.equal(publicResponse.headers.get('access-control-allow-origin'), PUBLIC_SITE_ORIGIN);
    assert.equal(publicResponse.headers.get('access-control-allow-credentials'), null);

    for (const path of ['/api/catalog', '/api/session', '/api/public/traceability-private']) {
      const response = await call(path, PUBLIC_SITE_ORIGIN);
      assert.equal(response.headers.get('access-control-allow-origin'), null);
    }

    const foreign = await call('/api/public/traceability/invalido', 'https://foreign.example');
    assert.equal(foreign.headers.get('access-control-allow-origin'), null);
    const admin = await call('/api/catalog', adminOrigin);
    assert.equal(admin.headers.get('access-control-allow-origin'), adminOrigin);

    const preflight = await call('/api/public/traceability/invalido', PUBLIC_SITE_ORIGIN, {
      method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'GET' },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-methods'), 'GET,HEAD,OPTIONS');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('compatibilidade aceita identificador público e mantém destino fixo', () => {
  const config = JSON.parse(readFileSync(new URL('../apps/web/vercel.json', import.meta.url), 'utf8'));
  const redirect = config.redirects.find(rule => rule.source.startsWith('/rastrear/'));
  assert.equal(redirect.destination, `${PUBLIC_SITE_ORIGIN}/rastrear/:publicId`);
  assert.equal(redirect.permanent, false);
  const pattern = new RegExp(`^${redirect.source.replace(':publicId', '')}$`);
  assert(pattern.test(`/rastrear/${'a'.repeat(64)}`));
  for (const path of ['/rastrear/123', '/rastrear/https://foreign.example', '/rastrear/../admin']) {
    assert.equal(pattern.test(path), false);
  }
});
