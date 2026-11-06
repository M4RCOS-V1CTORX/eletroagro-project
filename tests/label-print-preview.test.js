import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../apps/web/src/labels/LabelCodeActions.jsx', import.meta.url), 'utf8');
const handler = source.match(/  function previewPrint\(event\) \{([\s\S]*?)\n  \}/)[1];

test('prévia abre no sistema mesmo quando o navegador bloqueia novas janelas', () => {
  const label = { public_id: 'a'.repeat(64), product_name: 'Produto fictício' };
  const publicUrl = `https://origem.example/rastrear/${label.public_id}`;
  let request = null;
  let error = 'erro anterior';
  let prevented = false;
  const context = {
    label,
    publicUrl,
    quantity: '3',
    event: { preventDefault() { prevented = true; } },
    setError(value) { error = value; },
    setPrintRequest(update) { request = update(request); },
    window: { open() { assert.fail('A prévia não deve abrir um pop-up.'); } },
  };

  runInNewContext(handler, context);
  assert.equal(prevented, true);
  assert.equal(error, '');
  assert.equal(request.label, label);
  assert.equal(request.publicUrl, publicUrl);
  assert.equal(request.quantity, 3);
  assert.equal(request.revision, 1);

  runInNewContext(handler, context);
  assert.equal(request.revision, 2);
});
