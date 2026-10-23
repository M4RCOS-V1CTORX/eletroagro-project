import { useEffect, useMemo, useState } from 'react';
import { Check, Download, FileCheck2, LoaderCircle, ReceiptText, Search } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { apiRequest } from './apiClient.js';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const methods = { pix: 'Pix', cash: 'Dinheiro', card_debit: 'Cartão de débito', card_credit: 'Cartão de crédito', transfer: 'Transferência', boleto: 'Boleto', other: 'Outro' };
const dateText = (value) => new Intl.DateTimeFormat('pt-BR').format(new Date(`${String(value).slice(0, 10)}T12:00:00`));

export default function ReceiptsPage() {
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
    try { const result = await apiRequest('/api/completion/receipts', { method: 'POST', body: JSON.stringify({ paymentId: payment.id, signatureRequired: true }) }); await downloadReceipt(result.receipt.id); setNotice(`Recibo #${String(result.receipt.receipt_number).padStart(4, '0')} gerado.`); await load(); }
    catch (requestError) { setError(requestError.message); }
    finally { setBusyId(''); }
  }
  async function downloadReceipt(id) {
    const { receipt } = await apiRequest(`/api/completion/receipts/${id}`);
    const settings = { accentColor: '#176da3', footerText: 'Obrigado pela preferência.', showSignature: true, ...(receipt.document_settings || {}) };
    const doc = new jsPDF(); const margin = 18; doc.setDrawColor(settings.accentColor); doc.setLineWidth(1.2); doc.line(margin, 17, 192, 17);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text('RECIBO', margin, 29); doc.setFontSize(11); doc.text(`#${String(receipt.receipt_number).padStart(4, '0')}`, 192, 29, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.text(receipt.company_name, margin, 40); doc.text([receipt.tax_identifier, receipt.phone, receipt.email].filter(Boolean).join(' · '), margin, 46);
    doc.setFillColor(244, 248, 246); doc.roundedRect(margin, 56, 174, 25, 3, 3, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(brl.format(Number(receipt.amount)), 105, 71, { align: 'center' });
    doc.setFontSize(10); doc.setFont('helvetica', 'normal'); const body = `Recebemos de ${receipt.payer_name}, em favor de ${receipt.payee_name}, a importância acima referente a ${receipt.description}. Pagamento realizado em ${dateText(receipt.paid_at)}, por ${methods[receipt.payment_method] || receipt.payment_method}.`;
    const lines = doc.splitTextToSize(body, 174); doc.text(lines, margin, 94, { lineHeightFactor: 1.6 });
    const signatureY = 130 + lines.length * 3; if (settings.showSignature && receipt.signature_required) { doc.line(55, signatureY, 155, signatureY); doc.setFontSize(9); doc.text(receipt.payee_name, 105, signatureY + 6, { align: 'center' }); }
    doc.setFontSize(8); doc.setTextColor(100); doc.text(settings.footerText || '', 105, 278, { align: 'center' }); doc.save(`recibo-${String(receipt.receipt_number).padStart(4, '0')}.pdf`);
  }
  return <section className="workspace-page receipts-page"><header className="workspace-heading workspace-heading-green"><div><span className="workspace-eyebrow">DOCUMENTOS FINANCEIROS</span><h1>Recibos</h1><p>Gere um recibo numerado para cada pagamento ou recebimento registrado.</p></div></header>
    <div className="receipts-toolbar"><form className="workspace-search" onSubmit={(event) => event.preventDefault()}><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar descrição, cliente ou fornecedor"/></form><span><ReceiptText size={16}/>{payments.length} pagamento(s)</span></div>
    {error && <div className="workspace-message is-error">{error}<button onClick={load}>Tentar novamente</button></div>}{notice && <div className="workspace-message is-success"><Check size={16}/>{notice}</div>}
    <div className="receipts-list">{loading ? <div className="receipts-empty"><LoaderCircle className="spin"/>Carregando pagamentos…</div> : filtered.length ? filtered.map((payment) => <article key={payment.id}><span className={`receipt-kind ${payment.entry_type}`}><FileCheck2 size={19}/></span><div><strong>{payment.title}</strong><small>{payment.related_name || (payment.entry_type === 'income' ? 'Recebimento' : 'Pagamento')} · {dateText(payment.paid_at)} · {methods[payment.payment_method] || payment.payment_method}</small></div><b>{brl.format(Number(payment.amount))}</b>{payment.receipt_id ? <button className="workspace-button subtle" onClick={() => downloadReceipt(payment.receipt_id)}><Download size={15}/> Baixar recibo #{String(payment.receipt_number).padStart(4, '0')}</button> : <button className="workspace-button primary" disabled={busyId === payment.id} onClick={() => createReceipt(payment)}>{busyId === payment.id ? 'Gerando…' : 'Gerar recibo'}</button>}</article>) : <div className="receipts-empty"><ReceiptText/>Nenhum pagamento encontrado.</div>}</div>
  </section>;
}
