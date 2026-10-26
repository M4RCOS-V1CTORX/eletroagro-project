const DEFAULT_ACCENT = [23, 109, 163];
const LOGO_URL = '/logo-eletroagro.jpeg';

export const PDF_PAGE = { width: 210, height: 297, margin: 16, contentBottom: 273, footerTop: 280 };

export function pdfAccent(value, fallback = DEFAULT_ACCENT) {
  const match = /^#([0-9a-f]{6})$/i.exec(value || '');
  return match ? [0, 2, 4].map((index) => Number.parseInt(match[1].slice(index, index + 2), 16)) : fallback;
}

export function createPdfPalette(company) {
  return {
    accent: pdfAccent(company?.document_settings?.accentColor), navy: [8, 54, 82], green: [42, 132, 103], gold: [194, 158, 25], red: [174, 77, 57],
    ink: [28, 48, 61], muted: [99, 117, 128], pale: [244, 248, 250], line: [222, 231, 235], white: [255, 255, 255],
  };
}

export const formatPdfCurrency = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0)).replace(/[\u00a0\u202f]/g, ' ');
export const formatPdfDate = (value) => value ? new Intl.DateTimeFormat('pt-BR').format(new Date(`${String(value).slice(0, 10)}T12:00:00`)) : 'Não informado';

let logoPromise;
export async function loadPdfLogo() {
  if (!logoPromise) logoPromise = (async () => {
    try {
      const response = await fetch(LOGO_URL); if (!response.ok) return null;
      const blob = await response.blob();
      const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
      const image = new Image(); image.src = data; await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
      return { data, width: image.naturalWidth, height: image.naturalHeight, format: 'JPEG' };
    } catch { return null; }
  })();
  return logoPromise;
}

export function addContainedImage(doc, image, box) {
  if (!image?.data || !image.width || !image.height) return;
  const ratio = Math.min(box.width / image.width, box.height / image.height);
  const width = image.width * ratio; const height = image.height * ratio;
  doc.addImage(image.data, image.format || 'JPEG', box.x + (box.width - width) / 2, box.y + (box.height - height) / 2, width, height);
}

export function drawPdfHeader(doc, { company, title, number = '', numberPrefix = 'Nº ', subtitle = '', status = '', palette = createPdfPalette(company), logo = null, compact = false }) {
  const { width, margin } = PDF_PAGE; const height = compact ? 24 : 43;
  doc.setFillColor(...palette.white); doc.rect(0, 0, width, height, 'F'); doc.setFillColor(...palette.accent); doc.rect(0, 0, width, 2.2, 'F');
  if (compact) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...palette.navy); doc.text(company?.name || 'EletroAgro', margin, 12);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...palette.muted); doc.text(`${title}${number ? `  ${numberPrefix}${number}` : ''}`, width - margin, 12, { align: 'right' });
    doc.setDrawColor(...palette.line); doc.line(margin, 18, width - margin, 18); return 27;
  }
  addContainedImage(doc, logo, { x: margin, y: 6, width: 27, height: 27 });
  const brandX = logo ? 48 : margin; const companyName = String(company?.name || 'EletroAgro');
  const brandWidth=logo?58:86;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(companyName.length > 26 ? 11 : 14); doc.setTextColor(...palette.navy); doc.text(doc.splitTextToSize(companyName, brandWidth).slice(0, 2), brandX, 14);
  const companyDetails = [company?.tax_identifier && `CPF/CNPJ ${company.tax_identifier}`, company?.phone, company?.email].filter(Boolean).join('  |  ');
  if (companyDetails) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...palette.muted); doc.text(doc.splitTextToSize(companyDetails, brandWidth).slice(0, 2), brandX, 22); }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13.5); doc.setTextColor(...palette.navy); doc.text(title.toUpperCase(), width - margin, 13, { align: 'right' });
  if (number) { doc.setFontSize(number.length>28?8:10.5); doc.setTextColor(...palette.ink); doc.text(`${numberPrefix}${number}`, width - margin, 20, { align: 'right' }); }
  if (subtitle) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...palette.muted); doc.text(subtitle, width - margin, 27, { align: 'right' }); }
  if (status) { const labelWidth = Math.max(28, Math.min(48, doc.getTextWidth(status) + 10)); doc.setFillColor(...palette.green); doc.roundedRect(width - margin - labelWidth, 31, labelWidth, 7, 3.5, 3.5, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...palette.white); doc.text(status.toUpperCase(), width - margin - labelWidth / 2, 35.6, { align: 'center' }); }
  doc.setDrawColor(...palette.line); doc.setLineWidth(.5); doc.line(margin, 41, width - margin, 41); doc.setFillColor(...palette.gold); doc.roundedRect(margin, 40.35, 32, 1.3, .65, .65, 'F');
  return 50;
}

export function drawPdfSection(doc, y, title, subtitle = '', palette) {
  doc.setFillColor(...palette.accent); doc.roundedRect(PDF_PAGE.margin, y - 3.5, 2.6, subtitle ? 12 : 8, 1.3, 1.3, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); doc.setTextColor(...palette.navy); doc.text(title, PDF_PAGE.margin + 7, y + 1);
  if (subtitle) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...palette.muted); doc.text(subtitle, PDF_PAGE.margin + 7, y + 6.5); }
  return y + (subtitle ? 15 : 10);
}

export function drawPdfTableHeader(doc, y, columns, palette) {
  const { margin, width } = PDF_PAGE; doc.setFillColor(...palette.navy); doc.roundedRect(margin, y, width - margin * 2, 9, 1.8, 1.8, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.2); doc.setTextColor(...palette.white);
  columns.forEach((column) => doc.text(column.label.toUpperCase(), column.x, y + 5.9, { align: column.align || 'left' })); return y + 12;
}

export function drawPdfFooters(doc, { company, palette = createPdfPalette(company), text = '' }) {
  const pages = doc.getNumberOfPages(); const { margin, width, height } = PDF_PAGE;
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page); doc.setDrawColor(...palette.line); doc.line(margin, height - 16, width - margin, height - 16);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.8); doc.setTextColor(...palette.navy); const brandLines=doc.splitTextToSize(String(company?.name || 'EletroAgro').toUpperCase(),50);doc.text(brandLines[0] || '', margin, height - 9.5);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...palette.muted); const footer = text || company?.document_settings?.footerText || 'Documento gerado pelo EletroAgro'; doc.text(doc.splitTextToSize(footer, 70)[0] || '', width / 2, height - 9.5, { align: 'center' });
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...palette.navy); doc.text(`Página ${page} de ${pages}`, width - margin, height - 9.5, { align: 'right' });
  }
}

export function drawPdfSignature(doc, y, label, palette, x = 55, width = 100) {
  doc.setDrawColor(...palette.muted); doc.setLineWidth(.35); doc.line(x, y, x + width, y); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...palette.muted); const lines=doc.splitTextToSize(label,width);doc.text(lines, x + width / 2, y + 5, { align: 'center' }); return y + 7+lines.length*3.5;
}
