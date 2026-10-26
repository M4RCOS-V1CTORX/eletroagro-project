import {useSyncRefresh} from './useSyncRefresh.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, CirclePlus, ClipboardList, Copy, Download, Eye, LoaderCircle, Pencil, Plus, Search, Share2, Trash2, UserRoundPlus, X } from 'lucide-react';
import {archivePdf,savePdfToDevice} from './deviceFiles.js';
import { apiRequest } from './apiClient.js';
import { addContainedImage, loadPdfLogo, pdfAccent } from './pdfDesign.js';

const statusLabels = { draft: 'Rascunho', sent: 'Enviado', approved: 'Aprovado', rejected: 'Recusado', expired: 'Expirado', cancelled: 'Cancelado' };
const emptyLine = () => ({ catalogItemId: '', catalogQuery: '', quantity: '1', unitPrice: '0' });
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
function quoteItemsToDraft(quote, options) {
  return quote.items.map((item) => {
    const matching = options.find((option) => option.id === item.catalog_item_id);
    return matching ? {
      catalogItemId: matching.id, catalogQuery: '', quantity: String(item.quantity), unitPrice: String(item.unit_price),
      name: '', itemType: matching.item_type, unit: matching.unit, description: matching.description || '',
    } : {
      catalogItemId: 'custom', catalogQuery: '', quantity: String(item.quantity), unitPrice: String(item.unit_price),
      name: item.name, itemType: item.item_type, unit: item.unit, description: item.description || '',
    };
  });
}

function localDateText(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function safeFilePart(value) {
  return String(value || 'cliente').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'cliente';
}

async function createQuotePdf(quote, company) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const page = { width: 210, height: 297, margin: 16, contentBottom: 271, footerTop: 273 };
  const number = String(quote.quote_number).padStart(4, '0');
  const companyName = company?.name || 'EletroAgro';
  const pdfCurrency = (value) => currency.format(Number(value)).replace(/[\u00a0\u202f]/g, ' ');
  const colors = {
    forest: pdfAccent(company?.document_settings?.accentColor, [20, 92, 57]), green: [42, 145, 79], blue: [29, 133, 190], gold: [226, 174, 32],
    ink: [31, 47, 53], muted: [105, 122, 127], pale: [242, 248, 244], line: [222, 232, 225], white: [255, 255, 255],
  };
  const setText = (color) => doc.setTextColor(...color);
  const fill = (color) => doc.setFillColor(...color);
  const stroke = (color) => doc.setDrawColor(...color);
  const statusColor = quote.status === 'approved' ? colors.green : quote.status === 'sent' ? colors.blue : quote.status === 'cancelled' || quote.status === 'rejected' ? [174, 88, 57] : colors.muted;
  let y = 56;
  const drawCompactHeader = () => {
    fill(colors.forest); doc.rect(0, 0, page.width, 2.2, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); setText(colors.forest);
    doc.text(companyName, page.margin, 13);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); setText(colors.muted);
    doc.text(`ORÇAMENTO #${number}`, page.width - page.margin, 13, { align: 'right' });
    stroke(colors.line); doc.line(page.margin, 18, page.width - page.margin, 18);
    y = 27;
  };
  const newPage = () => { doc.addPage(); drawCompactHeader(); };
  const ensureSpace = (height) => { if (y + height > page.contentBottom) newPage(); };
  const drawSectionTitle = (eyebrow, title, detail = '') => {
    ensureSpace(detail ? 17 : 12);
    fill(colors.gold); doc.roundedRect(page.margin, y - 1.5, 1.4, detail ? 12 : 8, 0.6, 0.6, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); setText(colors.green); doc.text(eyebrow.toUpperCase(), page.margin + 4, y + 1.5);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); setText(colors.forest); doc.text(title, page.margin + 4, y + 7);
    if (detail) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); setText(colors.muted); doc.text(detail, page.margin + 4, y + 12); }
    y += detail ? 17 : 12;
  };
  const drawInfoCard = (label, value, x, width) => {
    fill(colors.pale); doc.roundedRect(x, y, width, 18, 2, 2, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); setText(colors.muted); doc.text(label.toUpperCase(), x + 3, y + 5);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); setText(colors.forest); doc.text(value || 'Não informado', x + 3, y + 12);
  };
  const drawTextCard = (label, value, x, width) => {
    const remaining = [...doc.splitTextToSize(String(value), width - 10)]; let continued = false;
    while (remaining.length) {
      if (page.contentBottom - y < 28) newPage();
      const maxLines = Math.max(2, Math.floor((page.contentBottom - y - 15) / 4.2)); const lines = remaining.splice(0, maxLines); const height = Math.max(23, 13 + lines.length * 4.2);
      fill(colors.pale); doc.roundedRect(x, y, width, height, 2, 2, 'F'); fill(colors.green); doc.roundedRect(x, y, 1.2, height, 0.5, 0.5, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); setText(colors.forest); doc.text(`${label.toUpperCase()}${continued ? ' - CONTINUAÇÃO' : ''}`, x + 5, y + 7);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); setText(colors.ink); doc.text(lines, x + 5, y + 13); y += height + 4; continued = true;
      if (remaining.length) newPage();
    }
  };

  // Clean white header with the company's own green, blue and gold identity.
  fill(colors.white); doc.rect(0, 0, page.width, 45, 'F');
  addContainedImage(doc, await loadPdfLogo(), { x: page.margin, y: 8, width: 28, height: 28 });

  doc.setFont('helvetica', 'bold'); doc.setFontSize(companyName.length > 24 ? 11.5 : 14); setText(colors.forest);
  doc.text(doc.splitTextToSize(companyName, 82).slice(0, 2), 48, 15);
  const companyDetails = [company?.tax_identifier && `CNPJ/CPF ${company.tax_identifier}`, company?.phone, company?.email].filter(Boolean);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); setText(colors.muted);
  if (companyDetails.length) doc.text(doc.splitTextToSize(companyDetails.join('  |  '), 82).slice(0, 2), 48, 22);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); setText(colors.forest); doc.text('ORÇAMENTO', page.width - page.margin, 13, { align: 'right' });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); setText(colors.ink); doc.text(`#${number}`, page.width - page.margin, 20, { align: 'right' });
  fill(statusColor); doc.roundedRect(page.width - page.margin - 35, 24, 35, 7, 3.5, 3.5, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); setText(colors.white); doc.text(statusLabels[quote.status] || quote.status, page.width - page.margin - 17.5, 28.7, { align: 'center' });
  stroke(colors.line); doc.setLineWidth(0.7); doc.line(page.margin, 41, page.width - page.margin, 41);
  fill(colors.green); doc.roundedRect(page.margin, 40.3, 30, 1.4, 0.7, 0.7, 'F');
  fill(colors.blue); doc.roundedRect(page.margin + 31, 40.3, 8, 1.4, 0.7, 0.7, 'F');

  y = 52;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); setText(colors.green); doc.text('PROPOSTA COMERCIAL', page.margin, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); setText(colors.muted); doc.text('Soluções pensadas para atender ao seu projeto.', page.margin, y + 5);
  y += 12;
  const cardGap = 4; const cardWidth = (page.width - page.margin * 2 - cardGap * 2) / 3;
  drawInfoCard('Data de emissão', formatDate(quote.issued_at), page.margin, cardWidth);
  drawInfoCard('Válido até', formatDate(quote.valid_until), page.margin + cardWidth + cardGap, cardWidth);
  drawInfoCard('Documento', `Nº ${number}`, page.margin + (cardWidth + cardGap) * 2, cardWidth);
  y += 24;

  drawSectionTitle('IDENTIFICAÇÃO', 'Preparado para');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  const clientNameLines = doc.splitTextToSize(String(quote.customer_name || 'Cliente'), page.width - page.margin * 2 - 13);
  const clientDetails = [quote.customer_tax_identifier && `CPF/CNPJ: ${quote.customer_tax_identifier}`, quote.customer_phone && `Telefone: ${quote.customer_phone}`].filter(Boolean).join('     ');
  const clientDetailLines = clientDetails ? (doc.setFont('helvetica', 'normal'), doc.setFontSize(9.5), doc.splitTextToSize(clientDetails, page.width - page.margin * 2 - 13)) : [];
  const clientCardHeight = Math.max(20, 8 + clientNameLines.length * 5 + (clientDetailLines.length ? 3 + clientDetailLines.length * 3.5 : 0));
  fill(colors.pale); doc.roundedRect(page.margin, y, page.width - page.margin * 2, clientCardHeight, 2, 2, 'F');
  fill(colors.green); doc.roundedRect(page.margin, y, 1.5, clientCardHeight, 0.7, 0.7, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); setText(colors.forest); doc.text(clientNameLines, page.margin + 6, y + 8);
  if (clientDetailLines.length) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); setText(colors.muted); doc.text(clientDetailLines, page.margin + 6, y + 8 + clientNameLines.length * 5); }
  y += clientCardHeight + 10;

  drawSectionTitle('ESCOPO E INVESTIMENTO', 'Produtos e serviços', 'Itens, quantidades e valores desta proposta.');
  const tableX = page.margin; const tableWidth = page.width - page.margin * 2;
  const col = { index: tableX + 5, description: tableX + 13, quantity: tableX + 117, unitPrice: tableX + 148, total: tableX + tableWidth - 4 };
  const drawTableHeader = () => {
    fill(colors.forest); doc.roundedRect(tableX, y, tableWidth, 9, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); setText(colors.white);
    doc.text('ITEM', col.index, y + 5.8); doc.text('DESCRIÇÃO', col.description, y + 5.8);
    doc.text('QTD.', col.quantity, y + 5.8, { align: 'right' }); doc.text('UNITÁRIO', col.unitPrice, y + 5.8, { align: 'right' }); doc.text('TOTAL', col.total, y + 5.8, { align: 'right' });
    y += 12;
  };
  drawTableHeader();
  for (const [index, item] of (quote.items || []).entries()) {
    const titleLines = doc.splitTextToSize(String(item.name || 'Item'), 91);
    const detailLines = item.description ? doc.splitTextToSize(String(item.description), 91) : [];
    const rowHeight = Math.max(13, 5 + titleLines.length * 4.1 + detailLines.length * 3.7);
    if (y + rowHeight > page.contentBottom - 35) { newPage(); drawTableHeader(); }
    if (index % 2 === 0) { fill([248, 251, 249]); doc.rect(tableX, y - 2, tableWidth, rowHeight, 'F'); }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); setText(colors.green); doc.text(String(index + 1).padStart(2, '0'), col.index, y + 4);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); setText(colors.ink); doc.text(titleLines, col.description, y + 4);
    if (detailLines.length) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); setText(colors.muted); doc.text(detailLines, col.description, y + 4 + titleLines.length * 4); }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); setText(colors.ink);
    doc.text(`${item.quantity} ${item.unit || ''}`.trim(), col.quantity, y + 4, { align: 'right' });
    doc.text(pdfCurrency(item.unit_price), col.unitPrice, y + 4, { align: 'right' });
    doc.setFont('helvetica', 'bold'); setText(colors.forest); doc.text(pdfCurrency(item.line_total), col.total, y + 4, { align: 'right' });
    stroke(colors.line); doc.setLineWidth(0.25); doc.line(tableX, y + rowHeight - 1, tableX + tableWidth, y + rowHeight - 1);
    y += rowHeight;
  }

  ensureSpace(36);
  const totalsX = 105; const totalsWidth = page.width - page.margin - totalsX;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); setText(colors.muted);
  doc.text('Subtotal', totalsX + 2, y + 5); doc.text(pdfCurrency(quote.subtotal), totalsX + totalsWidth - 2, y + 5, { align: 'right' });
  if (Number(quote.discount_amount) > 0) { doc.text('Desconto', totalsX + 2, y + 11); doc.text(`- ${pdfCurrency(quote.discount_amount)}`, totalsX + totalsWidth - 2, y + 11, { align: 'right' }); }
  const totalBoxY = y + (Number(quote.discount_amount) > 0 ? 15 : 9);
  fill(colors.forest); doc.roundedRect(totalsX, totalBoxY, totalsWidth, 19, 2, 2, 'F');
  fill(colors.gold); doc.roundedRect(totalsX, totalBoxY, 1.5, 19, 0.7, 0.7, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); setText(colors.white); doc.text('TOTAL DA PROPOSTA', totalsX + 5, totalBoxY + 7);
  doc.setFontSize(14); doc.text(pdfCurrency(quote.total), totalsX + totalsWidth - 4, totalBoxY + 14, { align: 'right' });
  y = totalBoxY + 25;

  const termsCards = [
    quote.terms && ['Condições comerciais', quote.terms],
    quote.notes && ['Observações', quote.notes],
  ].filter(Boolean);
  if (termsCards.length === 2) {
    const cardGap = 5; const cardWidth = (tableWidth - cardGap) / 2;
    const prepared = termsCards.map(([label, value]) => ({ label, lines: doc.splitTextToSize(String(value), cardWidth - 10) }));
    const cardHeight = Math.max(...prepared.map(({ lines }) => Math.max(23, 13 + lines.length * 4.2)));
    if (cardHeight <= 62 && y + cardHeight + 4 <= page.contentBottom) {
      prepared.forEach(({ label, lines }, index) => { const x = page.margin + index * (cardWidth + cardGap); fill(colors.pale); doc.roundedRect(x, y, cardWidth, cardHeight, 2, 2, 'F'); fill(colors.green); doc.roundedRect(x, y, 1.2, cardHeight, .5, .5, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); setText(colors.forest); doc.text(label.toUpperCase(), x + 5, y + 7); doc.setFont('helvetica', 'normal'); doc.setFontSize(10); setText(colors.ink); doc.text(lines, x + 5, y + 13); }); y += cardHeight + 4;
    } else termsCards.forEach(([label, value]) => drawTextCard(label, value, page.margin, tableWidth));
  } else termsCards.forEach(([label, value]) => drawTextCard(label, value, page.margin, tableWidth));

  ensureSpace(39);
  stroke(colors.line); doc.setLineWidth(0.35); doc.line(page.margin, y, page.width - page.margin, y); y += 8;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); setText(colors.forest); doc.text('ACEITE DA PROPOSTA', page.margin, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); setText(colors.muted); doc.text('Assinaturas registram a concordância com os itens, valores e condições descritos.', page.margin, y + 5); y += 18;
  const signatureGap = 14; const signatureWidth = (tableWidth - signatureGap) / 2;
  stroke([149, 166, 157]); doc.line(page.margin, y, page.margin + signatureWidth, y); doc.line(page.margin + signatureWidth + signatureGap, y, page.margin + tableWidth, y);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); setText(colors.ink);
  doc.text(quote.customer_name || 'Cliente', page.margin, y + 5); doc.text(companyName, page.margin + signatureWidth + signatureGap, y + 5);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); setText(colors.muted);
  doc.text('CLIENTE  -  DATA: ____ / ____ / ______', page.margin, y + 9); doc.text('ELETROAGRO  -  RESPONSÁVEL', page.margin + signatureWidth + signatureGap, y + 9);

  const pages = doc.getNumberOfPages();
  for (let index = 1; index <= pages; index += 1) {
    doc.setPage(index); fill(colors.forest); doc.rect(0, page.footerTop + 10, page.width, page.height - page.footerTop - 10, 'F');
    fill(colors.gold); doc.rect(0, page.footerTop + 10, page.width, 1.2, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); setText(colors.white);
    doc.text(companyName.toUpperCase(), page.margin, page.footerTop + 16);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(company?.document_settings?.footerText || 'ORÇAMENTO COMERCIAL - NÃO É DOCUMENTO FISCAL', page.width / 2, page.footerTop + 16, { align: 'center' });
    doc.text(`Página ${index} de ${pages}`, page.width - page.margin, page.footerTop + 16, { align: 'right' });
  }
  const filename=`orcamento-${number}-${safeFilePart(quote.customer_name)}.pdf`;await archivePdf(doc,filename);return {doc,filename};
}

function scaledValue(raw, places) {
  const match = String(raw ?? '0').match(/^(\d+)(?:\.(\d*))?$/);
  if (!match) return 0n;
  const decimals = (match[2] || '').slice(0, places).padEnd(places, '0');
  return BigInt(match[1]) * 10n ** BigInt(places) + BigInt(decimals || '0');
}

function quotePreviewTotal(lines, discount) {
  const subtotal = lines.reduce((sum, line) => {
    const priceCents = scaledValue(line.unitPrice, 2);
    const quantityMillis = scaledValue(line.quantity, 3);
    return sum + (priceCents * quantityMillis + 500n) / 1000n;
  }, 0n);
  const discountCents = scaledValue(discount, 2);
  return { subtotal, total: subtotal > discountCents ? subtotal - discountCents : 0n, discount: discountCents };
}

function displayCents(cents) { return currency.format(Number(cents) / 100); }


function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value.length === 10 ? `${value}T12:00:00` : value));
}

export default function QuotesPage() {
  useSyncRefresh(()=>loadQuotes(pagination.offset));
  const [quotes, setQuotes] = useState([]);
  const [summary, setSummary] = useState({ draft_count: 0, sent_count: 0, sent_total: '0', approved_count: 0, approved_total: '0', expiring_count: 0, overdue_count: 0 });
  const [pagination, setPagination] = useState({ total: 0, limit: 25, offset: 0 });
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [customerQuery, setCustomerQuery] = useState('');
  const [quickCustomerOpen, setQuickCustomerOpen] = useState(false);
  const [quickCustomer, setQuickCustomer] = useState({ name: '', phone: '', email: '' });
  const [details, setDetails] = useState(null);
  const [editingQuote, setEditingQuote] = useState(null);
  const [companyRole, setCompanyRole] = useState('member');
  const [companyInfo, setCompanyInfo] = useState(null);

  const loadQuotes = useCallback(async (offset = 0, overrides = {}) => {
    setBusy(true); setError('');
    try {
      const params = new URLSearchParams({ status: overrides.status || status, q: overrides.query ?? appliedQuery, limit: String(pagination.limit), offset: String(offset) });
      const [result, summaryResult] = await Promise.all([
        apiRequest(`/api/quotes?${params}`),
        apiRequest('/api/quotes/summary').catch(() => null),
      ]);
      setQuotes(result.quotes); setPagination((current) => ({ ...current, ...result.pagination }));
      if (summaryResult?.summary) setSummary(summaryResult.summary);
    } catch (loadError) { setError(loadError.message); }
    finally { setBusy(false); }
  }, [status, appliedQuery, pagination.limit]);

  useEffect(() => { loadQuotes(0); }, [loadQuotes]);
  useEffect(() => { apiRequest('/api/company/me').then((result) => { setCompanyRole(result.company?.role || 'member'); setCompanyInfo(result.company || null); }).catch(() => {}); }, []);

  async function beginDraft() {
    setError(''); setNotice(''); setBusy(true);
    try {
      const [customerResult, productResult, serviceResult] = await Promise.all([
        apiRequest('/api/customers?limit=100&order=asc'),
        apiRequest('/api/catalog?type=product&status=active'),
        apiRequest('/api/catalog?type=service&status=active'),
      ]);
      setCustomers(customerResult.customers);
      setCatalog([...productResult.items, ...serviceResult.items]);
      setEditingQuote(null);
      setCustomerQuery(''); setQuickCustomerOpen(false); setQuickCustomer({ name: '', phone: '', email: '' });
      setDraft({ customerId: '', validUntil: '', discountAmount: '0', notes: '', terms: '', items: [emptyLine()] });
    } catch (loadError) { setError(loadError.message); }
    finally { setBusy(false); }
  }

  async function beginEdit(quote) {
    setError(''); setNotice(''); setBusy(true);
    try {
      const [customerResult, productResult, serviceResult, detailResult] = await Promise.all([
        apiRequest('/api/customers?limit=100&order=asc'),
        apiRequest('/api/catalog?type=product&status=active'),
        apiRequest('/api/catalog?type=service&status=active'),
        apiRequest(`/api/quotes/${quote.id}`),
      ]);
      const options = [...productResult.items, ...serviceResult.items];
      setCustomers(customerResult.customers); setCatalog(options); setEditingQuote(detailResult.quote);
      setCustomerQuery(''); setQuickCustomerOpen(false);
      setDraft({
        customerId: detailResult.quote.customer_id || '',
        validUntil: detailResult.quote.valid_until ? String(detailResult.quote.valid_until).slice(0, 10) : '',
        discountAmount: String(detailResult.quote.discount_amount || '0'),
        notes: detailResult.quote.notes || '', terms: detailResult.quote.terms || '',
        items: quoteItemsToDraft(detailResult.quote, options),
      });
    } catch (loadError) { setError(loadError.message); }
    finally { setBusy(false); }
  }

  async function beginDuplicate(quote) {
    setError(''); setNotice(''); setBusy(true);
    try {
      const [customerResult, productResult, serviceResult, detailResult] = await Promise.all([
        apiRequest('/api/customers?limit=100&order=asc'),
        apiRequest('/api/catalog?type=product&status=active'),
        apiRequest('/api/catalog?type=service&status=active'),
        apiRequest(`/api/quotes/${quote.id}`),
      ]);
      const options = [...productResult.items, ...serviceResult.items];
      const original = detailResult.quote;
      const validity = original.valid_until ? String(original.valid_until).slice(0, 10) : '';
      const activeCustomerExists = customerResult.customers.some((customer) => customer.id === original.customer_id);
      setCustomers(customerResult.customers); setCatalog(options); setEditingQuote(null);
      setCustomerQuery(''); setQuickCustomerOpen(false);
      setDraft({
        customerId: activeCustomerExists ? original.customer_id : '',
        validUntil: validity && validity < localDateText() ? '' : validity,
        discountAmount: String(original.discount_amount || '0'),
        notes: original.notes || '', terms: original.terms || '',
        items: quoteItemsToDraft(original, options),
      });
      setNotice(`Cópia do orçamento nº ${String(quote.quote_number).padStart(4, '0')} pronta como novo rascunho. ${activeCustomerExists ? 'Revise a validade e os valores antes de enviar.' : 'Escolha um cliente ativo antes de salvar.'}`);
    } catch (loadError) { setError(loadError.message); }
    finally { setBusy(false); }
  }

  async function createQuickCustomer() {
    const name = quickCustomer.name.trim();
    if (!name) { setError('Informe o nome do cliente.'); return; }
    setBusy(true); setError('');
    try {
      const result = await apiRequest('/api/customers', {
        method: 'POST', body: JSON.stringify({ name, customerType: 'other', phone: quickCustomer.phone, email: quickCustomer.email }),
      });
      setCustomers((current) => [result.customer, ...current.filter((customer) => customer.id !== result.customer.id)]);
      setDraft((current) => ({ ...current, customerId: result.customer.id }));
      setCustomerQuery(''); setQuickCustomer({ name: '', phone: '', email: '' }); setQuickCustomerOpen(false);
    } catch (saveError) { setError(saveError.message); }
    finally { setBusy(false); }
  }

  function changeLine(index, changes) {
    setDraft((current) => ({ ...current, items: current.items.map((item, i) => i === index ? { ...item, ...changes } : item) }));
  }

  function chooseCatalogItem(index, id) {
    const item = catalog.find((candidate) => candidate.id === id);
    changeLine(index, id === 'custom'
      ? { catalogItemId: id, catalogQuery: '', unitPrice: '0', name: '', itemType: 'service', unit: 'un', description: '' }
      : { catalogItemId: id, catalogQuery: '', unitPrice: item ? String(item.sale_price) : '0' });
  }

  async function saveQuote(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const payload = {
        ...draft,
        items: draft.items.map((item) => ({
          catalogItemId: item.catalogItemId === 'custom' ? '' : item.catalogItemId,
          ...(item.catalogItemId === 'custom' ? { name: item.name, itemType: item.itemType, unit: item.unit, description: item.description } : {}),
          quantity: item.quantity, unitPrice: item.unitPrice,
        })),
      };
      const result = await apiRequest(editingQuote ? `/api/quotes/${editingQuote.id}` : '/api/quotes', {
        method: editingQuote ? 'PATCH' : 'POST', body: JSON.stringify(payload),
      });
      setDraft(null);
      if (editingQuote) {
        setNotice(`Orçamento nº ${String(result.quote.quote_number).padStart(4, '0')} atualizado. O status voltou para rascunho e precisa ser enviado novamente.`);
      } else setNotice(`Orçamento nº ${String(result.quote.quote_number).padStart(4, '0')} criado como rascunho.`);
      setEditingQuote(null); setStatus('all'); setAppliedQuery(''); setQuery(''); await loadQuotes(0, { status: 'all', query: '' });
    } catch (saveError) { setError(saveError.message); }
    finally { setBusy(false); }
  }

  async function changeStatus(quote, nextStatus) {
    let reason = '';
    if (nextStatus === 'cancelled') {
      reason = window.prompt('Informe o motivo do cancelamento do orçamento:')?.trim() || '';
      if (!reason) return;
    }
    setBusy(true); setError('');
    try {
      await apiRequest(`/api/quotes/${quote.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus, reason }) });
      setNotice(`Orçamento nº ${String(quote.quote_number).padStart(4, '0')}: ${statusLabels[nextStatus].toLowerCase()}.`);
      await loadQuotes(pagination.offset);
    } catch (statusError) { setError(statusError.message); }
    finally { setBusy(false); }
  }

  async function openDetails(quote) {
    setBusy(true); setError('');
    try { const result = await apiRequest(`/api/quotes/${quote.id}`); setDetails(result.quote); }
    catch (detailError) { setError(detailError.message); }
    finally { setBusy(false); }
  }

  async function downloadQuotePdf(quote) {
    setBusy(true); setError('');
    try {
      const result = await apiRequest(`/api/quotes/${quote.id}`);
      const { doc, filename } = await createQuotePdf(result.quote, companyInfo);
      await savePdfToDevice(doc,filename); setNotice(`PDF do orçamento nº ${String(quote.quote_number).padStart(4, '0')} baixado.`);
    } catch (pdfError) { setError(pdfError.message || 'Não foi possível gerar o PDF.'); }
    finally { setBusy(false); }
  }

  async function shareQuotePdf(quote) {
    let fileShareAvailable = false;
    try {
      fileShareAvailable = typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && typeof File !== 'undefined'
        && navigator.canShare({ files: [new File([''], 'orcamento.pdf', { type: 'application/pdf' })] });
    } catch { fileShareAvailable = false; }
    const whatsappTab = fileShareAvailable ? null : window.open('about:blank', '_blank');
    setBusy(true); setError('');
    try {
      const result = await apiRequest(`/api/quotes/${quote.id}`);
      const { doc, filename } = await createQuotePdf(result.quote, companyInfo);
      const file = new File([doc.output('blob')], filename, { type: 'application/pdf' });
      if (fileShareAvailable) {
        await navigator.share({ files: [file], title: `Orçamento #${String(quote.quote_number).padStart(4, '0')}`, text: `Proposta para ${quote.customer_name}` });
        setNotice('PDF compartilhado.');
      } else {
        doc.save(filename);
        if (whatsappTab) whatsappTab.location.href = `https://wa.me/?text=${encodeURIComponent(`Olá! Estou enviando o orçamento #${String(quote.quote_number).padStart(4, '0')} no valor de ${currency.format(Number(quote.total))}.`)}`;
        setNotice(whatsappTab ? 'PDF baixado e WhatsApp aberto. Anexe o arquivo à conversa.' : 'PDF baixado. Abra o WhatsApp e anexe o arquivo à conversa.');
      }
    } catch (pdfError) {
      whatsappTab?.close();
      if (pdfError.name !== 'AbortError') setError(pdfError.message || 'Não foi possível compartilhar o PDF.');
    } finally { setBusy(false); }
  }

  async function deleteQuote(quote) {
    const number = String(quote.quote_number).padStart(4, '0');
    const confirmation = window.prompt(`A exclusão é permanente. Digite ${number} para apagar o orçamento e seu histórico:`);
    if (confirmation !== number) return;
    setBusy(true); setError('');
    try {
      await apiRequest(`/api/quotes/${quote.id}`, { method: 'DELETE', body: JSON.stringify({ confirmation: String(quote.quote_number) }) });
      setNotice(`Orçamento nº ${number} excluído permanentemente.`);
      const offset = quotes.length === 1 && pagination.offset > 0 ? pagination.offset - pagination.limit : pagination.offset;
      await loadQuotes(offset);
    } catch (deleteError) { setError(deleteError.message); }
    finally { setBusy(false); }
  }

  const pageCount = useMemo(() => Math.max(1, Math.ceil(pagination.total / pagination.limit)), [pagination.limit, pagination.total]);
  const pageNumber = Math.floor(pagination.offset / pagination.limit) + 1;
  const previewTotals = draft ? quotePreviewTotal(draft.items, draft.discountAmount) : { subtotal: 0n, discount: 0n, total: 0n };
  const matchingCustomers = customers.filter((customer) => `${customer.name} ${customer.phone || ''} ${customer.tax_identifier || ''}`.toLocaleLowerCase('pt-BR').includes(customerQuery.trim().toLocaleLowerCase('pt-BR')));
  const selectedCustomer = customers.find((customer) => customer.id === draft?.customerId);

  return <section className="customers-page quotes-page">
    <div className="customers-heading"><div><span className="customers-kicker">COMERCIAL</span><h1>Orçamentos</h1><p>Crie propostas com itens do catálogo e acompanhe a resposta do cliente.</p></div><button className="customers-primary add-customer-button" onClick={beginDraft} disabled={busy}><CirclePlus size={17} /> Novo orçamento</button></div>
    {error && !draft && <p className="customers-feedback error" role="alert">{error}<button onClick={() => loadQuotes(pagination.offset)}>Tentar novamente</button></p>}
    {notice && <p className="customers-feedback success" role="status">{notice}<button aria-label="Fechar mensagem" onClick={() => setNotice('')}><X size={15} /></button></p>}
    <div className="customers-toolbar quote-toolbar">
      <form className="customers-search" onSubmit={(event) => { event.preventDefault(); setAppliedQuery(query.trim()); }}><Search size={17} /><input aria-label="Pesquisar orçamentos" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por número ou cliente" /><button type="submit">Buscar</button></form>
      <select className="catalog-status" aria-label="Filtrar situação do orçamento" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Todos os status</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
    </div>
    <div className="quote-summary-grid" aria-label="Resumo dos orçamentos">
      <button className="quote-metric metric-draft" onClick={() => setStatus('draft')}><span>Rascunhos</span><strong>{summary.draft_count}</strong><small>Propostas para revisar</small></button>
      <button className="quote-metric metric-sent" onClick={() => setStatus('sent')}><span>Aguardando resposta</span><strong>{summary.sent_count}</strong><small>{currency.format(Number(summary.sent_total))} em aberto</small></button>
      <button className="quote-metric metric-approved" onClick={() => setStatus('approved')}><span>Aprovados</span><strong>{summary.approved_count}</strong><small>{currency.format(Number(summary.approved_total))} aprovados</small></button>
      <button className="quote-metric metric-expiring" onClick={() => setStatus('sent')}><span>Validade para acompanhar</span><strong>{summary.expiring_count + summary.overdue_count}</strong><small>{summary.expiring_count} próximos do vencimento · {summary.overdue_count} vencidos</small></button>
    </div>
    <div className="customers-summary"><span><ClipboardList size={16} /> {pagination.total} {pagination.total === 1 ? 'orçamento' : 'orçamentos'}</span><span>Numeração sequencial por empresa</span></div>
    <div className="customers-table-wrap"><table className="customers-table quote-table"><thead><tr><th>Número</th><th>Cliente</th><th>Emissão</th><th>Validade</th><th>Total</th><th>Status</th><th><span className="sr-only">Ações</span></th></tr></thead><tbody>
      {busy && !quotes.length && <tr><td colSpan="7" className="customers-table-state"><LoaderCircle size={18} className="spin" /> Carregando orçamentos…</td></tr>}
      {!busy && !quotes.length && <tr><td colSpan="7" className="customers-table-state"><span className="empty-customers-icon"><ClipboardList size={21} /></span><strong>{appliedQuery || status !== 'all' ? 'Nenhum orçamento encontrado' : 'Nenhum orçamento cadastrado'}</strong><span>Crie uma proposta selecionando um cliente e itens do catálogo.</span></td></tr>}
      {quotes.map((quote) => <tr key={quote.id}><td><strong className="quote-number">#{String(quote.quote_number).padStart(4, '0')}</strong></td><td><strong className="customer-name">{quote.customer_name}</strong></td><td>{formatDate(quote.issued_at)}</td><td>{formatDate(quote.valid_until)}</td><td><strong>{currency.format(Number(quote.total))}</strong>{Number(quote.discount_amount) > 0 && <small>Desconto {currency.format(Number(quote.discount_amount))}</small>}</td><td><span className={`catalog-badge quote-status status-${quote.status}`}>{statusLabels[quote.status]}</span></td><td><div className="customer-actions"><button aria-label={`Ver orçamento ${quote.quote_number}`} title="Ver detalhes" onClick={() => openDetails(quote)}><Eye size={16} /></button><button aria-label={`Baixar PDF do orçamento ${quote.quote_number}`} title="Baixar PDF" disabled={busy} onClick={() => downloadQuotePdf(quote)}><Download size={15} /></button><button aria-label={`Compartilhar orçamento ${quote.quote_number}`} title="Compartilhar PDF" disabled={busy} onClick={() => shareQuotePdf(quote)}><Share2 size={15} /></button><button aria-label={`Editar orçamento ${quote.quote_number}`} title="Editar orçamento" disabled={busy} onClick={() => beginEdit(quote)}><Pencil size={16} /></button><button aria-label={`Duplicar orçamento ${quote.quote_number}`} title="Duplicar como rascunho" disabled={busy} onClick={() => beginDuplicate(quote)}><Copy size={15} /></button><StatusAction quote={quote} busy={busy} onChange={changeStatus} />{companyRole === 'owner' && <button aria-label={`Excluir orçamento ${quote.quote_number}`} title="Excluir permanentemente" disabled={busy} onClick={() => deleteQuote(quote)}><Trash2 size={16} /></button>}</div></td></tr>)}
    </tbody></table></div>
    <div className="customers-pagination"><span>Mostrando {pagination.total ? pagination.offset + 1 : 0}–{Math.min(pagination.offset + quotes.length, pagination.total)} de {pagination.total}</span><div><button aria-label="Página anterior" disabled={pageNumber <= 1 || busy} onClick={() => loadQuotes(Math.max(0, pagination.offset - pagination.limit))}><ChevronLeft size={17} /></button><span>Página {pageNumber} de {pageCount}</span><button aria-label="Próxima página" disabled={pageNumber >= pageCount || busy} onClick={() => loadQuotes(pagination.offset + pagination.limit)}><ChevronRight size={17} /></button></div></div>

    {draft && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) { setDraft(null); setEditingQuote(null); } }}><section className="customer-modal quote-modal" role="dialog" aria-modal="true" aria-labelledby="quote-modal-title">
      <header className="customer-modal-heading"><div><span className="customers-kicker">{editingQuote ? `ORÇAMENTO #${String(editingQuote.quote_number).padStart(4, '0')}` : 'NOVA PROPOSTA'}</span><h2 id="quote-modal-title">{editingQuote ? 'Editar orçamento' : 'Criar orçamento'}</h2></div><button className="modal-close" onClick={() => { setDraft(null); setEditingQuote(null); }} disabled={busy} aria-label="Fechar"><X size={18} /></button></header>
      {customers.length === 0 && <p className="customers-feedback error">Cadastre um cliente antes de criar um orçamento.</p>}
      {catalog.length === 0 && <p className="customers-feedback error">Cadastre produtos ou serviços ativos no catálogo antes de criar um orçamento.</p>}
      <form className="customer-form quote-form" onSubmit={saveQuote}>
        <div className="field-wide quote-customer-picker">
          <label>Buscar cliente<input type="search" value={customerQuery} onChange={(event) => setCustomerQuery(event.target.value)} placeholder="Nome, telefone ou CPF/CNPJ" /></label>
          <div className="quote-customer-select-row"><label>Cliente<select required value={draft.customerId} onChange={(event) => setDraft({ ...draft, customerId: event.target.value })}><option value="">Selecione um cliente</option>{selectedCustomer && !matchingCustomers.some((customer) => customer.id === selectedCustomer.id) && <option value={selectedCustomer.id}>{selectedCustomer.name}</option>}{matchingCustomers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label><button type="button" className="customers-secondary quote-quick-customer-toggle" onClick={() => { setQuickCustomerOpen((current) => !current); setError(''); }}><UserRoundPlus size={15} /> Novo cliente</button></div>
          {quickCustomerOpen && <div className="quote-quick-customer"><strong>Cadastro rápido</strong><label>Nome ou razão social<input autoFocus required minLength="2" maxLength="200" value={quickCustomer.name} onChange={(event) => setQuickCustomer({ ...quickCustomer, name: event.target.value })} /></label><label>Telefone<input maxLength="40" value={quickCustomer.phone} onChange={(event) => setQuickCustomer({ ...quickCustomer, phone: event.target.value })} /></label><label>E-mail<input type="email" maxLength="254" value={quickCustomer.email} onChange={(event) => setQuickCustomer({ ...quickCustomer, email: event.target.value })} /></label><button type="button" className="customers-primary" disabled={busy || quickCustomer.name.trim().length < 2} onClick={createQuickCustomer}>{busy ? 'Salvando…' : 'Salvar e selecionar'}</button></div>}
        </div>
        <label>Validade da proposta<input type="date" value={draft.validUntil} onChange={(event) => setDraft({ ...draft, validUntil: event.target.value })} /></label>
        <label>Desconto total (R$)<input type="number" min="0" step="0.01" value={draft.discountAmount} onChange={(event) => setDraft({ ...draft, discountAmount: event.target.value })} /></label>
        <div className="quote-lines field-wide"><div className="quote-lines-heading"><strong>Itens da proposta</strong><button type="button" className="customers-secondary" onClick={() => setDraft({ ...draft, items: [...draft.items, emptyLine()] })}><Plus size={14} /> Adicionar item</button></div>
          {draft.items.map((item, index) => <div className="quote-line-wrap" key={index}>
            {item.catalogItemId !== 'custom' && <label className="quote-catalog-search">Buscar no catálogo<input type="search" value={item.catalogQuery || ''} onChange={(event) => changeLine(index, { catalogQuery: event.target.value })} placeholder="Filtrar produtos e serviços" /></label>}
            <div className="quote-line"><label>Produto ou serviço<select required value={item.catalogItemId} onChange={(event) => chooseCatalogItem(index, event.target.value)}><option value="">Selecione um item</option><optgroup label="Produtos">{catalog.filter((entry) => entry.item_type === 'product' && (!item.catalogQuery || entry.name.toLocaleLowerCase('pt-BR').includes(item.catalogQuery.trim().toLocaleLowerCase('pt-BR')))).map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {currency.format(Number(entry.sale_price))}/{entry.unit}</option>)}</optgroup><optgroup label="Serviços">{catalog.filter((entry) => entry.item_type === 'service' && (!item.catalogQuery || entry.name.toLocaleLowerCase('pt-BR').includes(item.catalogQuery.trim().toLocaleLowerCase('pt-BR')))).map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {currency.format(Number(entry.sale_price))}/{entry.unit}</option>)}</optgroup><option value="custom">Item personalizado</option></select></label><label>Quantidade<input required type="number" min="0.001" step="0.001" value={item.quantity} onChange={(event) => changeLine(index, { quantity: event.target.value })} /></label><label>Preço unit. (R$)<input required type="number" min="0" step="0.01" value={item.unitPrice} onChange={(event) => changeLine(index, { unitPrice: event.target.value })} /></label><button type="button" className="quote-line-remove" aria-label="Remover item" disabled={draft.items.length <= 1} onClick={() => setDraft({ ...draft, items: draft.items.filter((_, lineIndex) => lineIndex !== index) })}><X size={16} /></button></div>
            {item.catalogItemId === 'custom' && <div className="quote-custom-line"><label>Descrição do item<input required minLength="2" maxLength="180" value={item.name || ''} onChange={(event) => changeLine(index, { name: event.target.value })} /></label><label>Tipo<select value={item.itemType || 'service'} onChange={(event) => changeLine(index, { itemType: event.target.value })}><option value="product">Produto / material</option><option value="service">Serviço</option></select></label><label>Unidade<input required maxLength="20" value={item.unit || ''} onChange={(event) => changeLine(index, { unit: event.target.value })} placeholder="un, m, h…" /></label><label className="quote-custom-description">Complemento<input maxLength="3000" value={item.description || ''} onChange={(event) => changeLine(index, { description: event.target.value })} placeholder="Detalhe opcional" /></label></div>}
          </div>)}
        </div>
        <label className="field-wide">Observações<textarea rows="2" maxLength="5000" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Detalhes adicionais da proposta" /></label>
        <label className="field-wide">Condições comerciais<textarea rows="2" maxLength="3000" value={draft.terms} onChange={(event) => setDraft({ ...draft, terms: event.target.value })} placeholder="Prazo, forma de pagamento, execução…" /></label>
        <div className="quote-total field-wide"><span>Subtotal <b>{displayCents(previewTotals.subtotal)}</b></span><span>Desconto <b>− {displayCents(previewTotals.discount)}</b></span><strong>Total da proposta <b>{displayCents(previewTotals.total)}</b></strong></div>
        {error && <p className="customers-feedback error field-wide" role="alert">{error}</p>}
        <div className="customer-form-actions field-wide"><button type="button" className="customers-secondary" onClick={() => { setDraft(null); setEditingQuote(null); }} disabled={busy}>Cancelar</button><button className="customers-primary" disabled={busy || !customers.length}>{busy ? 'Salvando…' : editingQuote ? 'Salvar alterações' : 'Salvar rascunho'}</button></div>
      </form>
    </section></div>}
    {details && <QuoteDetails quote={details} company={companyInfo} onClose={() => setDetails(null)} />}
  </section>;
}

function StatusAction({ quote, busy, onChange }) {
  const choices = { draft: ['sent', 'cancelled'], sent: ['approved', 'rejected', 'expired', 'cancelled'], approved: ['cancelled'], rejected: [], expired: [], cancelled: [] }[quote.status];
  if (!choices.length) return null;
  return <select className="quote-status-action" aria-label={`Alterar status do orçamento ${quote.quote_number}`} disabled={busy} value="" onChange={(event) => { if (event.target.value) onChange(quote, event.target.value); }}><option value="">Status…</option>{choices.map((status) => <option value={status} key={status}>{statusLabels[status]}</option>)}</select>;
}

function QuoteDetails({ quote, company, onClose }) {
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfMessage, setPdfMessage] = useState('');
  const [pdfError, setPdfError] = useState('');

  async function downloadPdf() {
    setPdfBusy(true); setPdfError(''); setPdfMessage('');
    try {
      const { doc, filename } = await createQuotePdf(quote, company);
      doc.save(filename);
      setPdfMessage('PDF baixado. Você já pode enviar o arquivo ao cliente.');
    } catch (error) { setPdfError(error.message || 'Não foi possível gerar o PDF.'); }
    finally { setPdfBusy(false); }
  }

  async function sharePdf() {
    let fileShareAvailable = false;
    try {
      fileShareAvailable = typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && typeof File !== 'undefined'
        && navigator.canShare({ files: [new File([''], 'orcamento.pdf', { type: 'application/pdf' })] });
    } catch { fileShareAvailable = false; }
    const whatsappTab = fileShareAvailable ? null : window.open('about:blank', '_blank');
    setPdfBusy(true); setPdfError(''); setPdfMessage('');
    try {
      const { doc, filename } = await createQuotePdf(quote, company);
      const blob = doc.output('blob');
      const file = new File([blob], filename, { type: 'application/pdf' });
      if (fileShareAvailable) {
        await navigator.share({ files: [file], title: `Orçamento #${String(quote.quote_number).padStart(4, '0')}`, text: `Proposta para ${quote.customer_name}` });
        setPdfMessage('Compartilhamento concluído.');
      } else {
        doc.save(filename);
        const text = `Olá! Estou enviando o orçamento #${String(quote.quote_number).padStart(4, '0')} no valor de ${currency.format(Number(quote.total))}.`;
        if (whatsappTab) whatsappTab.location.href = `https://wa.me/?text=${encodeURIComponent(text)}`;
        setPdfMessage(whatsappTab ? 'PDF baixado e WhatsApp aberto. Anexe o arquivo do orçamento à conversa.' : 'PDF baixado. Abra o WhatsApp e anexe o arquivo do orçamento à conversa.');
      }
    } catch (error) {
      whatsappTab?.close();
      if (error.name !== 'AbortError') setPdfError(error.message || 'Não foi possível compartilhar o PDF.');
    } finally { setPdfBusy(false); }
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="customer-modal quote-details" role="dialog" aria-modal="true" aria-labelledby="quote-details-title">
    <header className="customer-modal-heading"><div><span className="customers-kicker">ORÇAMENTO #{String(quote.quote_number).padStart(4, '0')}</span><h2 id="quote-details-title">{quote.customer_name}</h2></div><button className="modal-close" onClick={onClose} aria-label="Fechar"><X size={18} /></button></header>
    <div className="quote-detail-meta"><span><CalendarDays size={14} /> Emissão: {formatDate(quote.issued_at)}</span><span>Validade: {formatDate(quote.valid_until)}</span><span className={`catalog-badge quote-status status-${quote.status}`}>{statusLabels[quote.status]}</span></div>
    <div className="customers-table-wrap"><table className="customers-table quote-items-table"><thead><tr><th>Descrição</th><th>Qtd.</th><th>Preço unit.</th><th>Total</th></tr></thead><tbody>{quote.items.map((item) => <tr key={item.id}><td><strong className="customer-name">{item.name}</strong><span className="customer-type">{item.description || (item.item_type === 'product' ? 'Produto' : 'Serviço')}</span></td><td>{item.quantity} {item.unit}</td><td>{currency.format(Number(item.unit_price))}</td><td>{currency.format(Number(item.line_total))}</td></tr>)}</tbody></table></div>
    {quote.notes && <div className="quote-detail-text"><b>Observações</b><p>{quote.notes}</p></div>}{quote.terms && <div className="quote-detail-text"><b>Condições comerciais</b><p>{quote.terms}</p></div>}
    {quote.status_history?.length > 0 && <div className="quote-history"><strong>Histórico de status</strong>{quote.status_history.map((entry) => <div key={`${entry.created_at}-${entry.new_status}`}><span className={`quote-history-dot status-${entry.new_status}`} /><span><b>{entry.previous_status ? `${statusLabels[entry.previous_status]} → ` : ''}{statusLabels[entry.new_status]}</b><small>{formatDate(entry.created_at)}{entry.reason ? ` · ${entry.reason}` : ''}</small></span></div>)}</div>}
    {quote.versions?.length > 0 && <div className="quote-history"><strong>Versões anteriores</strong>{quote.versions.map((version) => <div key={version.version_number}><span className="quote-history-dot" /><span><b>Versão {version.version_number}</b><small>{formatDate(version.created_at)} · {version.reason}</small></span></div>)}</div>}
    <div className="quote-detail-totals"><span>Subtotal <b>{currency.format(Number(quote.subtotal))}</b></span>{Number(quote.discount_amount) > 0 && <span>Desconto <b>− {currency.format(Number(quote.discount_amount))}</b></span>}<strong>Total <b>{currency.format(Number(quote.total))}</b></strong></div>
    {pdfError && <p className="customers-feedback error" role="alert">{pdfError}</p>}{pdfMessage && <p className="customers-feedback success" role="status">{pdfMessage}</p>}
    <footer className="customer-form-actions quote-document-actions"><button className="customers-secondary" onClick={onClose}>Fechar</button><button className="customers-secondary" onClick={downloadPdf} disabled={pdfBusy}><Download size={15} /> Baixar PDF</button><button className="customers-primary" onClick={sharePdf} disabled={pdfBusy}><Share2 size={15} /> {pdfBusy ? 'Preparando…' : 'Compartilhar'}</button></footer>
  </section></div>;
}
