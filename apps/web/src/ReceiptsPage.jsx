import { useEffect, useMemo, useState } from 'react';
import { Check, Download, FileCheck2, LoaderCircle, ReceiptText, Search } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { apiRequest } from './apiClient.js';
import { createPdfPalette, drawPdfFooters, drawPdfHeader, drawPdfSection, drawPdfSignature, loadPdfLogo, PDF_PAGE } from './pdfDesign.js';

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
    const company = { name: receipt.company_name, tax_identifier: receipt.tax_identifier, phone: receipt.phone, email: receipt.email, document_settings: settings };
    const doc = new jsPDF({ unit: 'mm', format: 'a4' }); const palette = createPdfPalette(company); const logo = await loadPdfLogo(); const margin = PDF_PAGE.margin; const right = PDF_PAGE.width - margin; const number = String(receipt.receipt_number).padStart(4, '0');
    let y = drawPdfHeader(doc, { company, title: 'Recibo', number, subtitle: `Emitido em ${dateText(receipt.paid_at)}`, status: 'Pagamento confirmado', palette, logo });
    doc.setFillColor(...palette.pale); doc.roundedRect(margin, y, right - margin, 29, 3, 3, 'F'); doc.setFillColor(...palette.green); doc.roundedRect(margin, y, 3, 29, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...palette.muted); doc.text('VALOR RECEBIDO', margin + 8, y + 9); doc.setFontSize(19); doc.setTextColor(...palette.navy); doc.text(brl.format(Number(receipt.amount)), margin + 8, y + 21);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...palette.muted); doc.text('FORMA DE PAGAMENTO', right - 6, y + 9, { align: 'right' }); doc.setFontSize(10.5); doc.setTextColor(...palette.ink); doc.text(methods[receipt.payment_method] || receipt.payment_method, right - 6, y + 18, { align: 'right' }); y += 42;
    y = drawPdfSection(doc, y, 'Identificação do pagamento', 'Partes registradas neste recibo', palette);
    const cardWidth = (right - margin - 5) / 2; [['PAGADOR', receipt.payer_name], ['RECEBEDOR', receipt.payee_name]].forEach(([label, value], index) => { const x = margin + index * (cardWidth + 5); doc.setFillColor(...palette.pale); doc.roundedRect(x, y, cardWidth, 22, 2, 2, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...palette.muted); doc.text(label, x + 5, y + 7); doc.setFontSize(10.5); doc.setTextColor(...palette.navy); doc.text(doc.splitTextToSize(String(value || 'Não informado'), cardWidth - 10).slice(0, 2), x + 5, y + 14); }); y += 34;
    y = drawPdfSection(doc, y, 'Declaração', 'Comprovante do valor efetivamente registrado', palette);
    const body = `Declaramos o recebimento de ${receipt.payer_name}, em favor de ${receipt.payee_name}, no valor de ${brl.format(Number(receipt.amount))}, referente a ${receipt.description}. O pagamento foi realizado em ${dateText(receipt.paid_at)}, por ${methods[receipt.payment_method] || receipt.payment_method}.`;
    const lines = doc.splitTextToSize(body, right - margin - 12); const bodyHeight = Math.max(34, 14 + lines.length * 5.1); doc.setFillColor(250, 252, 253); doc.roundedRect(margin, y, right - margin, bodyHeight, 2, 2, 'F'); doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(...palette.ink); doc.text(lines, margin + 6, y + 10, { lineHeightFactor: 1.45 }); y += bodyHeight + 20;
    if (settings.showSignature && receipt.signature_required) drawPdfSignature(doc, Math.min(y, 253), receipt.payee_name || 'Assinatura do recebedor', palette);
    drawPdfFooters(doc, { company, palette, text: settings.footerText }); doc.save(`recibo-${number}.pdf`);
  }
  return <section className="workspace-page receipts-page"><header className="workspace-heading workspace-heading-green"><div><span className="workspace-eyebrow">DOCUMENTOS FINANCEIROS</span><h1>Recibos</h1><p>Gere um recibo numerado para cada pagamento ou recebimento registrado.</p></div></header>
    <div className="receipts-toolbar"><form className="workspace-search" onSubmit={(event) => event.preventDefault()}><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar descrição, cliente ou fornecedor"/></form><span><ReceiptText size={16}/>{payments.length} pagamento(s)</span></div>
    {error && <div className="workspace-message is-error">{error}<button onClick={load}>Tentar novamente</button></div>}{notice && <div className="workspace-message is-success"><Check size={16}/>{notice}</div>}
    <div className="receipts-list">{loading ? <div className="receipts-empty"><LoaderCircle className="spin"/>Carregando pagamentos…</div> : filtered.length ? filtered.map((payment) => <article key={payment.id}><span className={`receipt-kind ${payment.entry_type}`}><FileCheck2 size={19}/></span><div><strong>{payment.title}</strong><small>{payment.related_name || (payment.entry_type === 'income' ? 'Recebimento' : 'Pagamento')} · {dateText(payment.paid_at)} · {methods[payment.payment_method] || payment.payment_method}</small></div><b>{brl.format(Number(payment.amount))}</b>{payment.receipt_id ? <button className="workspace-button subtle" onClick={() => downloadReceipt(payment.receipt_id)}><Download size={15}/> Baixar recibo #{String(payment.receipt_number).padStart(4, '0')}</button> : <button className="workspace-button primary" disabled={busyId === payment.id} onClick={() => createReceipt(payment)}>{busyId === payment.id ? 'Gerando…' : 'Gerar recibo'}</button>}</article>) : <div className="receipts-empty"><ReceiptText/>Nenhum pagamento encontrado.</div>}</div>
  </section>;
}
