import {useSyncRefresh} from './useSyncRefresh.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Banknote, CalendarDays, Check, ChevronLeft, ChevronRight, CircleDollarSign, ClipboardList, CreditCard, Download, Eye, FileText, LoaderCircle, Plus, Search, Share2, ShoppingBag, TriangleAlert, X } from 'lucide-react';
import { apiRequest } from './apiClient.js';
import { createSalePdf } from './salePdf.js';
import { ActivitySelect, CustomerStatement, SaleExtraFields } from './SaleExtras.jsx';
import { activityLabels, duplicateSale, dueFromTerm, localToday, saleMessage, saleNumber } from './commercial.js';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const statusLabels = { completed: 'Concluída', cancelled: 'Cancelada' };
const paymentLabels = { pending: 'A receber', partial: 'Parcial', paid: 'Recebida' };
const methodLabels = { pix: 'Pix', cash: 'Dinheiro', card_debit: 'Cartão de débito', card_credit: 'Cartão de crédito', transfer: 'Transferência', boleto: 'Boleto', other: 'Outro' };
const today = (() => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; })();
const emptyItem = () => ({ catalogItemId: '', isCustom: false, name: '', itemType: 'product', unit: 'un', quantity: '1', unitPrice: '0', description: '' });
function dateLabel(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${String(value).slice(0, 10)}T12:00:00`));
}


function cents(value) { const amount = Number(value || 0); return Number.isFinite(amount) ? Math.round(amount * 100) : 0; }
function previewTotal(draft) {
  const subtotal = (draft.items || []).reduce((sum, item) => sum + Math.round(cents(item.unitPrice) * Number(item.quantity || 0)), 0);
  const discount = cents(draft.discountAmount);
  return { subtotal, total: Math.max(0, subtotal - discount + cents(draft.freightAmount)) };
}

export default function SalesPage() {
  useSyncRefresh(()=>{loadSales(pagination.offset);if(details)openDetails({id:details.id});});
  const requestIdentity=useRef(null);
  const [sales, setSales] = useState([]);
  const [activity,setActivity]=useState('all');
  const [profiles,setProfiles]=useState([]);
  const [statementCustomer,setStatementCustomer]=useState(null);
  const [preview,setPreview]=useState(null);
  useEffect(()=>()=>{if(preview?.url)URL.revokeObjectURL(preview.url);},[preview]);
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
      const params = new URLSearchParams({ activity, status, paymentStatus, q: appliedQuery, limit: String(pagination.limit), offset: String(offset), from, to });
      const [result, summaryResult] = await Promise.all([apiRequest(`/api/sales?${params}`), apiRequest(`/api/sales/summary?from=${from}&to=${to}&activity=${activity}`)]);
      setSales(result.sales); setPagination((current) => ({ ...current, ...result.pagination }));
      if (summaryResult.summary) setSummary(summaryResult.summary);
    } catch (loadError) { setError(loadError.message); }
    finally { setLoading(false); }
  }, [activity, status, paymentStatus, appliedQuery, pagination.limit, from, to]);

  useEffect(() => { loadSales(0); }, [loadSales]);

  async function beginSale(source=null) {
    setError(''); setNotice(''); setBusy(true);
    try {
      const [customerResult, productResult, serviceResult, quoteResult,transportResult] = await Promise.all([
        apiRequest('/api/customers?limit=100&order=asc'),
        apiRequest('/api/catalog?type=product&status=active'),
        apiRequest('/api/catalog?type=service&status=active'),
        apiRequest('/api/sales/approved-quotes'),
        apiRequest('/api/sales/transport-profiles'),
      ]);
      setCustomers(customerResult.customers); setCatalog([...productResult.items, ...serviceResult.items]);
      setApprovedQuotes(quoteResult.quotes);setProfiles(transportResult.profiles);
      setDraft(source?.items?duplicateSale(source):{ quoteId: '', customerId: '', saleDate: localToday(), dueDate: '', paymentMethod: 'pix', amountPaid: '0', discountAmount: '0', notes: '', businessActivity:activity==='all'?'unassigned':activity,vehicle:'',plate:'',driver:'',destination:'',freightAmount:'0',freightCost:'0',paymentTermDays:'',items: [emptyItem()] });
      if(source?.items){setDetails(null);setNotice('Revise os produtos, preços e transporte antes de registrar a nova venda.');}
    } catch (loadError) { setError(loadError.message); }
    finally { setBusy(false); }
  }

  async function chooseQuote(quoteId) {
    if (!quoteId) { setDraft((current) => ({ ...current, quoteId: '', items: [emptyItem()], customerId: '' })); return; }
    setBusy(true); setError('');
    try {
      const result = await apiRequest(`/api/quotes/${quoteId}`);
      const customer=customers.find(c=>c.id===result.quote.customer_id);
      setDraft((current) => ({ ...current,paymentTermDays:customer?.payment_term_days??'',dueDate:dueFromTerm(current.saleDate,customer?.payment_term_days), quoteId, customerId: result.quote.customer_id || '', discountAmount: String(result.quote.discount_amount || '0'), notes: result.quote.notes || '', items: result.quote.items.map((item) => ({ catalogItemId: item.catalog_item_id || '', name: item.name, itemType: item.item_type, unit: item.unit, quantity: String(item.quantity), unitPrice: String(item.unit_price), description: item.description || '' })) }));
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
    event.preventDefault(); if(busy)return; setBusy(true); setError('');
    const payload = { ...draft, freightAmount:draft.freightAmount||'0',freightCost:draft.freightCost||'0', amountPaid: draft.amountPaid || '0', discountAmount: draft.discountAmount || '0' };
    if (payload.quoteId) { delete payload.customerId; delete payload.items; delete payload.discountAmount; }
    try {
      const body=JSON.stringify(payload);
      if(requestIdentity.current?.body!==body)requestIdentity.current={body,key:crypto.randomUUID()};
      const result = await apiRequest('/api/sales', { method: 'POST',headers:{'X-Idempotency-Key':requestIdentity.current.key}, body });
      requestIdentity.current=null;
      setDraft(null); setNotice(result.queued?result.message:`Venda #${saleNumber(result.sale)} registrada.`);
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
    const reason = window.prompt(`Motivo do cancelamento da venda #${saleNumber(sale)}:`);
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
      const result=await apiRequest(`/api/sales/${details.id}/payments`, { method: 'POST', body: JSON.stringify(paymentDraft) });
      setPaymentDraft(null); setNotice(result.queued?result.message:'Recebimento registrado.');
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
      doc.save(filename); setNotice(`Nota da venda #${saleNumber(details)} baixado.`);
    } catch (pdfError) { setError(pdfError.message || 'Não foi possível gerar a nota.'); }
    finally { setPdfBusy(false); }
  }

  async function shareSalePdf() {
    if (!details) return;
    setPdfBusy(true); setError('');
    try {
      const [fresh, company] = await Promise.all([apiRequest(`/api/sales/${details.id}`), apiRequest('/api/company/me')]);
      const { doc, filename } = await createSalePdf(fresh.sale, company.company);
      const file = new File([doc.output('blob')], filename, { type: 'application/pdf' });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: `Venda #${saleNumber(details)}`, text: saleMessage(fresh.sale) });
      else { doc.save(filename); setNotice('Seu dispositivo não permite compartilhar o PDF diretamente. O comprovante foi baixado para você enviar.'); }
    } catch (pdfError) { if (pdfError.name !== 'AbortError') setError(pdfError.message || 'Não foi possível compartilhar a nota.'); }
    finally { setPdfBusy(false); }
  }

  async function previewNote() {
    setPdfBusy(true);setError('');
    try {
      const company=await apiRequest('/api/company/me');
      let sale=details;
      if(draft){
        const customer=customers.find(c=>c.id===draft.customerId);
        const totals=previewTotal(draft);
        sale={is_preview:true,customer_name:customer?.name||'Cliente não selecionado',customer_phone:customer?.phone,customer_tax_identifier:customer?.tax_identifier,
          sale_date:draft.saleDate,due_date:draft.dueDate,payment_method:draft.paymentMethod,payment_term_days:draft.paymentTermDays,vehicle:draft.vehicle,plate:draft.plate,driver:draft.driver,destination:draft.destination,
          subtotal:totals.subtotal/100,discount_amount:draft.discountAmount,freight_amount:draft.freightAmount,total:totals.total/100,amount_paid:draft.amountPaid,notes:draft.notes,
          items:draft.items.map(i=>({name:i.name,description:i.description,quantity:i.quantity,unit:i.unit,unit_price:i.unitPrice,line_total:Math.round(cents(i.unitPrice)*Number(i.quantity||0))/100}))};
      }else sale=(await apiRequest(`/api/sales/${details.id}`)).sale;
      const {doc,filename}=await createSalePdf(sale,company.company);
      setPreview({url:URL.createObjectURL(doc.output('blob')),filename});
    }catch(e){setError(e.message);}finally{setPdfBusy(false);}
  }
  async function whatsappNote(){
    if(!details)return;
    const phone=String(details.customer_phone||'').replace(/\D/g,'');
    const normalized=phone.length===10||phone.length===11?'55'+phone:phone;
    window.open(`https://wa.me/${normalized}?text=${encodeURIComponent(saleMessage(details))}`,'_blank','noopener,noreferrer');
    setNotice('Mensagem aberta no WhatsApp. Use “Baixar nota” e anexe o PDF antes de enviar.');
  }
  function quickBananas(){
    const items=[1,2,3].map(grade=>{const name=`Banana prata anã — ${grade}ª`;const existing=catalog.find(i=>i.item_type==='product'&&/banana/i.test(i.name)&&i.name.includes(`${grade}`));return existing?{...emptyItem(),catalogItemId:existing.id,name:existing.name,unit:existing.unit,unitPrice:String(existing.sale_price||'0')}:{...emptyItem(),isCustom:true,name,unit:'kg'};});
    setDraft(current=>({...current,businessActivity:'farm',items:current.items.length===1&&!current.items[0].name?items:[...current.items,...items]}));
  }

  const totalPreview = useMemo(() => draft ? previewTotal(draft) : { subtotal: 0, total: 0 }, [draft]);
  const pageCount = Math.max(1, Math.ceil(pagination.total / pagination.limit));
  const currentPage = Math.floor(pagination.offset / pagination.limit) + 1;

  return <section className="customers-page sales-page">
    {statementCustomer&&<CustomerStatement customerId={statementCustomer} onClose={()=>setStatementCustomer(null)} onOpenSale={sale=>{setStatementCustomer(null);openDetails(sale);}}/>}
    {preview&&<div className="modal-backdrop preview-backdrop"><section className="customer-modal sale-pdf-preview" role="dialog" aria-modal="true" aria-labelledby="pdf-preview-title"><header className="customer-modal-heading"><h2 id="pdf-preview-title">Prévia da nota</h2><button className="modal-close" aria-label="Fechar prévia" onClick={()=>setPreview(null)}><X/></button></header><iframe title="Prévia do PDF da nota de produtos" src={preview.url}/><footer className="customer-form-actions"><a className="customers-secondary" href={preview.url} download={preview.filename}>Baixar PDF</a><button className="customers-secondary" onClick={()=>setPreview(null)}>Fechar</button></footer></section></div>}
    <div className="customers-heading"><div><span className="customers-kicker">COMERCIAL</span><h1>Vendas</h1><p>Registre vendas, acompanhe recebimentos e converta orçamentos aprovados.</p></div><button className="customers-primary add-customer-button" onClick={()=>beginSale()} disabled={busy}><Plus size={17} /> Nova venda</button></div>
    {error && !draft && <p className="customers-feedback error" role="alert">{error}<button onClick={() => loadSales(pagination.offset)}>Tentar novamente</button></p>}
    {notice && <p className="customers-feedback success" role="status">{notice}<button aria-label="Fechar mensagem" onClick={() => setNotice('')}><X size={15} /></button></p>}
    <div className="sales-summary-grid">
      <article className="sales-summary-card sales-summary-primary"><span className="sales-summary-icon"><ShoppingBag size={18} /></span><span>Vendas no período</span><strong>{summary.sales_count}</strong><small>{currency.format(Number(summary.sales_total || 0))} em vendas concluídas</small></article>
      <article className="sales-summary-card"><span className="sales-summary-icon received"><Check size={18} /></span><span>Valor recebido</span><strong>{currency.format(Number(summary.received_total || 0))}</strong><small>Nas vendas do período selecionado</small></article>
      <article className="sales-summary-card"><span className="sales-summary-icon due"><Banknote size={18} /></span><span>Em aberto</span><strong>{currency.format(Number(summary.outstanding_total || 0))}</strong><small>{summary.open_count} {Number(summary.open_count) === 1 ? 'venda aguardando' : 'vendas aguardando'} recebimento completo</small></article>
      <article className="sales-summary-card sales-overdue-card"><span className="sales-summary-icon overdue"><TriangleAlert size={18} /></span><span>Em atraso</span><strong>{currency.format(Number(summary.overdue_total || 0))}</strong><small>{summary.overdue_count || 0} venda(s) com vencimento passado</small></article>
    </div>
    <div className="customers-toolbar sales-toolbar"><ActivitySelect all value={activity} onChange={setActivity}/>
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
        <td><strong className="sale-number">#{saleNumber(sale)}</strong>{['pending','failed'].includes(sale.sync_status)&&<span className="offline-pending-badge">{sale.sync_status==='failed'?'Revisar sincronização':'Aguardando sincronização'}</span>}{sale.quote_id && <span className="customer-type">Origem: orçamento</span>}</td>
        <td><strong className="customer-name">{sale.customer_name}</strong><small>{activityLabels[sale.business_activity||'unassigned']}</small></td>
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
          <label className="field-wide">Cliente<select required value={draft.customerId} onChange={(event) => {const customer=customers.find(c=>c.id===event.target.value);setDraft({ ...draft, customerId: event.target.value,paymentTermDays:customer?.payment_term_days??'',dueDate:dueFromTerm(draft.saleDate,customer?.payment_term_days) });}}><option value="">Selecione um cliente</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
          <div className="sales-items field-wide"><div className="sales-items-heading"><strong>Produtos e serviços</strong><button type="button" className="customers-secondary" onClick={quickBananas}>Adicionar banana 1ª, 2ª e 3ª</button><button type="button" className="customers-secondary" onClick={() => setDraft({ ...draft, items: [...draft.items, emptyItem()] })}><Plus size={14} /> Adicionar item</button></div>
            {draft.items.map((item, index) => <div className="sales-item-card" key={index}>
              <div className="sales-item-top"><label>Item<select required value={item.catalogItemId || (item.isCustom ? 'custom' : '')} onChange={(event) => chooseCatalog(index, event.target.value)}><option value="">Selecione do catálogo</option>{catalog.filter((entry) => entry.item_type === 'product').length > 0 && <optgroup label="Produtos">{catalog.filter((entry) => entry.item_type === 'product').map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</optgroup>}{catalog.filter((entry) => entry.item_type === 'service').length > 0 && <optgroup label="Serviços">{catalog.filter((entry) => entry.item_type === 'service').map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</optgroup>}<option value="custom">Item avulso</option></select></label><button type="button" className="sales-remove-item" aria-label="Remover item" disabled={draft.items.length <= 1} onClick={() => setDraft({ ...draft, items: draft.items.filter((_, itemIndex) => index !== itemIndex) })}><X size={15} /></button></div>
              {(item.catalogItemId || item.isCustom) && <><div className="sales-item-fields"><label>Quantidade<input required type="number" min="0.001" step="0.001" value={item.quantity} onChange={(event) => updateItem(index, { quantity: event.target.value })} /></label><label>Preço unitário<input required type="number" min="0" step="0.01" value={item.unitPrice} onChange={(event) => updateItem(index, { unitPrice: event.target.value })} /></label>{item.isCustom && <><label>Unidade<input required maxLength="20" value={item.unit} onChange={(event) => updateItem(index, { unit: event.target.value })} /></label><label>Tipo<select value={item.itemType} onChange={(event) => updateItem(index, { itemType: event.target.value })}><option value="product">Produto</option><option value="service">Serviço</option></select></label><label className="sales-custom-name">Descrição do item<input required minLength="2" maxLength="180" value={item.name} onChange={(event) => updateItem(index, { name: event.target.value })} /></label></>}</div><div className="sales-item-line-total">Total do item <strong>{currency.format(Math.round(cents(item.unitPrice) * Number(item.quantity || 0)) / 100)}</strong></div></>}
            </div>)}
          </div>
          <label>Desconto total (R$)<input type="number" min="0" step="0.01" value={draft.discountAmount} onChange={(event) => setDraft({ ...draft, discountAmount: event.target.value })} /></label>

          <label className="field-wide">Observações<textarea rows="2" maxLength="5000" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Informações adicionais da venda" /></label>
        </>}
        <SaleExtraFields draft={draft} setDraft={setDraft} profiles={profiles} setProfiles={setProfiles} busy={busy}/><div className="sales-preview-total field-wide"><span>Itens <b>{currency.format(totalPreview.subtotal/100)}</b></span><span>Desconto <b>{currency.format(Number(draft.discountAmount||0))}</b></span><span>Frete <b>{currency.format(Number(draft.freightAmount||0))}</b></span><strong>Total <b>{currency.format(totalPreview.total/100)}</b></strong></div><label>Data da venda<input required type="date" value={draft.saleDate} onChange={(event) => setDraft({ ...draft, saleDate: event.target.value,dueDate:dueFromTerm(event.target.value,draft.paymentTermDays) })} /></label>
        <label>Vencimento (opcional)<input type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></label>
        <label>Forma de pagamento<select required value={draft.paymentMethod} onChange={(event) => setDraft({ ...draft, paymentMethod: event.target.value })}><option value="pix">Pix</option><option value="cash">Dinheiro</option><option value="card_debit">Cartão de débito</option><option value="card_credit">Cartão de crédito</option><option value="transfer">Transferência</option><option value="boleto">Boleto</option><option value="other">Outro</option></select></label>
        <label>Valor recebido (R$)<input required type="number" min="0" step="0.01" value={draft.amountPaid} onChange={(event) => setDraft({ ...draft, amountPaid: event.target.value })} /><small className="sales-field-help">O saldo restante fica marcado como a receber.</small></label>
        <div className="customer-form-actions field-wide"><button type="button" className="customers-secondary" disabled={pdfBusy||busy} onClick={previewNote}>Prévia da nota</button><button type="button" className="customers-secondary" onClick={() => setDraft(null)} disabled={busy}>Cancelar</button><button className="customers-primary" disabled={busy || (!draft.quoteId && (!draft.customerId || !draft.items.every((item) => item.catalogItemId || (item.isCustom && item.name.trim().length >= 2))))}>{busy ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />} {busy ? 'Salvando…' : 'Registrar venda'}</button></div>
      </form>
    </section></div>}

    {details && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetails(null); }}><section className="customer-modal sales-details-modal" role="dialog" aria-modal="true" aria-labelledby="sale-details-title">
      <header className="customer-modal-heading"><div><span className="customers-kicker">VENDA #{saleNumber(details)}</span><h2 id="sale-details-title">{details.customer_name}</h2></div><button className="modal-close" onClick={() => setDetails(null)} aria-label="Fechar"><X size={18} /></button></header>
      <dl className="sale-statement-summary">{[['Atividade',activityLabels[details.business_activity]],['Veículo',details.vehicle],['Placa',details.plate],['Motorista',details.driver],['Destino',details.destination]].filter(([,v])=>v).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><div className="sales-detail-meta"><span><CalendarDays size={14} /> {dateLabel(details.sale_date)}</span><span className={`catalog-badge sale-state sale-state-${details.status}`}>{statusLabels[details.status]}</span><span className={`catalog-badge sale-payment sale-payment-${details.payment_status}`}>{paymentLabels[details.payment_status]}</span></div>
      <div className="customers-table-wrap"><table className="customers-table sales-detail-table"><thead><tr><th>Item</th><th>Qtd.</th><th>Unitário</th><th>Total</th></tr></thead><tbody>{details.items.map((item) => <tr key={item.id}><td><strong className="customer-name">{item.name}</strong>{item.description && <small>{item.description}</small>}</td><td>{item.quantity} {item.unit}</td><td>{currency.format(Number(item.unit_price))}</td><td>{currency.format(Number(item.line_total))}</td></tr>)}</tbody></table></div>
      {details.quote_number && <p className="sales-detail-note">Convertida do orçamento #{String(details.quote_number).padStart(4, '0')}.</p>}
      {details.due_date && <p className="sales-detail-note">Vencimento: {dateLabel(details.due_date)}</p>}
      {details.notes && <p className="sales-detail-note"><b>Observações:</b> {details.notes}</p>}
      {details.status === 'cancelled' && <p className="sales-cancel-note"><TriangleAlert size={15} /> Cancelada: {details.cancellation_reason}</p>}
      {details.payments?.length > 0 && <section className="sales-payment-history"><strong>Recebimentos</strong>{details.payments.map((payment) => <div key={payment.id}><span>{dateLabel(payment.received_date)} · {methodLabels[payment.payment_method]}</span><b>{currency.format(Number(payment.amount))}</b></div>)}</section>}
      <div className="sales-detail-totals"><span>Subtotal <b>{currency.format(Number(details.subtotal))}</b></span>{Number(details.discount_amount) > 0 && <span>Desconto <b>− {currency.format(Number(details.discount_amount))}</b></span>}<span>Frete cobrado <b>{currency.format(Number(details.freight_amount||0))}</b></span><span>Custo do transporte (interno) <b>{currency.format(Number(details.freight_cost||0))}</b></span><span>Recebido <b>{currency.format(Number(details.amount_paid))}</b></span><strong>Saldo em aberto <b>{currency.format(Number(details.total) - Number(details.amount_paid))}</b></strong><strong>Total da venda <b>{currency.format(Number(details.total))}</b></strong></div>
      <footer className="customer-form-actions sales-detail-actions"><button className="customers-secondary" disabled={busy} onClick={()=>beginSale(details)}>Duplicar venda</button>{details.customer_id&&<button className="customers-secondary" onClick={()=>setStatementCustomer(details.customer_id)}>Extrato do cliente</button>}<button className="customers-secondary" disabled={pdfBusy} onClick={previewNote}>Prévia da nota</button><button className="customers-secondary" onClick={whatsappNote}>WhatsApp</button><button className="customers-secondary" onClick={() => setDetails(null)}>Fechar</button><button className="customers-secondary" onClick={downloadSalePdf} disabled={pdfBusy}><Download size={15} /> Baixar nota</button><button className="customers-secondary" onClick={shareSalePdf} disabled={pdfBusy}><Share2 size={15} /> Compartilhar PDF</button>{details.status === 'completed' && Number(details.total) > Number(details.amount_paid) && <button className="customers-primary" onClick={() => { setError(''); setPaymentDraft({ amount: '', paymentMethod: 'pix', receivedDate: today }); }}><Banknote size={15} /> Registrar recebimento</button>}{details.status === 'completed' && <button className="sales-cancel-button" onClick={() => cancelSale(details)} disabled={busy}><X size={15} /> Cancelar venda</button>}</footer>
    </section></div>}

    {paymentDraft && details && <div className="modal-backdrop sales-payment-backdrop" role="presentation"><section className="customer-modal sales-payment-modal" role="dialog" aria-modal="true" aria-labelledby="sale-payment-title"><header className="customer-modal-heading"><div><span className="customers-kicker">VENDA #{saleNumber(details)}</span><h2 id="sale-payment-title">Registrar recebimento</h2></div><button className="modal-close" onClick={() => setPaymentDraft(null)} aria-label="Fechar"><X size={18} /></button></header>{error && <p className="customers-feedback error" role="alert">{error}</p>}<p className="sales-balance-note">Saldo em aberto: <strong>{currency.format(Number(details.total) - Number(details.amount_paid))}</strong></p><form className="customer-form sales-payment-form" onSubmit={savePayment}><label>Valor recebido (R$)<input required autoFocus type="number" min="0.01" max={Number(details.total) - Number(details.amount_paid)} step="0.01" value={paymentDraft.amount} onChange={(event) => setPaymentDraft({ ...paymentDraft, amount: event.target.value })} /></label><label>Forma de pagamento<select value={paymentDraft.paymentMethod} onChange={(event) => setPaymentDraft({ ...paymentDraft, paymentMethod: event.target.value })}><option value="pix">Pix</option><option value="cash">Dinheiro</option><option value="card_debit">Cartão de débito</option><option value="card_credit">Cartão de crédito</option><option value="transfer">Transferência</option><option value="boleto">Boleto</option><option value="other">Outro</option></select></label><label className="field-wide">Data do recebimento<input required type="date" value={paymentDraft.receivedDate} onChange={(event) => setPaymentDraft({ ...paymentDraft, receivedDate: event.target.value })} /></label><div className="customer-form-actions field-wide"><button type="button" className="customers-secondary" onClick={() => setPaymentDraft(null)} disabled={busy}>Voltar</button><button className="customers-primary" disabled={busy || !paymentDraft.amount}>{busy ? 'Salvando…' : 'Salvar recebimento'}</button></div></form></section></div>}
  </section>;
}
