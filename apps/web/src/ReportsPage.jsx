import { useEffect, useMemo, useState } from 'react';
import { BarChart3, CalendarRange, Download, FileDown, LoaderCircle, TrendingUp } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { apiRequest } from './apiClient.js';
import { createPdfPalette, drawPdfFooters, drawPdfHeader, drawPdfSection, drawPdfTableHeader, loadPdfLogo, PDF_PAGE } from './pdfDesign.js';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const statusLabels = { draft: 'Rascunho', sent: 'Enviado', approved: 'Aprovado', rejected: 'Recusado', expired: 'Expirado', cancelled: 'Cancelado', open: 'Aberta', scheduled: 'Agendada', in_progress: 'Em andamento', waiting_material: 'Aguardando material', completed: 'Concluída' };
const today = () => new Date().toISOString().slice(0, 10);
const initialFrom = () => { const date = new Date(); date.setMonth(date.getMonth() - 5, 1); return date.toISOString().slice(0, 10); };

export default function ReportsPage() {
  const [range, setRange] = useState({ from: initialFrom(), to: today() });
  const [data, setData] = useState(null);
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true); setError('');
    try { const [report, companyResult] = await Promise.all([apiRequest(`/api/completion/reports?from=${range.from}&to=${range.to}`), apiRequest('/api/company/me')]); setData(report); setCompany(companyResult.company); }
    catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  const maxMonthly = useMemo(() => Math.max(1, ...(data?.monthly || []).map((row) => Math.max(Number(row.sales), Number(row.income), Number(row.expense)))), [data]);
  const result = Number(data?.summary?.income || 0) - Number(data?.summary?.expense || 0);
  const approvalRate = Number(data?.summary?.quotes) ? (Number(data.summary.approved_quotes) / Number(data.summary.quotes)) * 100 : 0;

  function exportCsv() {
    const rows = [['Mês', 'Vendas', 'Receitas', 'Despesas'], ...(data?.monthly || []).map((row) => [row.month, row.sales, row.income, row.expense])];
    const blob = new Blob([`\ufeff${rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(';')).join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `relatorio-${range.from}-${range.to}.csv`; link.click(); URL.revokeObjectURL(link.href);
  }
  async function exportPdf() {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' }); const palette = createPdfPalette(company); const logo = await loadPdfLogo();
    const pageWidth = PDF_PAGE.width; const pageHeight = PDF_PAGE.height; const margin = PDF_PAGE.margin;
    const period = `${range.from.split('-').reverse().join('/')} a ${range.to.split('-').reverse().join('/')}`;
    function nextPage() { doc.addPage(); y = drawPdfHeader(doc, { company, title: 'Relatório gerencial', subtitle: `Período: ${period}`, palette, logo: null, compact: true }); }
    function ensureSpace(height) { if (y + height > pageHeight - 19) nextPage(); }
    function section(title, subtitle = '') {
      ensureSpace(subtitle ? 17 : 12); y = drawPdfSection(doc, y, title, subtitle, palette);
    }
    function tableHeader(left, right) {
      y = drawPdfTableHeader(doc, y, [{ label: left, x: margin + 4 }, { label: right, x: pageWidth - margin - 4, align: 'right' }], palette) + 4;
    }
    function tableRow(label, value, note = '') {
      ensureSpace(10); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...palette.ink); doc.text(String(label || '-'), margin + 4, y);
      if (note) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...palette.muted); doc.text(String(note), margin + 4, y + 4.5); }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...palette.navy); doc.text(String(value ?? '-'), pageWidth - margin - 4, y, { align: 'right' }); doc.setDrawColor(...palette.line); doc.line(margin + 4, y + 6, pageWidth - margin - 4, y + 6); y += note ? 12 : 9;
    }
    drawPdfHeader(doc, { company, title: 'Relatório gerencial', subtitle: `Período: ${period}`, palette, logo });
    const metrics = [['Vendas', brl.format(Number(data.summary.sales))], ['Receitas', brl.format(Number(data.summary.income))], ['Despesas', brl.format(Number(data.summary.expense))], ['Resultado', brl.format(result)], ['Aprovação de orçamentos', `${approvalRate.toFixed(1)}%`], ['Serviços concluídos', String(data.summary.completed_orders)]];
    let y = 49; const cardWidth = (pageWidth - margin * 2 - 8) / 3; metrics.forEach(([label, value], index) => { const column = index % 3; const row = Math.floor(index / 3); const x = margin + column * (cardWidth + 4); const cardY = y + row * 26; const tone = index === 2 ? palette.gold : index === 3 ? palette.green : palette.accent; doc.setFillColor(...palette.pale); doc.roundedRect(x, cardY, cardWidth, 21, 2.5, 2.5, 'F'); doc.setFillColor(...tone); doc.roundedRect(x, cardY, 2.5, 21, 1.2, 1.2, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...palette.muted); doc.text(label.toUpperCase(), x + 6, cardY + 7); doc.setFontSize(12.5); doc.setTextColor(...palette.navy); doc.text(value, x + 6, cardY + 15.5); });
    y = 108; section('Evolução mensal', 'Comparativo entre vendas, receitas e despesas'); tableHeader('Mês', 'Vendas  |  Receitas  |  Despesas');
    (data.monthly || []).forEach((row) => tableRow(row.month.split('-').reverse().join('/'), `${brl.format(Number(row.sales))}  |  ${brl.format(Number(row.income))}  |  ${brl.format(Number(row.expense))}`));
    y += 4; section('Orçamentos e serviços', 'Distribuição por situação no período'); tableHeader('Situação', 'Quantidade  |  Valor');
    (data.quoteStatuses || []).forEach((row) => tableRow(`Orçamento - ${statusLabels[row.status] || row.status}`, `${row.count}  |  ${brl.format(Number(row.total))}`));
    (data.orderStatuses || []).forEach((row) => tableRow(`Serviço - ${statusLabels[row.status] || row.status}`, row.count));
    y += 4; section('Principais clientes'); tableHeader('Cliente', 'Vendas  |  Total');
    if (data.topCustomers?.length) data.topCustomers.forEach((row) => tableRow(row.customer_name, `${row.sales_count}  |  ${brl.format(Number(row.total))}`)); else tableRow('Sem vendas no período', '-');
    y += 4; section('Pontos de atenção'); tableHeader('Produto', 'Estoque  |  Mínimo');
    if (data.lowStock?.length) data.lowStock.forEach((row) => tableRow(row.name, `${Number(row.stock)}  |  ${Number(row.minimum_stock)}`, row.code ? `Código ${row.code}` : 'Estoque abaixo do mínimo')); else tableRow('Estoque regular', 'Nenhum alerta');
    y += 4; section('Atividade da equipe'); tableHeader('Usuário', 'Ações');
    if (data.activity?.length) data.activity.forEach((row) => tableRow(row.actor, row.actions)); else tableRow('Sem atividade no período', '-');
    drawPdfFooters(doc, { company, palette, text: 'Indicadores gerenciais - uso interno' });
    doc.save(`relatorio-${range.from}-${range.to}.pdf`);
  }

  return <section className="workspace-page reports-page">
    <header className="workspace-heading workspace-heading-green"><div><span className="workspace-eyebrow">INTELIGÊNCIA DO NEGÓCIO</span><h1>Relatórios e indicadores</h1><p>Analise vendas, resultado financeiro, serviços, estoque e atividade da equipe.</p></div><div className="workspace-heading-actions"><button className="workspace-button subtle" disabled={!data} onClick={exportCsv}><Download size={16}/> CSV</button><button className="workspace-button primary" disabled={!data} onClick={exportPdf}><FileDown size={16}/> PDF</button></div></header>
    <div className="reports-filter"><CalendarRange size={18}/><label>De<input type="date" value={range.from} max={range.to} onChange={(event) => setRange({ ...range, from: event.target.value })}/></label><label>Até<input type="date" value={range.to} min={range.from} max={today()} onChange={(event) => setRange({ ...range, to: event.target.value })}/></label><button className="workspace-button primary" onClick={load} disabled={loading}>{loading ? 'Atualizando…' : 'Aplicar período'}</button></div>
    {error && <div className="workspace-message is-error">{error}<button onClick={load}>Tentar novamente</button></div>}
    {loading && !data ? <div className="reports-loading"><LoaderCircle className="spin"/>Gerando indicadores…</div> : data && <>
      <div className="reports-metrics">{[
        ['Vendas', brl.format(Number(data.summary.sales)), 'blue'], ['Receitas', brl.format(Number(data.summary.income)), 'green'], ['Despesas', brl.format(Number(data.summary.expense)), 'yellow'], ['Resultado', brl.format(result), result >= 0 ? 'green' : 'red'], ['Aprovação', `${approvalRate.toFixed(1)}%`, 'blue'], ['Serviços concluídos', data.summary.completed_orders, 'green'],
      ].map(([label, value, tone]) => <article className={`report-metric tone-${tone}`} key={label}><span>{label}</span><strong>{value}</strong></article>)}</div>
      <div className="reports-grid">
        <article className="report-panel report-wide"><header><div><BarChart3 size={19}/><span><strong>Evolução mensal</strong><small>Vendas, entradas e saídas do período</small></span></div><TrendingUp size={18}/></header><div className="monthly-chart">{data.monthly.map((row) => <div className="month-column" key={row.month}><div className="month-bars"><i className="sales" style={{ height: `${Math.max(3, Number(row.sales) / maxMonthly * 100)}%` }} title={`Vendas ${brl.format(Number(row.sales))}`}/><i className="income" style={{ height: `${Math.max(3, Number(row.income) / maxMonthly * 100)}%` }} title={`Receitas ${brl.format(Number(row.income))}`}/><i className="expense" style={{ height: `${Math.max(3, Number(row.expense) / maxMonthly * 100)}%` }} title={`Despesas ${brl.format(Number(row.expense))}`}/></div><span>{row.month.slice(5)}/{row.month.slice(2,4)}</span></div>)}</div><div className="chart-legend"><span><i className="sales"/>Vendas</span><span><i className="income"/>Receitas</span><span><i className="expense"/>Despesas</span></div></article>
        <StatusPanel title="Orçamentos por situação" rows={data.quoteStatuses} totalKey="total"/>
        <StatusPanel title="Serviços por situação" rows={data.orderStatuses}/>
        <ListPanel title="Principais clientes" rows={data.topCustomers.map((row) => ({ label: row.customer_name, value: brl.format(Number(row.total)), note: `${row.sales_count} venda(s)` }))}/>
        <ListPanel title="Estoque abaixo do mínimo" empty="Nenhum produto abaixo do mínimo." rows={data.lowStock.map((row) => ({ label: row.name, value: `${Number(row.stock)} un.`, note: `Mínimo ${Number(row.minimum_stock)}` }))}/>
        <ListPanel title="Atividade por usuário" rows={data.activity.map((row) => ({ label: row.actor, value: row.actions, note: 'ações registradas' }))}/>
      </div>
    </>}
  </section>;
}

function StatusPanel({ title, rows, totalKey }) { return <article className="report-panel"><header><strong>{title}</strong></header><div className="report-status-list">{rows.length ? rows.map((row) => <div key={row.status}><span>{statusLabels[row.status] || row.status}</span><b>{row.count}</b>{totalKey && <small>{brl.format(Number(row[totalKey]))}</small>}</div>) : <p>Sem dados no período.</p>}</div></article>; }
function ListPanel({ title, rows, empty = 'Sem dados no período.' }) { return <article className="report-panel"><header><strong>{title}</strong></header><div className="report-list">{rows.length ? rows.map((row, index) => <div key={`${row.label}-${index}`}><span><b>{row.label}</b><small>{row.note}</small></span><strong>{row.value}</strong></div>) : <p>{empty}</p>}</div></article>; }
