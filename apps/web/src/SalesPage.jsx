import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banknote, CalendarDays, Check, ChevronLeft, ChevronRight, CircleDollarSign, ClipboardList, CreditCard, Download, Eye, FileText, LoaderCircle, Plus, Search, Share2, ShoppingBag, TriangleAlert, X } from 'lucide-react';
import { getAuthAccessToken } from './authClient.js';

const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const statusLabels = { completed: 'Concluída', cancelled: 'Cancelada' };
const paymentLabels = { pending: 'A receber', partial: 'Parcial', paid: 'Recebida' };
const methodLabels = { pix: 'Pix', cash: 'Dinheiro', card_debit: 'Cartão de débito', card_credit: 'Cartão de crédito', transfer: 'Transferência', boleto: 'Boleto', other: 'Outro' };
const today = (() => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; })();
const emptyItem = () => ({ catalogItemId: '', isCustom: false, name: '', itemType: 'product', unit: 'un', quantity: '1', unitPrice: '0', description: '' });

async function apiRequest(path, options = {}) {
  const token = await getAuthAccessToken();
  const send = (accessToken) => fetch(`${apiUrl}${path}`, { ...options, headers: { Authorization: `Bearer ${accessToken}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  let response = await send(token);
  if (response.status === 401) {
    const freshToken = await getAuthAccessToken(undefined, { forceRefresh: true }).catch(() => null);
    if (freshToken && freshToken !== token) response = await send(freshToken);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || 'Não foi possível concluir a operação.');
  return body;
}

function dateLabel(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${String(value).slice(0, 10)}T12:00:00`));
}

async function createSalePdf(sale, company) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const width = 210; const margin = 17; const right = width - margin;
  const blue = [22, 93, 139]; const green = [55, 126, 85]; const ink = [31, 48, 62]; const muted = [103, 119, 132];
  const text = (value, x, y, options) => doc.text(String(value ?? ''), x, y, options);
  const number = String(sale.sale_number).padStart(4, '0');
  const filePart = (sale.customer_name || 'cliente').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  doc.setFillColor(...blue); doc.rect(0, 0, width, 39, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(16); text(company?.name || 'EletroAgro', margin, 17);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); text([company?.tax_identifier, company?.phone, company?.email].filter(Boolean).join('  ·  ') || 'Comprovante comercial', margin, 25);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); text(`COMPROVANTE DE VENDA  #${number}`, right, 17, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); text(`Emitido em ${dateLabel(sale.sale_date)}`, right, 25, { align: 'right' });
  let y = 51;
  doc.setTextColor(...blue); doc.setFont('helvetica', 'bold'); doc.setFontSize(9); text('CLIENTE', margin, y);
  doc.setTextColor(...ink); doc.setFontSize(12); text(sale.customer_name || 'Cliente', margin, y + 7);
  doc.setTextColor(...muted); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  if (sale.customer_tax_identifier) text(`CPF/CNPJ: ${sale.customer_tax_identifier}`, margin, y + 14);
  if (sale.customer_phone) text(`Telefone: ${sale.customer_phone}`, right, y + 14, { align: 'right' });
  y += 27;
  doc.setFillColor(239, 245, 248); doc.roundedRect(margin, y, width - margin * 2, 12, 2, 2, 'F');
  doc.setTextColor(...ink); doc.setFont('helvetica', 'bold'); doc.setFontSize(9); text('Pagamento', margin + 4, y + 7.5);
  doc.setFont('helvetica', 'normal'); text(methodLabels[sale.payment_method] || 'Outro', margin + 30, y + 7.5);
  text(paymentLabels[sale.payment_status] || '', right - 4, y + 7.5, { align: 'right' });
  y += 24;
  doc.setFillColor(...blue); doc.roundedRect(margin, y, width - margin * 2, 9, 1.5, 1.5, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
  const col = { item: margin + 3, qty: 121, unit: 153, total: right - 3 };
  text('PRODUTO / SERVIÇO', col.item, y + 6); text('QTD.', col.qty, y + 6, { align: 'right' }); text('UNITÁRIO', col.unit, y + 6, { align: 'right' }); text('TOTAL', col.total, y + 6, { align: 'right' });
  y += 14; doc.setFont('helvetica', 'normal'); doc.setTextColor(...ink);
  for (const item of sale.items || []) {
    if (y > 256) { doc.addPage(); y = 20; }
    const itemLines = doc.splitTextToSize(item.name || 'Item', 91);
    const description = item.description ? doc.splitTextToSize(item.description, 91) : [];
    const rowHeight = Math.max(10, itemLines.length * 4.5 + description.length * 3.5 + 2);
    doc.setDrawColor(223, 231, 235); doc.line(margin, y + rowHeight, right, y + rowHeight);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); text(itemLines, col.item, y + 3.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); if (description.length) { doc.setTextColor(...muted); text(description, col.item, y + 4 + itemLines.length * 4.2); doc.setTextColor(...ink); }
    doc.setFontSize(8); text(`${item.quantity} ${item.unit || ''}`.trim(), col.qty, y + 4, { align: 'right' }); text(currency.format(Number(item.unit_price)).replace(/[\u00a0\u202f]/g, ' '), col.unit, y + 4, { align: 'right' }); text(currency.format(Number(item.line_total)).replace(/[\u00a0\u202f]/g, ' '), col.total, y + 4, { align: 'right' });
    y += rowHeight + 2;
  }
  if (y > 260) { doc.addPage(); y = 22; }
  const totalX = 121; y += 7;
  const line = (label, value, bold = false) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setTextColor(...(bold ? blue : muted)); doc.setFontSize(bold ? 12 : 9); text(label, totalX, y); text(currency.format(Number(value)).replace(/[\u00a0\u202f]/g, ' '), right, y, { align: 'right' }); y += bold ? 11 : 7; };
  line('Subtotal', sale.subtotal); if (Number(sale.discount_amount) > 0) line('Desconto', -Number(sale.discount_amount));
  doc.setDrawColor(...blue); doc.setLineWidth(.5); doc.line(totalX, y - 2, right, y - 2); line('Total da venda', sale.total, true); line('Recebido', sale.amount_paid);
  doc.setFillColor(235, 246, 239); doc.roundedRect(totalX - 2, y - 4, right - totalX + 4, 13, 2, 2, 'F'); doc.setTextColor(...green); doc.setFont('helvetica', 'bold'); doc.setFontSize(10); text('Saldo em aberto', totalX + 2, y + 4); text(currency.format(Number(sale.total) - Number(sale.amount_paid)).replace(/[\u00a0\u202f]/g, ' '), right - 2, y + 4, { align: 'right' });
  y += 24;
  if (sale.payments?.length) {
    doc.setTextColor(...blue); doc.setFont('helvetica', 'bold'); doc.setFontSize(9); text('RECEBIMENTOS', margin, y); y += 7;
    for (const payment of sale.payments) { doc.setFont('helvetica', 'normal'); doc.setTextColor(...muted); doc.setFontSize(8); text(`${dateLabel(payment.received_date)}  ·  ${methodLabels[payment.payment_method] || 'Outro'}`, margin, y); doc.setTextColor(...green); text(currency.format(Number(payment.amount)).replace(/[\u00a0\u202f]/g, ' '), right, y, { align: 'right' }); y += 6; }
  }
  if (sale.notes) { y += 7; doc.setTextColor(...blue); doc.setFont('helvetica', 'bold'); doc.setFontSize(9); text('OBSERVAÇÕES', margin, y); y += 5; doc.setTextColor(...muted); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); text(doc.splitTextToSize(sale.notes, width - margin * 2), margin, y); }
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) { doc.setPage(page); doc.setDrawColor(222, 231, 235); doc.line(margin, 281, right, 281); doc.setTextColor(...muted); doc.setFontSize(7); doc.text('Documento comercial — não fiscal', margin, 286); doc.text(`${page} / ${pageCount}`, right, 286, { align: 'right' }); }
  return { doc, filename: `venda-${number}-${filePart || 'cliente'}.pdf` };
}

function cents(value) { const amount = Number(value || 0); return Number.isFinite(amount) ? Math.round(amount * 100) : 0; }
function previewTotal(draft) {
  const subtotal = (draft.items || []).reduce((sum, item) => sum + Math.round(cents(item.unitPrice) * Number(item.quantity || 0)), 0);
  const discount = cents(draft.discountAmount);
  return { subtotal, total: Math.max(0, subtotal - discount) };
}

export default function SalesPage() {
  const [sales, setSales] = useState([]);
  const [summary, setSummary] = useState({ sales_count: 0, sales_total: '0', received_total: '0', outstanding_total: '0', open_count: 0 });
  const [pagination, setPagination] = useState({ total: 0, limit: 25, offset: 0 });
  const [status, setStatus] = useState('all');
  const [paymentStatus, setPaymentStatus] = useState('all');
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [approvedQuotes, setApprovedQuotes] = useState([]);
  const [details, setDetails] = useState(null);
  const [paymentDraft, setPaymentDraft] = useState(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  const loadSales = useCallback(async (offset = 0) => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ status, paymentStatus, q: appliedQuery, limit: String(pagination.limit), offset: String(offset), from, to });
      const [result, summaryResult] = await Promise.all([apiRequest(`/api/sales?${params}`), apiRequest(`/api/sales/summary?from=${from}&to=${to}`)]);
      setSales(result.sales); setPagination((current) => ({ ...current, ...result.pagination }));
      if (summaryResult.summary) setSummary(summaryResult.summary);
    } catch (loadError) { setError(loadError.message); }
    finally { setLoading(false); }
  }, [status, paymentStatus, appliedQuery, pagination.limit, from, to]);

  useEffect(() => { loadSales(0); }, [loadSales]);

  async function beginSale() {
    setError(''); setNotice(''); setBusy(true);
    try {
      const [customerResult, productResult, serviceResult, quoteResult] = await Promise.all([
        apiRequest('/api/customers?limit=100&order=asc'),
        apiRequest('/api/catalog?type=product&status=active'),
        apiRequest('/api/catalog?type=service&status=active'),
        apiRequest('/api/sales/approved-quotes'),
      ]);
      setCustomers(customerResult.customers); setCatalog([...productResult.items, ...serviceResult.items]);
      setApprovedQuotes(quoteResult.quotes);
      setDraft({ quoteId: '', customerId: '', saleDate: today, dueDate: '', paymentMethod: 'pix', amountPaid: '0', discountAmount: '0', notes: '', items: [emptyItem()] });
    } catch (loadError) { setError(loadError.message); }
    finally { setBusy(false); }
  }

  async function chooseQuote(quoteId) {
    if (!quoteId) { setDraft((current) => ({ ...current, quoteId: '', items: [emptyItem()], customerId: '' })); return; }
    setBusy(true); setError('');
    try {
      const result = await apiRequest(`/api/quotes/${quoteId}`);
      setDraft((current) => ({ ...current, quoteId, customerId: result.quote.customer_id || '', discountAmount: String(result.quote.discount_amount || '0'), notes: result.quote.notes || '', items: result.quote.items.map((item) => ({ catalogItemId: item.catalog_item_id || '', name: item.name, itemType: item.item_type, unit: item.unit, quantity: String(item.quantity), unitPrice: String(item.unit_price), description: item.description || '' })) }));
    } catch (loadError) { setError(loadError.message); }
    finally { setBusy(false); }
  }

  function updateItem(index, changes) {
    setDraft((current) => ({ ...current, items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...changes } : item) }));
  }

  function chooseCatalog(index, id) {
    if (id === 'custom') { updateItem(index, { catalogItemId: '', isCustom: true, name: '', itemType: 'product', unit: 'un', unitPrice: '0', description: '' }); return; }
    const item = catalog.find((entry) => entry.id === id);
    if (!item) { updateItem(index, { catalogItemId: '', isCustom: false, name: '' }); return; }
    updateItem(index, { catalogItemId: item.id, isCustom: false, name: item.name, itemType: item.item_type, unit: item.unit || 'un', unitPrice: String(item.sale_price || '0'), description: item.description || '' });
  }

  async function saveSale(event) {
    event.preventDefault(); setBusy(true); setError('');
    const payload = { ...draft, amountPaid: draft.amountPaid || '0', discountAmount: draft.discountAmount || '0' };
    if (payload.quoteId) { delete payload.customerId; delete payload.items; delete payload.discountAmount; }
    try {
      const result = await apiRequest('/api/sales', { method: 'POST', body: JSON.stringify(payload) });
      setDraft(null); setNotice(`Venda #${String(result.sale.sale_number).padStart(4, '0')} registrada.`);
      setStatus('all'); setPaymentStatus('all'); setAppliedQuery(''); setQuery('');
      await loadSales(0);
    } catch (saveError) { setError(saveError.message); }
    finally { setBusy(false); }
  }

  async function openDetails(sale) {
    setBusy(true); setError('');
    try { const result = await apiRequest(`/api/sales/${sale.id}`); setDetails(result.sale); }
    catch (loadError) { setError(loadError.message); }
    finally { setBusy(false); }
  }

  async function cancelSale(sale) {
    const reason = window.prompt(`Motivo do cancelamento da venda #${String(sale.sale_number).padStart(4, '0')}:`);
    if (reason === null) return;
    if (reason.trim().length < 3) { setError('Informe um motivo com pelo menos 3 caracteres.'); return; }
    setBusy(true); setError('');
    try {
      await apiRequest(`/api/sales/${sale.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
      setDetails(null); setNotice('Venda cancelada. O histórico foi preservado.'); await loadSales(pagination.offset);
    } catch (cancelError) { setError(cancelError.message); }
    finally { setBusy(false); }
  }

  async function savePayment(event) {
    event.preventDefault();
    if (!details) return;
    setBusy(true); setError('');
    try {
      await apiRequest(`/api/sales/${details.id}/payments`, { method: 'POST', body: JSON.stringify(paymentDraft) });
      setPaymentDraft(null); setNotice('Recebimento registrado.');
      await Promise.all([openDetails({ id: details.id }), loadSales(pagination.offset)]);
    } catch (paymentError) { setError(paymentError.message); }
    finally { setBusy(false); }
  }

  async function downloadSalePdf() {
    if (!details) return;
    setPdfBusy(true); setError('');
    try {
      const [fresh, company] = await Promise.all([apiRequest(`/api/sales/${details.id}`), apiRequest('/api/company/me')]);
      const { doc, filename } = await createSalePdf(fresh.sale, company.company);
      doc.save(filename); setNotice(`Comprovante da venda #${String(details.sale_number).padStart(4, '0')} baixado.`);
    } catch (pdfError) { setError(pdfError.message || 'Não foi possível gerar o comprovante.'); }
    finally { setPdfBusy(false); }
  }

  async function shareSalePdf() {
    if (!details) return;
    setPdfBusy(true); setError('');
    try {
      const [fresh, company] = await Promise.all([apiRequest(`/api/sales/${details.id}`), apiRequest('/api/company/me')]);
      const { doc, filename } = await createSalePdf(fresh.sale, company.company);
      const file = new File([doc.output('blob')], filename, { type: 'application/pdf' });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: `Venda #${String(details.sale_number).padStart(4, '0')}`, text: `Comprovante da venda para ${details.customer_name}` });
      else { doc.save(filename); setNotice('Seu dispositivo não permite compartilhar o PDF diretamente. O comprovante foi baixado para você enviar.'); }
    } catch (pdfError) { if (pdfError.name !== 'AbortError') setError(pdfError.message || 'Não foi possível compartilhar o comprovante.'); }
    finally { setPdfBusy(false); }
  }

  const totalPreview = useMemo(() => draft ? previewTotal(draft) : { subtotal: 0, total: 0 }, [draft]);
  const pageCount = Math.max(1, Math.ceil(pagination.total / pagination.limit));
  const currentPage = Math.floor(pagination.offset / pagination.limit) + 1;

  return <section className="customers-page sales-page">
    <div className="customers-heading"><div><span className="customers-kicker">COMERCIAL</span><h1>Vendas</h1><p>Registre vendas, acompanhe recebimentos e converta orçamentos aprovados.</p></div><button className="customers-primary add-customer-button" onClick={beginSale} disabled={busy}><Plus size={17} /> Nova venda</button></div>
    {error && !draft && <p className="customers-feedback error" role="alert">{error}<button onClick={() => loadSales(pagination.offset)}>Tentar novamente</button></p>}
    {notice && <p className="customers-feedback success" role="status">{notice}<button aria-label="Fechar mensagem" onClick={() => setNotice('')}><X size={15} /></button></p>}
    <div className="sales-summary-grid">
      <article className="sales-summary-card sales-summary-primary"><span className="sales-summary-icon"><ShoppingBag size={18} /></span><span>Vendas neste mês</span><strong>{summary.sales_count}</strong><small>{currency.format(Number(summary.sales_total || 0))} em vendas concluídas</small></article>
      <article className="sales-summary-card"><span className="sales-summary-icon received"><Check size={18} /></span><span>Valor recebido</span><strong>{currency.format(Number(summary.received_total || 0))}</strong><small>Nas vendas registradas neste mês</small></article>
      <article className="sales-summary-card"><span className="sales-summary-icon due"><Banknote size={18} /></span><span>Em aberto</span><strong>{currency.format(Number(summary.outstanding_total || 0))}</strong><small>{summary.open_count} {Number(summary.open_count) === 1 ? 'venda aguardando' : 'vendas aguardando'} recebimento completo</small></article>
      <article className="sales-summary-card sales-overdue-card"><span className="sales-summary-icon overdue"><TriangleAlert size={18} /></span><span>Em atraso</span><strong>{currency.format(Number(summary.overdue_total || 0))}</strong><small>{summary.overdue_count || 0} venda(s) com vencimento passado</small></article>
    </div>
    <div className="customers-toolbar sales-toolbar">
      <form className="customers-search" onSubmit={(event) => { event.preventDefault(); setAppliedQuery(query.trim()); }}><Search size={17} /><input aria-label="Pesquisar vendas" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por cliente ou número da venda" /><button type="submit">Buscar</button></form>
      <label className="sales-date-filter">De<input aria-label="Data inicial" type="date" value={from} max={to} onChange={(event) => { setFrom(event.target.value); setPagination((current) => ({ ...current, offset: 0 })); }} /></label><label className="sales-date-filter">Até<input aria-label="Data final" type="date" value={to} min={from} onChange={(event) => { setTo(event.target.value); setPagination((current) => ({ ...current, offset: 0 })); }} /></label>
      <select className="catalog-status" aria-label="Filtrar situação da venda" value={status} onChange={(event) => { setStatus(event.target.value); setPagination((current) => ({ ...current, offset: 0 })); }}><option value="all">Todas as situações</option><option value="completed">Concluídas</option><option value="cancelled">Canceladas</option></select>
      <select className="catalog-status" aria-label="Filtrar situação do pagamento" value={paymentStatus} onChange={(event) => { setPaymentStatus(event.target.value); setPagination((current) => ({ ...current, offset: 0 })); }}><option value="all">Todos os pagamentos</option><option value="pending">A receber</option><option value="partial">Parciais</option><option value="paid">Recebidas</option><option value="overdue">Em atraso</option></select>
    </div>
    <div className="customers-summary"><span><ClipboardList size={16} /> {pagination.total} {pagination.total === 1 ? 'venda' : 'vendas'}</span><span>Ordenadas da mais recente para a mais antiga</span></div>
    <div className="customers-table-wrap"><table className="customers-table sales-table"><thead><tr><th>Venda</th><th>Cliente</th><th>Data</th><th>Pagamento</th><th>Valor</th><th>Recebimento</th><th>Situação</th><th><span className="sr-only">Ações</span></th></tr></thead><tbody>
      {loading && !sales.length && <tr><td colSpan="8" className="customers-table-state"><LoaderCircle size={18} className="spin" /> Carregando vendas…</td></tr>}
      {!loading && !sales.length && <tr><td colSpan="8" className="customers-table-state"><span className="empty-customers-icon"><ShoppingBag size={21} /></span><strong>{appliedQuery ? 'Nenhuma venda encontrada' : 'Suas vendas aparecerão aqui'}</strong><span>{appliedQuery ? 'Tente buscar por outro cliente ou número.' : 'Registre uma venda ou converta um orçamento aprovado.'}</span></td></tr>}
      {sales.map((sale) => <tr key={sale.id}>
        <td><strong className="sale-number">#{String(sale.sale_number).padStart(4, '0')}</strong>{sale.quote_id && <span className="customer-type">Origem: orçamento</span>}</td>
        <td><strong className="customer-name">{sale.customer_name}</strong></td>
        <td>{dateLabel(sale.sale_date)}{sale.due_date && <small className={sale.overdue ? 'sale-due-overdue' : ''}>{sale.overdue ? 'Atrasada · vence ' : 'Vence '}{dateLabel(sale.due_date)}</small>}</td>
        <td><span className="sale-method"><CreditCard size={13} /> {methodLabels[sale.payment_method] || 'Outro'}</span></td>
        <td><strong className="sale-total">{currency.format(Number(sale.total))}</strong><small>Recebido {currency.format(Number(sale.amount_paid))}</small></td>
        <td><span className={`catalog-badge sale-payment sale-payment-${sale.payment_status}`}>{paymentLabels[sale.payment_status]}</span></td>
        <td><span className={`catalog-badge sale-state sale-state-${sale.status}`}>{statusLabels[sale.status]}</span></td>
        <td><div className="customer-actions"><button onClick={() => openDetails(sale)} aria-label={`Ver venda ${sale.sale_number}`} title="Ver detalhes"><Eye size={15} /></button></div></td>
      </tr>)}
    </tbody></table></div>
    <div className="customers-pagination"><span>Página {currentPage} de {pageCount}</span><div><button aria-label="Página anterior" disabled={currentPage <= 1 || loading} onClick={() => loadSales(Math.max(0, pagination.offset - pagination.limit))}><ChevronLeft size={16} /></button><span>{pagination.total ? `${pagination.offset + 1}–${Math.min(pagination.offset + sales.length, pagination.total)} de ${pagination.total}` : '0 resultados'}</span><button aria-label="Próxima página" disabled={currentPage >= pageCount || loading} onClick={() => loadSales(pagination.offset + pagination.limit)}><ChevronRight size={16} /></button></div></div>

    {draft && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setDraft(null); }}><section className="customer-modal sales-modal" role="dialog" aria-modal="true" aria-labelledby="sale-modal-title">
      <header className="customer-modal-heading"><div><span className="customers-kicker">NOVA VENDA</span><h2 id="sale-modal-title">Registrar venda</h2></div><button className="modal-close" onClick={() => setDraft(null)} disabled={busy} aria-label="Fechar"><X size={18} /></button></header>
      {error && <p className="customers-feedback error" role="alert">{error}</p>}
      <form className="customer-form sales-form" onSubmit={saveSale}>
        <label className="field-wide">Converter orçamento aprovado<select value={draft.quoteId} disabled={busy} onChange={(event) => chooseQuote(event.target.value)}><option value="">Venda avulsa, sem orçamento</option>{approvedQuotes.map((quote) => <option key={quote.id} value={quote.id}>Orçamento #{String(quote.quote_number).padStart(4, '0')} · {quote.customer_name} · {currency.format(Number(quote.total))}</option>)}</select><small className="sales-field-help">A conversão importa cliente, itens e valores do orçamento. Cada orçamento só pode ser convertido uma vez.</small></label>
        {draft.quoteId ? <div className="sales-quote-source field-wide"><ClipboardList size={18} /><span><strong>Itens copiados do orçamento</strong><small>{draft.items.length} {draft.items.length === 1 ? 'item' : 'itens'} · Total {currency.format(Number(draft.items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitPrice), 0) - Number(draft.discountAmount || 0)))}</small></span></div> : <>
          <label className="field-wide">Cliente<select required value={draft.customerId} onChange={(event) => setDraft({ ...draft, customerId: event.target.value })}><option value="">Selecione um cliente</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
          <div className="sales-items field-wide"><div className="sales-items-heading"><strong>Produtos e serviços</strong><button type="button" className="customers-secondary" onClick={() => setDraft({ ...draft, items: [...draft.items, emptyItem()] })}><Plus size={14} /> Adicionar item</button></div>
            {draft.items.map((item, index) => <div className="sales-item-card" key={index}>
              <div className="sales-item-top"><label>Item<select required value={item.catalogItemId || (item.isCustom ? 'custom' : '')} onChange={(event) => chooseCatalog(index, event.target.value)}><option value="">Selecione do catálogo</option>{catalog.filter((entry) => entry.item_type === 'product').length > 0 && <optgroup label="Produtos">{catalog.filter((entry) => entry.item_type === 'product').map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</optgroup>}{catalog.filter((entry) => entry.item_type === 'service').length > 0 && <optgroup label="Serviços">{catalog.filter((entry) => entry.item_type === 'service').map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</optgroup>}<option value="custom">Item avulso</option></select></label><button type="button" className="sales-remove-item" aria-label="Remover item" disabled={draft.items.length <= 1} onClick={() => setDraft({ ...draft, items: draft.items.filter((_, itemIndex) => index !== itemIndex) })}><X size={15} /></button></div>
              {(item.catalogItemId || item.isCustom) && <><div className="sales-item-fields"><label>Quantidade<input required type="number" min="0.001" step="0.001" value={item.quantity} onChange={(event) => updateItem(index, { quantity: event.target.value })} /></label><label>Preço unitário<input required type="number" min="0" step="0.01" value={item.unitPrice} onChange={(event) => updateItem(index, { unitPrice: event.target.value })} /></label>{item.isCustom && <><label>Unidade<input required maxLength="20" value={item.unit} onChange={(event) => updateItem(index, { unit: event.target.value })} /></label><label>Tipo<select value={item.itemType} onChange={(event) => updateItem(index, { itemType: event.target.value })}><option value="product">Produto</option><option value="service">Serviço</option></select></label><label className="sales-custom-name">Descrição do item<input required minLength="2" maxLength="180" value={item.name} onChange={(event) => updateItem(index, { name: event.target.value })} /></label></>}</div><div className="sales-item-line-total">Total do item <strong>{currency.format(Math.round(cents(item.unitPrice) * Number(item.quantity || 0)) / 100)}</strong></div></>}
            </div>)}
          </div>
          <label>Desconto total (R$)<input type="number" min="0" step="0.01" value={draft.discountAmount} onChange={(event) => setDraft({ ...draft, discountAmount: event.target.value })} /></label>
          <div className="sales-preview-total"><span>Subtotal <b>{currency.format(totalPreview.subtotal / 100)}</b></span><strong>Total da venda <b>{currency.format(totalPreview.total / 100)}</b></strong></div>
          <label className="field-wide">Observações<textarea rows="2" maxLength="5000" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Informações adicionais da venda" /></label>
        </>}
        <label>Data da venda<input required type="date" value={draft.saleDate} onChange={(event) => setDraft({ ...draft, saleDate: event.target.value })} /></label>
        <label>Vencimento (opcional)<input type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></label>
        <label>Forma de pagamento<select required value={draft.paymentMethod} onChange={(event) => setDraft({ ...draft, paymentMethod: event.target.value })}><option value="pix">Pix</option><option value="cash">Dinheiro</option><option value="card_debit">Cartão de débito</option><option value="card_credit">Cartão de crédito</option><option value="transfer">Transferência</option><option value="boleto">Boleto</option><option value="other">Outro</option></select></label>
        <label>Valor recebido (R$)<input required type="number" min="0" step="0.01" value={draft.amountPaid} onChange={(event) => setDraft({ ...draft, amountPaid: event.target.value })} /><small className="sales-field-help">O saldo restante fica marcado como a receber.</small></label>
        <div className="customer-form-actions field-wide"><button type="button" className="customers-secondary" onClick={() => setDraft(null)} disabled={busy}>Cancelar</button><button className="customers-primary" disabled={busy || (!draft.quoteId && (!draft.customerId || !draft.items.every((item) => item.catalogItemId || (item.isCustom && item.name.trim().length >= 2))))}>{busy ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />} {busy ? 'Salvando…' : 'Registrar venda'}</button></div>
      </form>
    </section></div>}

    {details && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetails(null); }}><section className="customer-modal sales-details-modal" role="dialog" aria-modal="true" aria-labelledby="sale-details-title">
      <header className="customer-modal-heading"><div><span className="customers-kicker">VENDA #{String(details.sale_number).padStart(4, '0')}</span><h2 id="sale-details-title">{details.customer_name}</h2></div><button className="modal-close" onClick={() => setDetails(null)} aria-label="Fechar"><X size={18} /></button></header>
      <div className="sales-detail-meta"><span><CalendarDays size={14} /> {dateLabel(details.sale_date)}</span><span className={`catalog-badge sale-state sale-state-${details.status}`}>{statusLabels[details.status]}</span><span className={`catalog-badge sale-payment sale-payment-${details.payment_status}`}>{paymentLabels[details.payment_status]}</span></div>
      <div className="customers-table-wrap"><table className="customers-table sales-detail-table"><thead><tr><th>Item</th><th>Qtd.</th><th>Unitário</th><th>Total</th></tr></thead><tbody>{details.items.map((item) => <tr key={item.id}><td><strong className="customer-name">{item.name}</strong>{item.description && <small>{item.description}</small>}</td><td>{item.quantity} {item.unit}</td><td>{currency.format(Number(item.unit_price))}</td><td>{currency.format(Number(item.line_total))}</td></tr>)}</tbody></table></div>
      {details.quote_number && <p className="sales-detail-note">Convertida do orçamento #{String(details.quote_number).padStart(4, '0')}.</p>}
      {details.due_date && <p className="sales-detail-note">Vencimento: {dateLabel(details.due_date)}</p>}
      {details.notes && <p className="sales-detail-note"><b>Observações:</b> {details.notes}</p>}
      {details.status === 'cancelled' && <p className="sales-cancel-note"><TriangleAlert size={15} /> Cancelada: {details.cancellation_reason}</p>}
      {details.payments?.length > 0 && <section className="sales-payment-history"><strong>Recebimentos</strong>{details.payments.map((payment) => <div key={payment.id}><span>{dateLabel(payment.received_date)} · {methodLabels[payment.payment_method]}</span><b>{currency.format(Number(payment.amount))}</b></div>)}</section>}
      <div className="sales-detail-totals"><span>Subtotal <b>{currency.format(Number(details.subtotal))}</b></span>{Number(details.discount_amount) > 0 && <span>Desconto <b>− {currency.format(Number(details.discount_amount))}</b></span>}<span>Recebido <b>{currency.format(Number(details.amount_paid))}</b></span><strong>Saldo em aberto <b>{currency.format(Number(details.total) - Number(details.amount_paid))}</b></strong><strong>Total da venda <b>{currency.format(Number(details.total))}</b></strong></div>
      <footer className="customer-form-actions sales-detail-actions"><button className="customers-secondary" onClick={() => setDetails(null)}>Fechar</button><button className="customers-secondary" onClick={downloadSalePdf} disabled={pdfBusy}><Download size={15} /> Baixar comprovante</button><button className="customers-secondary" onClick={shareSalePdf} disabled={pdfBusy}><Share2 size={15} /> Compartilhar PDF</button>{details.status === 'completed' && Number(details.total) > Number(details.amount_paid) && <button className="customers-primary" onClick={() => { setError(''); setPaymentDraft({ amount: '', paymentMethod: 'pix', receivedDate: today }); }}><Banknote size={15} /> Registrar recebimento</button>}{details.status === 'completed' && <button className="sales-cancel-button" onClick={() => cancelSale(details)} disabled={busy}><X size={15} /> Cancelar venda</button>}</footer>
    </section></div>}

    {paymentDraft && details && <div className="modal-backdrop sales-payment-backdrop" role="presentation"><section className="customer-modal sales-payment-modal" role="dialog" aria-modal="true" aria-labelledby="sale-payment-title"><header className="customer-modal-heading"><div><span className="customers-kicker">VENDA #{String(details.sale_number).padStart(4, '0')}</span><h2 id="sale-payment-title">Registrar recebimento</h2></div><button className="modal-close" onClick={() => setPaymentDraft(null)} aria-label="Fechar"><X size={18} /></button></header>{error && <p className="customers-feedback error" role="alert">{error}</p>}<p className="sales-balance-note">Saldo em aberto: <strong>{currency.format(Number(details.total) - Number(details.amount_paid))}</strong></p><form className="customer-form sales-payment-form" onSubmit={savePayment}><label>Valor recebido (R$)<input required autoFocus type="number" min="0.01" max={Number(details.total) - Number(details.amount_paid)} step="0.01" value={paymentDraft.amount} onChange={(event) => setPaymentDraft({ ...paymentDraft, amount: event.target.value })} /></label><label>Forma de pagamento<select value={paymentDraft.paymentMethod} onChange={(event) => setPaymentDraft({ ...paymentDraft, paymentMethod: event.target.value })}><option value="pix">Pix</option><option value="cash">Dinheiro</option><option value="card_debit">Cartão de débito</option><option value="card_credit">Cartão de crédito</option><option value="transfer">Transferência</option><option value="boleto">Boleto</option><option value="other">Outro</option></select></label><label className="field-wide">Data do recebimento<input required type="date" value={paymentDraft.receivedDate} onChange={(event) => setPaymentDraft({ ...paymentDraft, receivedDate: event.target.value })} /></label><div className="customer-form-actions field-wide"><button type="button" className="customers-secondary" onClick={() => setPaymentDraft(null)} disabled={busy}>Voltar</button><button className="customers-primary" disabled={busy || !paymentDraft.amount}>{busy ? 'Salvando…' : 'Salvar recebimento'}</button></div></form></section></div>}
  </section>;
}
