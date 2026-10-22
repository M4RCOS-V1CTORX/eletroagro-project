import { useCallback, useEffect, useState } from 'react';
import { Archive, Boxes, CirclePlus, Clock3, LoaderCircle, Package, Pencil, Search, Wrench, X } from 'lucide-react';
import { getAuthAccessToken } from './authClient.js';
import { apiUrl } from './apiUrl.js';

const emptyItem = { itemType: 'product', code: '', name: '', description: '', category: '', unit: 'un', costPrice: '0', salePrice: '0', minimumStock: '0', estimatedMinutes: '' };

async function apiRequest(path, options = {}) {
  const token = await getAuthAccessToken();
  const send = (accessToken) => fetch(`${apiUrl}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  });
  let response = await send(token);
  if (response.status === 401) {
    const freshToken = await getAuthAccessToken(undefined, { forceRefresh: true }).catch(() => null);
    if (freshToken && freshToken !== token) response = await send(freshToken);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || 'Não foi possível concluir a operação.');
  return body;
}

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export default function CatalogPage() {
  const [type, setType] = useState('product');
  const [status, setStatus] = useState('active');
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [items, setItems] = useState([]);
  const [companyRole, setCompanyRole] = useState('member');
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState(null);
  const [editing, setEditing] = useState(null);

  const loadItems = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const params = new URLSearchParams({ type, status, q: appliedQuery });
      const result = await apiRequest(`/api/catalog?${params}`);
      setItems(result.items);
      setTotal(result.total);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setBusy(false);
    }
  }, [type, status, appliedQuery]);

  useEffect(() => { loadItems(); }, [loadItems]);
  useEffect(() => { apiRequest('/api/company/me').then((result) => setCompanyRole(result.company?.role || 'member')).catch(() => {}); }, []);

  function openNew() {
    setError(''); setEditing(null); setDraft({ ...emptyItem, itemType: type });
  }

  function openEdit(item) {
    setError('');
    setEditing(item);
    setDraft({
      itemType: item.item_type, code: item.code || '', name: item.name, description: item.description || '',
      category: item.category || '', unit: item.unit || 'un', costPrice: item.cost_price ?? '0',
      salePrice: item.sale_price ?? '0', minimumStock: item.minimum_stock ?? '0',
      estimatedMinutes: item.estimated_minutes ?? '',
    });
  }

  async function saveItem(event) {
    event.preventDefault(); setBusy(true); setError('');
    const payload = {
      ...draft,
      costPrice: Number(draft.costPrice || 0), salePrice: Number(draft.salePrice || 0),
      minimumStock: draft.itemType === 'product' ? Number(draft.minimumStock || 0) : 0,
      estimatedMinutes: draft.itemType === 'service' && draft.estimatedMinutes ? Number(draft.estimatedMinutes) : null,
    };
    try {
      await apiRequest(editing ? `/api/catalog/${editing.id}` : '/api/catalog', {
        method: editing ? 'PATCH' : 'POST', body: JSON.stringify(payload),
      });
      setDraft(null); setEditing(null); setNotice(editing ? 'Item atualizado.' : 'Item cadastrado.');
      await loadItems();
    } catch (saveError) {
      setError(saveError.message);
    } finally { setBusy(false); }
  }

  async function toggleActive(item) {
    setBusy(true); setError('');
    try {
      await apiRequest(`/api/catalog/${item.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !item.is_active }) });
      setNotice(item.is_active ? 'Item desativado. O histórico foi preservado.' : 'Item reativado.');
      await loadItems();
    } catch (actionError) { setError(actionError.message); }
    finally { setBusy(false); }
  }

  async function restoreItem(item) {
    setBusy(true); setError('');
    try {
      await apiRequest(`/api/catalog/${item.id}/restore`, { method: 'PATCH' });
      setNotice('Item restaurado no catálogo.'); await loadItems();
    } catch (restoreError) { setError(restoreError.message); }
    finally { setBusy(false); }
  }

  async function archiveItem(item) {
    if (!window.confirm(`Excluir permanentemente “${item.name}”? Orçamentos existentes continuarão com uma cópia dos dados do item.`)) return;
    setBusy(true); setError('');
    try {
      await apiRequest(`/api/catalog/${item.id}`, { method: 'DELETE' });
      setNotice('Item excluído permanentemente. Orçamentos existentes continuam preservados.'); await loadItems();
    } catch (actionError) { setError(actionError.message); }
    finally { setBusy(false); }
  }

  return <section className="customers-page catalog-page">
    <div className="customers-heading">
      <div><span className="customers-kicker">CADASTROS</span><h1>Produtos e serviços</h1><p>Monte o catálogo que será usado nos orçamentos e nas ordens de serviço.</p></div>
      <button className="customers-primary add-customer-button" onClick={openNew}><CirclePlus size={17} /> Novo {type === 'product' ? 'produto' : 'serviço'}</button>
    </div>
    {error && !draft && <p className="customers-feedback error" role="alert">{error}<button onClick={loadItems} aria-label="Tentar novamente">Tentar novamente</button></p>}
    {notice && <p className="customers-feedback success" role="status">{notice}<button aria-label="Fechar mensagem" onClick={() => setNotice('')}><X size={15} /></button></p>}
    <div className="catalog-controls">
      <div className="catalog-tabs" role="tablist" aria-label="Tipo do catálogo">
        <button role="tab" aria-selected={type === 'product'} className={type === 'product' ? 'selected' : ''} onClick={() => setType('product')}><Package size={16} /> Produtos</button>
        <button role="tab" aria-selected={type === 'service'} className={type === 'service' ? 'selected' : ''} onClick={() => setType('service')}><Wrench size={16} /> Serviços</button>
      </div>
      <div className="catalog-filters">
        <form className="customers-search" onSubmit={(event) => { event.preventDefault(); setAppliedQuery(query.trim()); }}><Search size={17} /><input aria-label="Pesquisar itens" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nome, código ou categoria" /><button type="submit">Buscar</button></form>
        <select aria-label="Filtrar situação" className="catalog-status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="active">Ativos</option><option value="inactive">Inativos</option><option value="archived">Arquivados</option><option value="all">Todos</option></select>
      </div>
    </div>
    <div className="customers-summary"><span><Boxes size={16} /> {total} {type === 'product' ? (total === 1 ? 'produto' : 'produtos') : (total === 1 ? 'serviço' : 'serviços')}</span><span>{status === 'all' ? 'Todos os registros' : status === 'active' ? 'Somente ativos' : status === 'inactive' ? 'Desativados' : 'Arquivados'}</span></div>
    <div className="customers-table-wrap">
      <table className="customers-table catalog-table"><thead><tr><th>Item</th><th>Código / categoria</th><th>Unidade</th><th>{type === 'product' ? 'Custo' : 'Tempo estimado'}</th><th>Preço sugerido</th><th>Situação</th><th><span className="sr-only">Ações</span></th></tr></thead>
        <tbody>
          {busy && !items.length && <tr><td colSpan="7" className="customers-table-state"><LoaderCircle size={18} className="spin" /> Carregando catálogo…</td></tr>}
          {!busy && !items.length && <tr><td colSpan="7" className="customers-table-state"><span className="empty-customers-icon">{type === 'product' ? <Package size={21} /> : <Wrench size={21} />}</span><strong>{appliedQuery ? 'Nenhum item encontrado' : `Seu catálogo de ${type === 'product' ? 'produtos' : 'serviços'} está vazio`}</strong><span>{appliedQuery ? 'Tente outro nome, código ou categoria.' : 'Cadastre o primeiro item para usar nos próximos módulos.'}</span></td></tr>}
          {items.map((item) => <tr key={item.id}>
            <td><strong className="customer-name">{item.name}</strong><span className="customer-type">{item.description || (type === 'product' ? 'Produto / material' : 'Serviço prestado')}</span></td>
            <td>{item.code || '—'}<small>{item.category || ''}</small></td>
            <td>{item.unit || 'un'}</td>
            <td>{type === 'product' ? money.format(Number(item.cost_price)) : item.estimated_minutes ? <span className="catalog-time"><Clock3 size={13} /> {item.estimated_minutes} min</span> : '—'}</td>
            <td><strong>{money.format(Number(item.sale_price))}</strong>{type === 'product' && Number(item.minimum_stock) > 0 && <small>Mín. {item.minimum_stock} {item.unit}</small>}</td>
            <td><span className={`catalog-badge ${item.archived_at ? 'inactive' : item.is_active ? 'active' : 'inactive'}`}>{item.archived_at ? 'Arquivado' : item.is_active ? 'Ativo' : 'Inativo'}</span></td>
            <td><div className="customer-actions"><button aria-label={`Editar ${item.name}`} title="Editar" onClick={() => openEdit(item)}><Pencil size={16} /></button>{companyRole === 'owner' && (item.archived_at ? <button aria-label={`Restaurar ${item.name}`} title="Restaurar" onClick={() => restoreItem(item)}><Archive size={16} /></button> : <button aria-label={`${item.is_active ? 'Desativar' : 'Reativar'} ${item.name}`} title={item.is_active ? 'Desativar' : 'Reativar'} onClick={() => toggleActive(item)}><Archive size={16} /></button>)}{companyRole === 'owner' && <button aria-label={`Excluir permanentemente ${item.name}`} title="Excluir permanentemente" onClick={() => archiveItem(item)}><X size={16} /></button>}</div></td>
          </tr>)}
        </tbody>
      </table>
    </div>
    {draft && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setDraft(null); }}>
      <section className="customer-modal" role="dialog" aria-modal="true" aria-labelledby="catalog-form-title">
        <header className="customer-modal-heading"><div><span className="customers-kicker">CATÁLOGO</span><h2 id="catalog-form-title">{editing ? 'Editar item' : `Novo ${draft.itemType === 'product' ? 'produto' : 'serviço'}`}</h2></div><button className="modal-close" onClick={() => setDraft(null)} disabled={busy} aria-label="Fechar"><X size={18} /></button></header>
        <form className="customer-form" onSubmit={saveItem}>
          <label>Tipo<select value={draft.itemType} onChange={(event) => setDraft({ ...draft, itemType: event.target.value })} disabled={Boolean(editing)}><option value="product">Produto / material</option><option value="service">Serviço</option></select></label>
          <label>Nome<input required minLength="2" maxLength="180" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder={draft.itemType === 'product' ? 'Ex.: Cabo flexível 2,5 mm' : 'Ex.: Instalação de iluminação'} /></label>
          <label>Código interno<input maxLength="40" value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value })} placeholder="Opcional" /></label>
          <label>Categoria<input maxLength="100" value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} placeholder="Ex.: Elétrica" /></label>
          <label>Unidade de medida<input maxLength="20" required value={draft.unit} onChange={(event) => setDraft({ ...draft, unit: event.target.value })} placeholder="un, m, h…" /></label>
          {draft.itemType === 'product' && <><label>Custo de aquisição (R$)<input type="number" min="0" step="0.01" value={draft.costPrice} onChange={(event) => setDraft({ ...draft, costPrice: event.target.value })} /></label><label>Estoque mínimo<input type="number" min="0" step="0.001" value={draft.minimumStock} onChange={(event) => setDraft({ ...draft, minimumStock: event.target.value })} /></label></>}
          <label>Preço sugerido (R$)<input type="number" min="0" step="0.01" value={draft.salePrice} onChange={(event) => setDraft({ ...draft, salePrice: event.target.value })} /></label>
          {draft.itemType === 'service' && <label>Tempo estimado (minutos)<input type="number" min="1" step="1" value={draft.estimatedMinutes} onChange={(event) => setDraft({ ...draft, estimatedMinutes: event.target.value })} placeholder="Opcional" /> </label>}
          <label className="field-wide">Descrição<textarea rows="3" maxLength="3000" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
          {error && <p className="customers-feedback error field-wide" role="alert">{error}</p>}
          <div className="customer-form-actions field-wide"><button type="button" className="customers-secondary" onClick={() => setDraft(null)} disabled={busy}>Cancelar</button><button className="customers-primary" disabled={busy}>{busy ? 'Salvando…' : editing ? 'Salvar alterações' : 'Cadastrar item'}</button></div>
        </form>
      </section>
    </div>}
  </section>;
}
