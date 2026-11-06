import test from 'node:test';
import assert from 'node:assert/strict';
import { publicOriginUrl, isLocalOrigin } from '../apps/web/src/labels/publicOrigin.js';

const id = 'a'.repeat(64);

test('endereço público usa domínio configurado e preserva o identificador', () => {
  assert.equal(publicOriginUrl(id, { configuredOrigin: 'https://origem.example', currentOrigin: 'http://localhost:5173', production: true }), `https://origem.example/rastrear/${id}`);
  assert.equal(publicOriginUrl(id, { currentOrigin: 'http://localhost:5173', production: false }), `http://localhost:5173/rastrear/${id}`);
  assert.equal(publicOriginUrl(id, { configuredOrigin: '', currentOrigin: 'https://preview.example', production: true }), `https://eletroagro-project.vercel.app/rastrear/${id}`);
});

test('códigos inválidos, credenciais, caminhos e origens impróprias são recusados', () => {
  assert.throws(() => publicOriginUrl('../outro', { currentOrigin: 'https://example.com' }), /identificador/);
  for (const origin of ['javascript:alert(1)', 'https://user:password@example.com', 'https://example.com/caminho', 'https://example.com/?chave=valor']) {
    assert.throws(() => publicOriginUrl(id, { configuredOrigin: origin }), /endereço público/);
  }
  for (const origin of ['http://example.com', 'http://localhost:5173', 'https://127.0.0.1', 'https://[::1]']) {
    assert.throws(() => publicOriginUrl(id, { configuredOrigin: origin, production: true }), /HTTPS público/);
  }
  assert.equal(isLocalOrigin('http://localhost:5173'), true);
  assert.equal(isLocalOrigin('https://example.com'), false);
});
