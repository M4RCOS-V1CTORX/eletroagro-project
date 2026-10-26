import {useSyncRefresh} from './useSyncRefresh.js';
import { useCallback, useEffect, useState } from 'react';
import { BriefcaseBusiness, CirclePlus, LoaderCircle, Pencil, Search, Trash2, X } from 'lucide-react';
import { apiRequest } from './apiClient.js';

const emptyDraft = { name: '', taxIdentifier: '', phone: '', email: '', postalCode: '', street: '', streetNumber: '', addressComplement: '', neighborhood: '', city: '', state: '', notes: '' };


export default function SuppliersPage() {
  useSyncRefresh(()=>load(offset));
  const [suppliers, setSuppliers] = useState([]);
  const [status, setStatus] = useState('active');
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [owner, setOwner] = useState(false);
  const [draft, setDraft] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (nextOffset = offset) => {
    setBusy(true); setError('');
    try {
      const params = new URLSearchParams({ q: appliedQuery, status, limit: '25', offset: String(nextOffset) });
      const [data, company] = await Promise.all([apiRequest(`/api/suppliers?${params}`), apiRequest('/api/company/me')]);
      setSuppliers(data.suppliers); setTotal(data.pagination.total); setOffset(nextOffset); setOwner(company.company?.role === 'owner');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }, [appliedQuery, status, offset]);

  useEffect(() => { load(0); }, [appliedQuery, status]);

  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result=await apiRequest(editing ? `/api/suppliers/${editing.id}` : '/api/suppliers', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(draft) });
      setDraft(null); setEditing(null); setNotice(result.queued?result.message:editing ? 'Fornecedor atualizado.' : 'Fornecedor cadastrado.'); await load(offset);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function toggleActive(item) {
    setBusy(true); setError('');
    try { await apiRequest(`/api/suppliers/${item.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !item.is_active }) }); setNotice(item.is_active ? 'Fornecedor desativado.' : 'Fornecedor ativado.'); await load(offset); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function remove(item) {
    if (!window.confirm(`Excluir permanentemente o fornecedor ${item.name}?`)) return;
    setBusy(true); setError('');
    try { await apiRequest(`/api/suppliers/${item.id}`, { method: 'DELETE' }); setNotice('Fornecedor excluído permanentemente.'); await load(Math.max(0, offset - (suppliers.length === 1 ? 25 : 0))); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const maxPages = Math.max(1, Math.ceil(total / 25));
  return <section className="customers-page suppliers-page">
    <div className="customers-heading"><div><span className="customers-kicker">COMPRAS E PARCEIROS</span><h1>Fornecedores</h1><p>Organize os contatos comerciais e os dados dos seus fornecedores.</p></div><button className="customers-primary add-customer-button" onClick={() => { setEditing(null); setDraft({ ...emptyDraft }); setError(''); }}><CirclePlus size={16} /> Novo fornecedor</button></div>
    {error && <p className="customers-feedback error" role="alert">{error}</p>}{notice && <p className="customers-feedback success">{notice}<button onClick={() => setNotice('')} aria-label="Fechar"><X size={15} /></button></p>}
    <div className="catalog-filters"><form className="customers-search" onSubmit={(e) => { e.preventDefault(); setAppliedQuery(query.trim()); }}><Search size={16} /><input aria-label="Buscar fornecedores por nome, documento ou telefone" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nome, documento ou telefone" /><button>Buscar</button></form><select className="catalog-status" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filtrar situação"><option value="active">Ativos</option><option value="inactive">Inativos</option><option value="all">Todos</option></select></div>
    <div className="customers-summary"><span><BriefcaseBusiness size={14} /> {total} fornecedor{total === 1 ? '' : 'es'}</span><span>Cadastro vinculado à empresa</span></div>
    <div className="customers-table-wrap"><table className="customers-table catalog-table"><thead><tr><th>FORNECEDOR</th><th>CPF / CNPJ</th><th>CONTATO</th><th>CIDADE</th><th>SITUAÇÃO</th><th /></tr></thead><tbody>
      {busy && !suppliers.length ? <tr><td colSpan="6" className="customers-table-state"><LoaderCircle className="spin" size={19} /><span>Carregando fornecedores…</span></td></tr> : suppliers.length ? suppliers.map((item) => <tr key={item.id}><td><strong className="customer-name">{item.name}</strong>{item.email && <small>{item.email}</small>}</td><td>{item.tax_identifier || '—'}</td><td>{item.phone || '—'}</td><td>{[item.city, item.state].filter(Boolean).join(' / ') || '—'}</td><td><span className={`catalog-badge ${item.is_active ? 'active' : 'inactive'}`}>{item.is_active ? 'Ativo' : 'Inativo'}</span></td><td><div className="customer-actions"><button aria-label={`Editar fornecedor ${item.name}`} title="Editar" onClick={() => { setEditing(item); setDraft(Object.fromEntries(Object.keys(emptyDraft).map((key) => [key, item[key === 'taxIdentifier' ? 'tax_identifier' : key === 'postalCode' ? 'postal_code' : key === 'streetNumber' ? 'street_number' : key === 'addressComplement' ? 'address_complement' : key === 'state' ? 'state' : key] || '']))); }}><Pencil size={15} /></button><button aria-label={`${item.is_active?'Desativar':'Ativar'} fornecedor ${item.name}`} title={item.is_active ? 'Desativar' : 'Ativar'} onClick={() => toggleActive(item)}>{item.is_active ? '−' : '+'}</button>{owner && <button aria-label={`Excluir fornecedor ${item.name}`} title="Excluir permanentemente" onClick={() => remove(item)}><Trash2 size={15} /></button>}</div></td></tr>) : <tr><td colSpan="6" className="customers-table-state"><span className="empty-customers-icon"><BriefcaseBusiness size={19} /></span><strong>Nenhum fornecedor encontrado</strong><span>Cadastre um fornecedor ou ajuste a busca.</span></td></tr>}
    </tbody></table></div>
    <div className="customers-pagination"><span>Mostrando {total ? offset + 1 : 0}–{Math.min(offset + suppliers.length, total)} de {total}</span><div><button aria-label="Página anterior" disabled={offset === 0 || busy} onClick={() => load(Math.max(0, offset - 25))}>‹</button><span>Página {Math.floor(offset / 25) + 1} de {maxPages}</span><button aria-label="Próxima página" disabled={offset + 25 >= total || busy} onClick={() => load(offset + 25)}>›</button></div></div>
    {draft && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) { setDraft(null); setEditing(null); } }}><section className="customer-modal" role="dialog" aria-modal="true" aria-labelledby="supplier-form-title"><header className="customer-modal-heading"><div><span className="customers-kicker">CADASTRO COMERCIAL</span><h2 id="supplier-form-title">{editing ? 'Editar fornecedor' : 'Novo fornecedor'}</h2></div><button className="modal-close" onClick={() => { setDraft(null); setEditing(null); }} aria-label="Fechar" disabled={busy}><X size={18} /></button></header><form className="customer-form" onSubmit={save}>
      <label className="field-wide">Nome ou razão social<input required minLength="2" maxLength="200" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
      {[['taxIdentifier','CPF ou CNPJ'],['phone','Telefone'],['email','E-mail'],['postalCode','CEP'],['street','Rua / Avenida'],['streetNumber','Número'],['addressComplement','Complemento'],['neighborhood','Bairro'],['city','Cidade'],['state','Estado (UF)']].map(([key,label]) => <label key={key}>{label}<input type={key === 'email' ? 'email' : 'text'} maxLength={key==='state'?2:key === 'taxIdentifier' ? 30 : key === 'email' ? 254 : 200} value={draft[key] || ''} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} /></label>)}
      <label className="field-wide">Observações<textarea maxLength="5000" value={draft.notes || ''} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
      {error && <p className="customers-feedback error field-wide">{error}</p>}<div className="customer-form-actions field-wide"><button type="button" className="customers-secondary" onClick={() => { setDraft(null); setEditing(null); }}>Cancelar</button><button className="customers-primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar fornecedor'}</button></div>
    </form></section></div>}
  </section>;
}
