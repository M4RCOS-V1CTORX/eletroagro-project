import {useSyncRefresh} from './useSyncRefresh.js';
import {createReceiptPdf} from './receiptPdf.js';
import { useEffect, useMemo, useState } from 'react';
import { Check, Download, FileCheck2, LoaderCircle, ReceiptText, Search } from 'lucide-react';
import {savePdfToDevice} from './deviceFiles.js';
import { apiRequest } from './apiClient.js';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const methods = { pix: 'Pix', cash: 'Dinheiro', card_debit: 'Cartão de débito', card_credit: 'Cartão de crédito', transfer: 'Transferência', boleto: 'Boleto', other: 'Outro' };
const dateText = (value) => new Intl.DateTimeFormat('pt-BR').format(new Date(`${String(value).slice(0, 10)}T12:00:00`));

export default function ReceiptsPage() {
  useSyncRefresh(()=>load());
  const [payments, setPayments] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function load() { setLoading(true); setError(''); try { const result = await apiRequest('/api/completion/payments'); setPayments(result.payments || []); } catch (requestError) { setError(requestError.message); } finally { setLoading(false); } }
  useEffect(() => { load(); }, []);
  const filtered = useMemo(() => { const term = query.trim().toLowerCase(); return term ? payments.filter((item) => `${item.title} ${item.related_name || ''}`.toLowerCase().includes(term)) : payments; }, [payments, query]);
  async function createReceipt(payment) {
    setBusyId(payment.id); setError(''); setNotice('');
    try { const result = await apiRequest('/api/completion/receipts', { method: 'POST', body: JSON.stringify({ paymentId: payment.id, signatureRequired: true }) }); await downloadReceipt(result.receipt.id); setNotice(result.queued?result.message:`Recibo #${String(result.receipt.receipt_number).padStart(4, '0')} gerado.`); await load(); }
    catch (requestError) { setError(requestError.message); }
    finally { setBusyId(''); }
  }
  async function downloadReceipt(id) {
    const {receipt}=await apiRequest(`/api/completion/receipts/${id}`);
    const {doc,filename}=await createReceiptPdf(receipt);await savePdfToDevice(doc,filename);
  }

  return <section className="workspace-page receipts-page"><header className="workspace-heading workspace-heading-green"><div><span className="workspace-eyebrow">DOCUMENTOS FINANCEIROS</span><h1>Recibos</h1><p>Gere um recibo numerado para cada pagamento ou recebimento registrado.</p></div></header>
    <div className="receipts-toolbar"><form className="workspace-search" onSubmit={(event) => event.preventDefault()}><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar descrição, cliente ou fornecedor"/></form><span><ReceiptText size={16}/>{payments.length} pagamento(s)</span></div>
    {error && <div className="workspace-message is-error" role="alert">{error}<button onClick={load}>Tentar novamente</button></div>}{notice && <div className="workspace-message is-success" role="status"><Check size={16}/>{notice}</div>}
    <div className="receipts-list">{loading ? <div className="receipts-empty"><LoaderCircle className="spin"/>Carregando pagamentos…</div> : filtered.length ? filtered.map((payment) => <article key={payment.id}><span className={`receipt-kind ${payment.entry_type}`}><FileCheck2 size={19}/></span><div><strong>{payment.title}</strong><small>{payment.related_name || (payment.entry_type === 'income' ? 'Recebimento' : 'Pagamento')} · {dateText(payment.paid_at)} · {methods[payment.payment_method] || payment.payment_method}</small></div><b>{brl.format(Number(payment.amount))}</b>{payment.receipt_id ? <button className="workspace-button subtle" onClick={() => downloadReceipt(payment.receipt_id).catch(error=>setError(error.message))}><Download size={15}/> {payment.receipt_is_provisional?'Baixar recibo provisório':`Baixar recibo #${String(payment.receipt_number).padStart(4, '0')}`}</button> : <button className="workspace-button primary" disabled={!!busyId} onClick={() => createReceipt(payment)}>{busyId === payment.id ? 'Gerando…' : 'Gerar recibo'}</button>}</article>) : <div className="receipts-empty"><ReceiptText/>Nenhum pagamento encontrado.</div>}</div>
  </section>;
}
