import { createLabelQrPng } from './generateLabelQr.js';
import { createLabelPrintPdf, LABEL_PRINT_LAYOUT } from './labelPrintPdf.js';
import printStyles from './print-label.css?raw';

export async function prepareLabelPrint(preview, { label, publicUrl, quantity }) {
  const qrDataUrl = createLabelQrPng(publicUrl);
  const pdf = await createLabelPrintPdf({ label, qrDataUrl, quantity });
  const pdfUrl = preview.URL.createObjectURL(pdf.output('blob'));
  const doc = preview.document;
  doc.documentElement.lang = 'pt-BR';
  doc.title = 'Impressão de etiquetas - EletroAgro';
  doc.body.replaceChildren();
  doc.head.querySelectorAll('style').forEach(style => style.remove());
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
  const frame = element('iframe', '', 'label-print-document');
  frame.title = 'PDF das etiquetas';
  const printButton = element('button', 'Imprimir etiquetas');
  printButton.type = 'button';
  printButton.disabled = true;
  const printError = element('p');
  printError.setAttribute('role', 'alert');
  printButton.addEventListener('click', () => {
    printError.textContent = '';
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } catch {
      printError.textContent = 'Não foi possível abrir a impressão. Use Baixar PDF para abrir e imprimir o documento.';
    }
  });

  const downloadLink = element('a', 'Baixar PDF');
  downloadLink.href = pdfUrl;
  downloadLink.download = `etiquetas-${label.public_id.slice(0, 12)}.pdf`;
  instructions.append(
    element('h1', 'Impressão de etiquetas'),
    element('p', `${quantity} etiqueta(s) de 50 × 50 mm. Cada página contém até duas etiquetas.`),
    element('p', `PDF preparado em ${LABEL_PRINT_LAYOUT.pageWidth} × ${LABEL_PRINT_LAYOUT.pageHeight} mm, sem cabeçalhos nem rodapés. Selecione sua impressora de etiquetas para imprimir.`),
    printButton,
    downloadLink,
    printError,
  );
  frame.addEventListener('load', () => { printButton.disabled = false; });
  frame.src = `${pdfUrl}#toolbar=0&navpanes=0&view=FitH`;
  const releaseDocument = () => preview.URL.revokeObjectURL(pdfUrl);
  preview.addEventListener('pagehide', releaseDocument, { once: true });
  doc.body.append(instructions, frame);
  return () => {
    preview.removeEventListener('pagehide', releaseDocument);
    releaseDocument();
  };
}
