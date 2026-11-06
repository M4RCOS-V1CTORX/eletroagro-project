import test from 'node:test';
import assert from 'node:assert/strict';
import { createLabelPrintPdf } from '../apps/web/src/labels/labelPrintPdf.js';

const qrDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
const label = { product_name: 'BANANA PRATA', harvest_date: '2026-11-06' };

test('PDF térmico mantém páginas de 102 × 50 mm e a quantidade exata de etiquetas', async () => {
  for (const quantity of [1, 2, 3, 100]) {
    const doc = await createLabelPrintPdf({ label, qrDataUrl, quantity });
    assert.equal(doc.getNumberOfPages(), Math.ceil(quantity / 2));
    let printedLabels = 0;
    for (let page = 1; page <= doc.getNumberOfPages(); page++) {
      doc.setPage(page);
      assert(Math.abs(doc.internal.pageSize.getWidth() - 102) < 0.01);
      assert(Math.abs(doc.internal.pageSize.getHeight() - 50) < 0.01);
      const content = doc.internal.pages[page].join('\n');
      const images = content.match(/\/I\d+ Do/g) || [];
      printedLabels += images.length;
      assert.equal(images.length, Math.min(2, quantity - (page - 1) * 2));
      assert(content.includes('BANANA PRATA'));
      assert(content.includes('Colheita: 06/11/2026'));
      assert(!content.includes('about:blank'));
      assert(!content.includes('1/1'));
    }
    assert.equal(printedLabels, quantity);
    assert(doc.output().includes('/PrintScaling /None'));
    assert(doc.output().includes('/PickTrayByPDFSize true'));
  }
});

test('nome extenso é abreviado sem aumentar a altura da etiqueta', async () => {
  const doc = await createLabelPrintPdf({
    label: { ...label, product_name: 'Produto com nome muito extenso '.repeat(8) },
    qrDataUrl,
    quantity: 2,
  });
  assert.equal(doc.getNumberOfPages(), 1);
  assert(doc.internal.pages[1].join('\n').includes('...'));
});

test('quantidades fora do limite não geram documento de impressão', async () => {
  for (const quantity of [0, -1, 1.5, 101, NaN, '2']) {
    await assert.rejects(createLabelPrintPdf({ label, qrDataUrl, quantity }), /1 a 100/);
  }
});
