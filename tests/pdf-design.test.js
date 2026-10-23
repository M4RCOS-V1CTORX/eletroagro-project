import test from 'node:test';
import assert from 'node:assert/strict';
import { addContainedImage, createPdfPalette, drawPdfFooters, formatPdfCurrency, pdfAccent } from '../apps/web/src/pdfDesign.js';

test('identidade de PDF respeita a cor configurada e formata moeda', () => {
  assert.deepEqual(pdfAccent('#176da3'), [23, 109, 163]);
  assert.deepEqual(createPdfPalette({ document_settings: { accentColor: '#287f65' } }).accent, [40, 127, 101]);
  assert.match(formatPdfCurrency(1234.5), /1\.234,50/);
});

test('logo mantém proporção dentro da área reservada', () => {
  let placement;
  const doc = { addImage: (...args) => { placement = args.slice(2); } };
  addContainedImage(doc, { data: 'data:image/jpeg;base64,AA==', format: 'JPEG', width: 400, height: 200 }, { x: 10, y: 8, width: 28, height: 28 });
  const [x, y, width, height] = placement;
  assert(Math.abs(width - 28) < 1e-9); assert(Math.abs(height - 14) < 1e-9); assert(Math.abs(x - 10) < 1e-9); assert(Math.abs(y - 15) < 1e-9);
});

test('rodapé numera todas as páginas no formato Página X de Y', () => {
  const texts = [];
  const doc = {
    getNumberOfPages: () => 3, setPage: () => {}, setDrawColor: () => {}, line: () => {}, setFont: () => {}, setFontSize: () => {}, setTextColor: () => {},
    splitTextToSize: (value) => [value], text: (value) => texts.push(String(value)),
  };
  drawPdfFooters(doc, { company: { name: 'EletroAgro', document_settings: {} }, text: 'Documento de validação' });
  assert(texts.includes('Página 1 de 3')); assert(texts.includes('Página 2 de 3')); assert(texts.includes('Página 3 de 3'));
});
