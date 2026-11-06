import { createLabelQrPng } from './generateLabelQr.js';
import printStyles from './print-label.css?raw';

export async function prepareLabelPrint(preview, { label, publicUrl, quantity }) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
    throw new Error('Informe de 1 a 100 etiquetas por impressão.');
  }
  const doc = preview.document;
  doc.documentElement.lang = 'pt-BR';
  doc.title = 'Impressão de etiquetas — EletroAgro';
  doc.body.replaceChildren();
  const style = doc.createElement('style');
  style.textContent = printStyles;
  doc.head.append(style);

  function element(tag, text, className) {
    const node = doc.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  const instructions = element('header', '', 'print-instructions');
  instructions.append(element('h1', 'Impressão de etiquetas'),
    element('p', `${quantity} etiqueta(s) de 50 × 50 mm, em duas colunas separadas por 2 mm.`),
    element('p', 'Selecione a Zetex Z50X. Use escala 100% (tamanho real), sem margens e sem cabeçalhos/rodapés. Configure no driver a mídia para duas colunas: faixa de 102 mm mais as margens laterais reais do suporte, altura de 50 mm e intervalo entre fileiras conforme a bobina.'),
    element('p', 'Imprima primeiro duas etiquetas para conferir o alinhamento e a leitura do QR Code. Se o navegador mostrar A4, ajuste o tamanho personalizado nas preferências da impressora antes de imprimir.'));
  const printButton = element('button', 'Imprimir etiquetas');
  printButton.type = 'button';
  printButton.disabled = true;
  printButton.addEventListener('click', () => { preview.focus(); preview.print(); });
  instructions.append(printButton);
  doc.body.append(instructions);

  const qr = createLabelQrPng(publicUrl);
  const date = new Intl.DateTimeFormat('pt-BR').format(new Date(`${String(label.harvest_date).slice(0, 10)}T12:00:00`));
  const images = [];
  for (let index = 0; index < quantity; index += 2) {
    const row = element('section', '', 'print-label-row');
    for (let column = 0; column < 2; column++) {
      const cell = element('article', '', 'print-label');
      if (index + column < quantity) {
        const image = element('img');
        image.src = qr;
        image.alt = `QR Code de ${label.product_name}`;
        images.push(image);
        cell.append(element('strong', label.product_name), image, element('span', `Colheita: ${date}`));
      } else {
        cell.setAttribute('aria-label', 'Posição sem impressão');
      }
      row.append(cell);
    }
    doc.body.append(row);
  }
  await Promise.all(images.map(image => image.decode()));
  printButton.disabled = false;
}
