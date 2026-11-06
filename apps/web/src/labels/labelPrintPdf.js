export const LABEL_PRINT_LAYOUT = Object.freeze({
  pageWidth: 102,
  pageHeight: 50,
  labelWidth: 50,
  columnGap: 2,
  columns: 2,
  safeMargin: 4,
  titleY: 7,
  titleLineHeight: 3,
  qrY: 12,
  qrSize: 30,
  dateY: 45,
});

function titleLines(doc, productName) {
  const width = LABEL_PRINT_LAYOUT.labelWidth - LABEL_PRINT_LAYOUT.safeMargin * 2;
  const lines = doc.splitTextToSize(String(productName || '').trim(), width);
  if (lines.length <= 2) return lines;

  let lastLine = lines[1];
  while (lastLine.length && doc.getTextWidth(`${lastLine}...`) > width) {
    lastLine = lastLine.slice(0, -1);
  }
  return [lines[0], `${lastLine.trimEnd()}...`];
}

export async function createLabelPrintPdf({ label, qrDataUrl, quantity }) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
    throw new Error('Informe de 1 a 100 etiquetas por impressão.');
  }

  const { jsPDF } = await import('jspdf');
  const layout = LABEL_PRINT_LAYOUT;
  const pageFormat = [layout.pageWidth, layout.pageHeight];
  const doc = new jsPDF({ unit: 'mm', format: pageFormat, orientation: 'landscape', compress: true });
  doc.setProperties({ title: 'Etiquetas de origem - EletroAgro' });
  doc.viewerPreferences({ PrintScaling: 'None', PickTrayByPDFSize: true });
  const date = new Intl.DateTimeFormat('pt-BR').format(
    new Date(`${String(label.harvest_date).slice(0, 10)}T12:00:00`),
  );

  for (let index = 0; index < quantity; index++) {
    const column = index % layout.columns;
    if (index > 0 && column === 0) doc.addPage(pageFormat, 'landscape');
    const columnX = column * (layout.labelWidth + layout.columnGap);
    const centerX = columnX + layout.labelWidth / 2;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(titleLines(doc, label.product_name), centerX, layout.titleY, {
      align: 'center',
      lineHeightFactor: layout.titleLineHeight / (8 * 25.4 / 72),
    });
    doc.addImage(qrDataUrl, 'PNG', centerX - layout.qrSize / 2, layout.qrY,
      layout.qrSize, layout.qrSize, 'label-qr');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(`Colheita: ${date}`, centerX, layout.dateY, { align: 'center' });
  }

  return doc;
}
