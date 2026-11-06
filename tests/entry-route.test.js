import test from 'node:test';
import assert from 'node:assert/strict';
import { entryRoute } from '../apps/web/src/entryRoute.js';

const origin = 'https://eletroagro-project.vercel.app';

test('remover partes do endereço público não abre o aplicativo', () => {
  for (const path of ['/', '/rastre', '/desconhecido']) {
    assert.equal(entryRoute(new URL(path, origin)).page, 'public-home');
  }
  assert.deepEqual(entryRoute(new URL('/rastrear/abc', origin)), { page: 'public-record', publicId: 'abc' });
  assert.deepEqual(entryRoute(new URL('/rastrear', origin)), { page: 'public-record', publicId: '' });
  assert.equal(entryRoute(new URL('/app', origin)).page, 'application');
  assert.equal(entryRoute(new URL('/app/', origin)).page, 'application');
});

test('convites e recuperação antigos preservam os parâmetros sem redirecionamento externo', () => {
  for (const search of ['?invite=abc', '?token=abc&redirect=https://example.com']) {
    assert.deepEqual(entryRoute(new URL('/' + search, origin)), {
      page: 'redirect',
      destination: '/app' + search,
    });
  }
  assert.equal(entryRoute(new URL('/?redirect=/app', origin)).page, 'public-home');
  assert.equal(entryRoute(new URL('/previa-rastreamento', origin)).page, 'public-home');
  assert.equal(entryRoute(new URL('/previa-rastreamento', origin), { development: true }).page, 'preview');
});
