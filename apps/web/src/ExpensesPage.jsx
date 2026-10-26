import ExpenseCategoryField from './ExpenseCategoryField.jsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Banknote, Check, CircleAlert, Download, Eye, LoaderCircle, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { apiRequest } from './apiClient.js';
import { useSyncRefresh } from './useSyncRefresh.js';
import { Heading, Message, Metric } from './WorkspaceUI.jsx';
import { FinanceEntryDialog, FinancePaymentDialog, paymentMethods } from './FinanceForms.jsx';
import { ActivitySelect } from './SaleExtras.jsx';
import { activityLabels, localToday } from './commercial.js';
import { csvRows } from './csv.js';
import './expenses.css';
export const expenseOrigins = {
  manual: 'Despesa avulsa',
  purchase: 'Compra',
  freight: 'Frete'
};
const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL'
});
const money = value => currency.format(Number(value || 0));
const date = value => value ? new Intl.DateTimeFormat('pt-BR').format(new Date(`${String(value).slice(0, 10)}T12:00:00`)) : 'Não informada';
const initialFilters = () => ({
  q: '',
  from: `${localToday().slice(0, 7)}-01`,
  to: localToday(),
  activity: 'all',
  category: 'all',
  status: 'all',
  paymentMethod: 'all',
  sort: 'due_date',
  order: 'asc'
});
const editable = entry => entry.source_type === 'manual' && entry.status === 'pending' && Number(entry.amount_paid || 0) === 0 && !['pending', 'failed'].includes(entry.sync_status);
const statusText = entry => entry.sync_status === 'failed' ? 'Revisar sincronização' : entry.sync_status === 'pending' ? 'Aguardando sincronização' : entry.status === 'cancelled' ? 'Cancelada' : entry.status === 'settled' ? 'Paga' : entry.overdue ? 'Vencida' : Number(entry.amount_paid) > 0 ? 'Pagamento parcial' : 'Pendente';
export default function ExpensesPage() {
  const [filters, setFilters] = useState(initialFilters),
    [search, setSearch] = useState(''),
    [offset, setOffset] = useState(0);
  const [data, setData] = useState(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [draft, setDraft] = useState(null),
    [editingId, setEditingId] = useState(null),
    [suppliers, setSuppliers] = useState([]),
    [payment, setPayment] = useState(null),
    [details, setDetails] = useState(null),
    [classification, setClassification] = useState(null),
    [cancel, setCancel] = useState(null),
    [confirmation, setConfirmation] = useState('');
  const requestVersion = useRef(0),
    submitLock = useRef(false);
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError('');
    try {
      const result = await apiRequest(`/api/operations/finance/expenses?${new URLSearchParams({
        ...filters,
        limit: '25',
        offset: String(offset)
      })}`);
      if (version !== requestVersion.current) return;
      if (offset > 0 && offset >= result.pagination.total) {
        setOffset(Math.max(0, Math.ceil(result.pagination.total / 25) * 25 - 25));
        return;
      }
      setData(result);
    } catch (e) {
      if (version === requestVersion.current) setError(e.message);
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [filters, offset]);
  useEffect(() => {
    load();
    return () => {
      requestVersion.current++;
    };
  }, [load]);
  useSyncRefresh(load);
  const filter = (key, value) => {
    setOffset(0);
    setFilters(current => ({
      ...current,
      [key]: value
    }));
  };
  async function act(work) {
    if (submitLock.current) return;
    submitLock.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      setError(e.message);
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  }
  const getDetails = async entry => (await apiRequest(`/api/operations/finance/expenses/${entry.id}`)).entry;
  const openDetails = entry => act(async () => setDetails(await getDetails(entry)));
  const start = entry => act(async () => {
    const lookup = await apiRequest('/api/operations/lookups');
    setSuppliers(lookup.suppliers || []);
    if (entry) {
      const current = await getDetails(entry);
      if (!editable(current)) throw new Error('Esta despesa não pode ser editada. Consulte seus pagamentos ou o documento de origem.');
      setEditingId(current.id);
      setDraft({
        entryType: 'expense',
        title: current.title,
        amount: current.amount,
        competenceDate: String(current.competence_date).slice(0, 10),
        dueDate: current.due_date ? String(current.due_date).slice(0, 10) : '',
        businessActivity: current.business_activity,
        supplierId: current.supplier_id || '',
        notes: current.notes || '',
        expenseCategory: current.expense_category || '',
        status: 'pending',
        scheduleMode: 'single',
        expectedUpdatedAt: current.updated_at
      });
    } else {
      setEditingId(null);
      setDraft({
        entryType: 'expense',
        expenseCategory: '',
        title: '',
        amount: '',
        competenceDate: localToday(),
        dueDate: '',
        businessActivity: filters.activity === 'all' ? 'unassigned' : filters.activity,
        supplierId: '',
        customerId: '',
        notes: '',
        status: 'pending',
        scheduleMode: 'single',
        scheduleCount: 2,
        scheduleFrequency: 'month',
        paymentMethod: 'pix',
        settledAt: localToday()
      });
    }
  });
  function save(event) {
    event.preventDefault();
    act(async () => {
      const result = await apiRequest(editingId ? `/api/operations/finance/expenses/${editingId}` : '/api/operations/finance', {
        method: editingId ? 'PATCH' : 'POST',
        body: JSON.stringify({
          ...draft,
          entryType: 'expense'
        })
      });
      setDraft(null);
      setEditingId(null);
      setNotice(result.queued ? result.message : editingId ? 'Despesa atualizada.' : 'Despesa registrada.');
      await load();
    });
  }
  function settle(event) {
    event.preventDefault();
    act(async () => {
      const result = await apiRequest(`/api/operations/finance/${payment.entry.id}/payments`, {
        method: 'POST',
        body: JSON.stringify({
          amount: payment.amount,
          paymentMethod: payment.paymentMethod,
          paidAt: payment.paidAt
        })
      });
      setPayment(null);
      setDetails(null);
      setNotice(result.queued ? result.message : 'Pagamento registrado e saldo atualizado.');
      await load();
    });
  }
  const classify = entry => act(async () => {
    const current = await getDetails(entry);
    setClassification({
      entry: current,
      value: current.expense_category || ''
    });
  });
  function saveCategory(event) {
    event.preventDefault();
    act(async () => {
      await apiRequest(`/api/operations/finance/expenses/${classification.entry.id}/category`, {
        method: 'PATCH',
        body: JSON.stringify({
          expenseCategory: classification.value,
          expectedUpdatedAt: classification.entry.updated_at
        })
      });
      setClassification(null);
      setDetails(null);
      setNotice('Categoria da despesa atualizada.');
      await load();
    });
  }
  const askCancel = entry => act(async () => {
    setCancel(await getDetails(entry));
    setConfirmation('');
  });
  function cancelExpense(event) {
    event.preventDefault();
    act(async () => {
      await apiRequest(`/api/operations/finance/expenses/${cancel.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({
          confirmation,
          expectedUpdatedAt: cancel.updated_at
        })
      });
      setCancel(null);
      setDetails(null);
      setNotice('Despesa cancelada. O histórico foi preservado.');
      await load();
    });
  }
  function exportPage() {
    const rows = [['Descrição', 'Categoria', 'Atividade', 'Vencimento', 'Último pagamento', 'Valor', 'Pago', 'Saldo', 'Forma', 'Situação'], ...(data?.entries || []).map(e => [e.title, e.expense_category || 'Sem categoria', activityLabels[e.business_activity], e.due_date || '', e.last_paid_at || '', e.amount, e.amount_paid, e.balance, paymentMethods[e.payment_method] || '', statusText(e)])];
    const link = document.createElement('a'),
      url = URL.createObjectURL(new Blob([csvRows(rows)], {
        type: 'text/csv;charset=utf-8'
      }));
    link.href = url;
    link.download = `despesas-${localToday()}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const rows = data?.entries || [],
    summary = data?.summary || {},
    total = Number(data?.pagination?.total || 0);
  const changeModal = set => value => {
    if (!busy) set(value);
  };
  return <section className="workspace-page finance-workspace expenses-workspace" aria-busy={loading}>
    <Heading eyebrow="CONTAS DA OPERAÇÃO" title="Despesas" description="Organize despesas da elétrica e da fazenda, acompanhe vencimentos e registre pagamentos." accent="green" action={<button className="workspace-button primary" disabled={busy} onClick={() => start()}><Plus size={16} />Nova despesa</button>} />
    <Message error={error} notice={notice} clear={() => setNotice('')} />
    {error && <button className="workspace-button subtle" disabled={busy || loading} onClick={load}>Tentar novamente</button>}
    <section className="expenses-metrics" aria-label="Despesas dos filtros aplicados">
      <Metric icon={Banknote} label="Total do período" value={data ? money(summary.total) : '—'} note="Despesas não canceladas" />
      <Metric icon={Check} label="Despesas pagas" value={data ? money(summary.paid) : '—'} note="Inclui pagamentos parciais" tone="green" />
      <Metric icon={ArrowUpRight} label="Despesas pendentes" value={data ? money(summary.pending) : '—'} note="Saldo que falta pagar" tone="yellow" />
      <Metric icon={CircleAlert} label="Despesas vencidas" value={data ? money(summary.overdue) : '—'} note="Saldo pendente após o vencimento" tone="red" />
    </section>
    <p className="expenses-filter-note">Indicadores consideram todos os resultados dos filtros, antes da paginação. O período usa vencimento ou, quando ausente, competência.</p>
    <div className="finance-toolbar expenses-filters">
      <form className="workspace-search" onSubmit={event => {
        event.preventDefault();
        filter('q', search.trim());
      }}><Search size={15} /><input aria-label="Pesquisar despesas" placeholder="Descrição ou fornecedor" value={search} onChange={e => setSearch(e.target.value)} /><button>Buscar</button></form>
      <label>De<input type="date" value={filters.from} max={filters.to || undefined} onChange={e => filter('from', e.target.value)} /></label>
      <label>Até<input type="date" value={filters.to} min={filters.from || undefined} onChange={e => filter('to', e.target.value)} /></label>
      <ActivitySelect all value={filters.activity} onChange={value => filter('activity', value)} />
      <label>Categoria<select aria-label="Categoria" value={filters.category} onChange={e => filter('category', e.target.value)}><option value="all">Todas as categorias</option>{(data?.categories || []).map(name => <option value={name} key={name}>{name}</option>)}</select></label>
      <label>Status<select aria-label="Status" value={filters.status} onChange={e => filter('status', e.target.value)}><option value="all">Todos os status</option><option value="pending">Pendentes</option><option value="settled">Pagas</option><option value="overdue">Vencidas</option><option value="cancelled">Canceladas</option></select></label>
      <label>Forma de pagamento<select aria-label="Forma de pagamento" value={filters.paymentMethod} onChange={e => filter('paymentMethod', e.target.value)}><option value="all">Todas as formas</option>{Object.entries(paymentMethods).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label>Ordenar por<select aria-label="Ordenar por" value={filters.sort} onChange={e => filter('sort', e.target.value)}><option value="due_date">Vencimento</option><option value="title">Descrição</option><option value="amount">Valor</option><option value="created_at">Cadastro</option></select></label>
      <label>Ordem<select aria-label="Ordem" value={filters.order} onChange={e => filter('order', e.target.value)}><option value="asc">Crescente</option><option value="desc">Decrescente</option></select></label>
      <button className="workspace-button subtle" onClick={() => {
        setSearch('');
        setOffset(0);
        setFilters(initialFilters());
      }}>Limpar filtros</button>
      <button className="workspace-button subtle" disabled={loading || !rows.length} onClick={exportPage}><Download size={15} />Exportar página</button>
    </div>
    <div className="finance-table-frame"><table className="finance-table expenses-table"><thead><tr><th>Descrição</th><th>Categoria</th><th>Vencimento</th><th>Último pagamento</th><th>Valor / saldo</th><th>Forma</th><th>Status</th><th>Ações</th></tr></thead><tbody>
      {loading ? <tr><td colSpan="8" className="workspace-table-state"><LoaderCircle className="spin" />Carregando despesas…</td></tr> : rows.length ? rows.map(entry => <tr key={entry.id} className={entry.overdue ? 'overdue-row' : ''}>
        <td data-label="Descrição"><div><strong>{entry.title}</strong><small>{entry.supplier_name || 'Sem fornecedor'} · {activityLabels[entry.business_activity]}</small></div></td>
        <td data-label="Categoria">{entry.expense_category || 'Sem categoria'}</td><td data-label="Vencimento">{date(entry.due_date)}</td><td data-label="Último pagamento">{date(entry.last_paid_at)}</td>
        <td data-label="Valor / saldo"><div><strong>{money(entry.amount)}</strong><small>{entry.status === 'cancelled' ? 'Cancelada' : `Em aberto: ${money(entry.balance)}`}</small></div></td><td data-label="Forma">{paymentMethods[entry.payment_method] || 'Sem pagamento'}</td>
        <td data-label="Status"><span className={`finance-status ${entry.status}`}>{statusText(entry)}</span></td>
        <td data-label="Ações"><div className="expense-row-actions"><button className="workspace-button subtle" disabled={busy} aria-label={`Ver despesa ${entry.title}`} onClick={() => openDetails(entry)}><Eye size={15} /></button>
          {!['pending', 'failed'].includes(entry.sync_status) && <button className="workspace-button subtle" disabled={busy || !online} title="Classificar despesa" aria-label={`Classificar despesa ${entry.title}`} onClick={() => classify(entry)}><Pencil size={15} /><span>Categoria</span></button>}
          {editable(entry) && <><button className="workspace-button subtle" disabled={busy || !online} title={!online ? 'A edição exige conexão' : 'Editar despesa'} aria-label={`Editar despesa ${entry.title}`} onClick={() => start(entry)}><Pencil size={15} /></button><button className="workspace-button subtle" disabled={busy || !online} title={!online ? 'O cancelamento exige conexão' : 'Cancelar despesa'} aria-label={`Cancelar despesa ${entry.title}`} onClick={() => askCancel(entry)}><Trash2 size={15} /></button></>}
          {entry.status === 'pending' && Number(entry.balance) > 0 && <button className="ledger-settle" disabled={busy} aria-label={`Registrar pagamento de ${entry.title}`} onClick={() => {
                  setError('');
                  setPayment({
                    entry,
                    amount: entry.balance,
                    paymentMethod: 'pix',
                    paidAt: localToday()
                  });
                }}>Pagar</button>}
        </div></td>
      </tr>) : <tr><td colSpan="8" className="workspace-table-state"><Banknote size={24} /><strong>Nenhuma despesa encontrada</strong><span>Registre uma despesa ou ajuste os filtros para consultar outros períodos.</span></td></tr>}
    </tbody></table></div>
    <div className="customers-pagination"><span>{total ? `${offset + 1}–${Math.min(offset + 25, total)} de ${total} despesas` : '0 despesas'}</span><button className="workspace-button subtle" disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>Anterior</button><span>Página {Math.floor(offset / 25) + 1} de {Math.max(1, Math.ceil(total / 25))}</span><button className="workspace-button subtle" disabled={loading || offset + 25 >= total} onClick={() => setOffset(offset + 25)}>Próxima</button></div>
    <FinanceEntryDialog draft={draft} setDraft={changeModal(setDraft)} busy={busy} error={error} onSubmit={save} suppliers={suppliers} categories={data?.categories || []} editing={!!editingId} showExpenseCategory />
    <FinancePaymentDialog payment={payment} setPayment={changeModal(setPayment)} busy={busy} error={error} onSubmit={settle} />
    {details && <div className="workspace-backdrop"><section className="workspace-modal" role="dialog" aria-modal="true" aria-labelledby="expense-details-title"><header><span className="workspace-eyebrow">DETALHES DA DESPESA</span><h2 id="expense-details-title">{details.title}</h2><button aria-label="Fechar detalhes" onClick={() => setDetails(null)}><X /></button></header><dl className="expense-details"><div><dt>Categoria</dt><dd>{details.expense_category || 'Sem categoria'}</dd></div><div><dt>Origem</dt><dd>{expenseOrigins[details.source_type]}</dd></div><div><dt>Atividade</dt><dd>{activityLabels[details.business_activity]}</dd></div><div><dt>Situação</dt><dd>{statusText(details)}</dd></div><div><dt>Fornecedor</dt><dd>{details.supplier_name || 'Não informado'}</dd></div><div><dt>Competência</dt><dd>{date(details.competence_date)}</dd></div><div><dt>Vencimento</dt><dd>{date(details.due_date)}</dd></div><div><dt>Valor original</dt><dd>{money(details.amount)}</dd></div><div><dt>Pago / saldo</dt><dd>{money(details.amount_paid)} / {details.status === 'cancelled' ? 'Cancelada' : money(details.balance)}</dd></div></dl><p className="expense-notes">{details.notes || 'Sem observações.'}</p><h3>Histórico de pagamentos</h3>{details.payments?.length ? <ul className="expense-payment-history">{details.payments.map(p => <li key={p.id}><span>{date(p.paid_at)} · {paymentMethods[p.payment_method]}</span><strong>{money(p.amount)}</strong></li>)}</ul> : <p>Nenhum pagamento registrado.</p>}{details.source_type !== 'manual' && <p className="expenses-filter-note">Despesa integrada a {details.source_type === 'purchase' ? 'uma compra' : 'um frete'}. Alterações e cancelamentos devem respeitar o documento de origem.</p>}<footer><button className="workspace-button subtle" onClick={() => setDetails(null)}>Fechar</button></footer></section></div>}
    {classification && <div className="workspace-backdrop"><section className="workspace-modal" role="dialog" aria-modal="true" aria-labelledby="expense-category-title"><header><span className="workspace-eyebrow">CLASSIFICAÇÃO</span><h2 id="expense-category-title">Categoria da despesa</h2><button aria-label="Fechar categoria" disabled={busy} onClick={() => setClassification(null)}><X /></button></header><form onSubmit={saveCategory}><p>{classification.entry.title}</p><ExpenseCategoryField value={classification.value} categories={data?.categories || []} onChange={value => setClassification({
            ...classification,
            value
          })} /><p className="expenses-filter-note">A classificação não altera valores, pagamentos ou o documento de origem.</p><Message error={error} /><footer><button className="workspace-button subtle" type="button" disabled={busy} onClick={() => setClassification(null)}>Voltar</button><button className="workspace-button primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar categoria'}</button></footer></form></section></div>}
    {cancel && <div className="workspace-backdrop"><section className="workspace-modal" role="dialog" aria-modal="true" aria-labelledby="expense-cancel-title"><header><span className="workspace-eyebrow">CONFIRMAÇÃO</span><h2 id="expense-cancel-title">Cancelar despesa</h2><button disabled={busy} aria-label="Fechar cancelamento" onClick={() => setCancel(null)}><X /></button></header><form onSubmit={cancelExpense}><p>O lançamento de {money(cancel.amount)} será cancelado e permanecerá no histórico. Não haverá exclusão de pagamentos.</p><label>Digite a descrição para confirmar: <b>{cancel.title}</b><input required autoComplete="off" value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label><Message error={error} /><footer><button type="button" className="workspace-button subtle" disabled={busy} onClick={() => setCancel(null)}>Voltar</button><button className="workspace-button primary" disabled={busy || confirmation !== cancel.title}>{busy ? 'Cancelando…' : 'Confirmar cancelamento'}</button></footer></form></section></div>}
  </section>;
}
