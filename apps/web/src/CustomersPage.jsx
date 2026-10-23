import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, ArrowDownUp, Building2, ChevronLeft, ChevronRight, CirclePlus, Eye, LoaderCircle, Pencil, Search, UserRound, Users, X } from 'lucide-react';
import { apiRequest } from './apiClient.js';

const emptyCustomer = {
  name: '', customerType: 'individual', taxIdentifier: '', phone: '', email: '',
  postalCode: '', street: '', streetNumber: '', addressComplement: '',
  neighborhood: '', city: '', state: '', notes: '',
};

const formFields = [
  { name: 'name', label: 'Nome ou razão social', required: true, wide: true, placeholder: 'Nome completo ou nome da empresa' },
  { name: 'customerType', label: 'Tipo de cliente', type: 'select', options: [['individual', 'Pessoa física'], ['business', 'Pessoa jurídica'], ['other', 'Outro']] },
  { name: 'taxIdentifier', label: 'CPF ou CNPJ', placeholder: 'Opcional' },
  { name: 'phone', label: 'Telefone', type: 'tel', placeholder: '(00) 00000-0000' },
  { name: 'email', label: 'E-mail', type: 'email', wide: true, placeholder: 'cliente@exemplo.com' },
  { name: 'postalCode', label: 'CEP', placeholder: '00000-000' },
  { name: 'street', label: 'Rua / Avenida', wide: true },
  { name: 'streetNumber', label: 'Número' },
  { name: 'addressComplement', label: 'Complemento' },
  { name: 'neighborhood', label: 'Bairro' },
  { name: 'city', label: 'Cidade' },
  { name: 'state', label: 'Estado', maxLength: 2, placeholder: 'UF' },
  { name: 'notes', label: 'Observações', type: 'textarea', wide: true, maxLength: 5000 },
];


function displayDate(value) {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
}

function customerTypeLabel(value) {
  return value === 'business' ? 'Pessoa jurídica' : value === 'other' ? 'Outro' : 'Pessoa física';
}

export default function CustomersPage({ onCompanyChange }) {
  const [company, setCompany] = useState(null);
  const [companyLoading, setCompanyLoading] = useState(true);
  const [customers, setCustomers] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, limit: 25, offset: 0 });
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [sort, setSort] = useState('name');
  const [order, setOrder] = useState('asc');
  const [recordStatus, setRecordStatus] = useState('active');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerDraft, setCustomerDraft] = useState(null);
  const [detailsCustomer, setDetailsCustomer] = useState(null);

  const loadCustomers = useCallback(async (offset = 0) => {
    setBusy(true);
    setError('');
    try {
      const params = new URLSearchParams({ q: appliedQuery, limit: String(pagination.limit), offset: String(offset), sort, order, status: recordStatus });
      const result = await apiRequest(`/api/customers?${params}`);
      setCustomers(result.customers);
      setPagination((current) => ({ ...current, ...result.pagination }));
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setBusy(false);
    }
  }, [appliedQuery, order, pagination.limit, sort, recordStatus]);

  const loadCompany = useCallback(async () => {
    setCompanyLoading(true);
    setError('');
    try {
      const result = await apiRequest('/api/company/me');
      setCompany(result.company);
      onCompanyChange(result.company?.name || '');
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setCompanyLoading(false);
    }
  }, [onCompanyChange]);

  useEffect(() => { loadCompany(); }, [loadCompany]);

  useEffect(() => {
    if (company) loadCustomers(0);
  }, [company, appliedQuery, sort, order, loadCustomers]);

  async function createCompany(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await apiRequest('/api/company', { method: 'POST', body: JSON.stringify({ name: 'EletroAgro Soluções' }) });
      setCompany(result.company);
      onCompanyChange(result.company.name);
      setNotice('Empresa cadastrada. Agora você pode organizar seus clientes.');
    } catch (saveError) {
      if (saveError.message.includes('já está vinculada')) await loadCompany();
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveCustomer(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const editing = Boolean(selectedCustomer);
      const path = editing ? `/api/customers/${selectedCustomer.id}` : '/api/customers';
      const result = await apiRequest(path, {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(customerDraft),
      });
      setSelectedCustomer(null);
      setCustomerDraft(null);
      setNotice(editing ? 'Cadastro atualizado.' : 'Cliente cadastrado.');
      await loadCustomers(pagination.offset);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  }

  async function archiveCustomer(customer) {
    if (!window.confirm(`Excluir permanentemente o cadastro de ${customer.name}? Os dados do cliente salvos em orçamentos já emitidos serão preservados.`)) return;
    setBusy(true);
    setError('');
    try {
      await apiRequest(`/api/customers/${customer.id}`, { method: 'DELETE' });
      setNotice('Cliente excluído permanentemente. Os dados dos orçamentos existentes foram preservados.');
      const nextOffset = customers.length === 1 && pagination.offset > 0 ? pagination.offset - pagination.limit : pagination.offset;
      await loadCustomers(nextOffset);
    } catch (archiveError) {
      setError(archiveError.message);
    } finally {
      setBusy(false);
    }
  }

  async function restoreCustomer(customer) {
    setBusy(true); setError('');
    try {
      await apiRequest(`/api/customers/${customer.id}/restore`, { method: 'PATCH' });
      setNotice('Cliente restaurado.'); await loadCustomers(pagination.offset);
    } catch (restoreError) { setError(restoreError.message); }
    finally { setBusy(false); }
  }

  function applySearch(event) {
    event.preventDefault();
    setPagination((current) => ({ ...current, offset: 0 }));
    setAppliedQuery(query.trim());
  }

  const pages = useMemo(() => Math.max(1, Math.ceil(pagination.total / pagination.limit)), [pagination.limit, pagination.total]);
  const currentPage = Math.floor(pagination.offset / pagination.limit) + 1;

  if (companyLoading) return <section className="customers-loading"><LoaderCircle size={18} className="spin" /> Preparando cadastro de clientes…</section>;

  if (!company && error) return <section className="company-setup-wrap"><div className="company-setup-card company-setup-error"><span className="customers-kicker">CADASTRO DE CLIENTES</span><span className="company-setup-icon"><Building2 size={23} /></span><h1>Não foi possível carregar sua empresa</h1><p>{error}</p><button className="customers-primary" onClick={loadCompany}><LoaderCircle size={16} /> Tentar novamente</button></div></section>;

  if (!company) return (
    <section className="company-setup-wrap">
      <div className="company-setup-card">
        <span className="customers-kicker">PRIMEIRO ACESSO</span>
        <span className="company-setup-icon"><Building2 size={23} /></span>
        <h1>Ative seu espaço</h1>
        <p>Os clientes e demais registros ficarão vinculados à EletroAgro Soluções.</p>
        <form onSubmit={createCompany} className="company-setup-form">
          <div className="company-access-ready"><strong>EletroAgro Soluções</strong><small>Identidade definida para este espaço de trabalho.</small></div>
          {error && <p className="customers-feedback error" role="alert">{error}</p>}
          <button className="customers-primary" disabled={busy}>{busy ? 'Salvando…' : 'Criar espaço da empresa'}</button>
        </form>
      </div>
    </section>
  );

  return (
    <section className="customers-page">
      <div className="customers-heading">
        <div><span className="customers-kicker">CADASTROS</span><h1>Clientes</h1><p>Organize contatos, documentos e endereços dos seus clientes.</p></div>
        <button className="customers-primary add-customer-button" onClick={() => { setError(''); setCustomerDraft({ ...emptyCustomer }); setSelectedCustomer(null); }}><CirclePlus size={17} /> Novo cliente</button>
      </div>

      {error && !customerDraft && <p className="customers-feedback error" role="alert">{error}</p>}
      {notice && <p className="customers-feedback success" role="status">{notice}<button aria-label="Fechar mensagem" onClick={() => setNotice('')}><X size={15} /></button></p>}

      <div className="customers-toolbar">
        <form className="customers-search" onSubmit={applySearch}><Search size={17} /><input aria-label="Pesquisar clientes" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nome, CPF/CNPJ ou telefone" /><button type="submit">Buscar</button></form>
        <select className="catalog-status" aria-label="Filtrar clientes" value={recordStatus} onChange={(event) => { setRecordStatus(event.target.value); setPagination((current) => ({ ...current, offset: 0 })); }}><option value="active">Clientes ativos</option><option value="archived">Arquivados</option><option value="all">Todos</option></select>
        <div className="customers-sort-actions"><button className="customers-sort" onClick={() => { const nextSort = sort === 'name' ? 'created' : 'name'; setSort(nextSort); setOrder(nextSort === 'name' ? 'asc' : 'desc'); setPagination((current) => ({ ...current, offset: 0 })); }}><ArrowDownUp size={15} /> Ordenar por {sort === 'name' ? 'cadastro' : 'nome'}</button><button className="customers-sort direction-sort" onClick={() => { setOrder(order === 'asc' ? 'desc' : 'asc'); setPagination((current) => ({ ...current, offset: 0 })); }}>{sort === 'name' ? (order === 'asc' ? 'A–Z' : 'Z–A') : (order === 'desc' ? 'Mais recentes' : 'Mais antigos')}</button></div>
      </div>

      <div className="customers-summary"><span><Users size={16} /> {pagination.total} {pagination.total === 1 ? 'cliente cadastrado' : 'clientes cadastrados'}</span><span>{company.name}</span></div>
      <div className="customers-table-wrap">
        <table className="customers-table">
          <thead><tr><th>Cliente</th><th>Documento</th><th>Contato</th><th>Localidade</th><th>Cadastro</th><th><span className="sr-only">Ações</span></th></tr></thead>
          <tbody>
            {busy && !customers.length ? <tr><td colSpan="6" className="customers-table-state"><LoaderCircle size={18} className="spin" /> Carregando clientes…</td></tr> : null}
            {!busy && !customers.length ? <tr><td colSpan="6" className="customers-table-state"><span className="empty-customers-icon"><UserRound size={21} /></span><strong>{appliedQuery ? 'Nenhum cliente encontrado' : 'Sua lista de clientes está vazia'}</strong><span>{appliedQuery ? 'Tente outro nome, documento ou telefone.' : 'Cadastre o primeiro cliente para começar.'}</span></td></tr> : null}
            {customers.map((customer) => <tr key={customer.id}>
              <td><strong className="customer-name">{customer.name}</strong><span className="customer-type">{customerTypeLabel(customer.customer_type)}</span>{customer.archived_at && <span className="customer-type archived-state">Arquivado</span>}</td>
              <td>{customer.tax_identifier || <span className="table-muted">—</span>}</td>
              <td><span>{customer.phone || '—'}</span><small>{customer.email || ''}</small></td>
              <td>{[customer.city, customer.state].filter(Boolean).join(' / ') || <span className="table-muted">—</span>}</td>
              <td>{displayDate(customer.created_at)}</td>
              <td><div className="customer-actions"><button aria-label={`Ver ${customer.name}`} title="Ver detalhes" onClick={() => setDetailsCustomer(customer)}><Eye size={16} /></button><button aria-label={`Editar ${customer.name}`} title="Editar" onClick={() => { setError(''); setCustomerDraft({ ...emptyCustomer, ...customer, customerType: customer.customer_type || 'individual', taxIdentifier: customer.tax_identifier || '', postalCode: customer.postal_code || '', streetNumber: customer.street_number || '', addressComplement: customer.address_complement || '' }); setSelectedCustomer(customer); }}><Pencil size={16} /></button>{company.role === 'owner' && customer.archived_at && <button aria-label={`Restaurar ${customer.name}`} title="Restaurar" onClick={() => restoreCustomer(customer)}><Archive size={16} /></button>}{company.role === 'owner' && <button aria-label={`Excluir permanentemente ${customer.name}`} title="Excluir permanentemente" onClick={() => archiveCustomer(customer)}><X size={16} /></button>}</div></td>
            </tr>)}
          </tbody>
        </table>
      </div>

      <div className="customers-pagination"><span>Mostrando {pagination.total ? pagination.offset + 1 : 0}–{Math.min(pagination.offset + customers.length, pagination.total)} de {pagination.total}</span><div><button aria-label="Página anterior" disabled={currentPage <= 1 || busy} onClick={() => loadCustomers(Math.max(0, pagination.offset - pagination.limit))}><ChevronLeft size={17} /></button><span>Página {currentPage} de {pages}</span><button aria-label="Próxima página" disabled={currentPage >= pages || busy} onClick={() => loadCustomers(pagination.offset + pagination.limit)}><ChevronRight size={17} /></button></div></div>

      {customerDraft && <CustomerForm draft={customerDraft} setDraft={setCustomerDraft} editing={Boolean(selectedCustomer)} busy={busy} error={error} onClose={() => { setCustomerDraft(null); setSelectedCustomer(null); setError(''); }} onSubmit={saveCustomer} />}
      {detailsCustomer && <CustomerDetails customer={detailsCustomer} onClose={() => setDetailsCustomer(null)} onEdit={() => { setCustomerDraft({ ...emptyCustomer, ...detailsCustomer, customerType: detailsCustomer.customer_type || 'individual', taxIdentifier: detailsCustomer.tax_identifier || '', postalCode: detailsCustomer.postal_code || '', streetNumber: detailsCustomer.street_number || '', addressComplement: detailsCustomer.address_complement || '' }); setSelectedCustomer(detailsCustomer); setDetailsCustomer(null); }} />}
    </section>
  );
}

function CustomerForm({ draft, setDraft, editing, busy, error, onClose, onSubmit }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="customer-modal" role="dialog" aria-modal="true" aria-labelledby="customer-modal-title">
      <header className="customer-modal-heading"><div><span className="customers-kicker">CADASTRO DE CLIENTE</span><h2 id="customer-modal-title">{editing ? 'Editar cliente' : 'Novo cliente'}</h2></div><button className="modal-close" onClick={onClose} aria-label="Fechar" disabled={busy}><X size={18} /></button></header>
      <form className="customer-form" onSubmit={onSubmit}>
        {formFields.map((field) => <label className={field.wide ? 'field-wide' : ''} key={field.name}>{field.label}{field.type === 'select' ? <select value={draft[field.name]} onChange={(event) => setDraft({ ...draft, [field.name]: event.target.value })}>{field.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> : field.type === 'textarea' ? <textarea value={draft[field.name] || ''} onChange={(event) => setDraft({ ...draft, [field.name]: event.target.value })} maxLength={field.maxLength} rows="3" /> : <input value={draft[field.name] || ''} onChange={(event) => setDraft({ ...draft, [field.name]: event.target.value })} type={field.type || 'text'} required={field.required} maxLength={field.maxLength || (field.name === 'name' ? 200 : undefined)} placeholder={field.placeholder || ''} />}</label>)}
        {error && <p className="customers-feedback error field-wide" role="alert">{error}</p>}
        <div className="customer-form-actions field-wide"><button type="button" className="customers-secondary" onClick={onClose} disabled={busy}>Cancelar</button><button className="customers-primary" disabled={busy}>{busy ? 'Salvando…' : editing ? 'Salvar alterações' : 'Cadastrar cliente'}</button></div>
      </form>
    </section>
  </div>;
}

function CustomerDetails({ customer, onClose, onEdit }) {
  const items = [
    ['Tipo', customerTypeLabel(customer.customer_type)], ['CPF/CNPJ', customer.tax_identifier],
    ['Telefone', customer.phone], ['E-mail', customer.email], ['CEP', customer.postal_code],
    ['Endereço', [customer.street, customer.street_number, customer.address_complement].filter(Boolean).join(', ')],
    ['Bairro', customer.neighborhood], ['Cidade / Estado', [customer.city, customer.state].filter(Boolean).join(' / ')],
    ['Observações', customer.notes], ['Data de cadastro', displayDate(customer.created_at)],
  ];
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="customer-modal customer-details-modal" role="dialog" aria-modal="true" aria-labelledby="customer-details-title">
      <header className="customer-modal-heading"><div><span className="customers-kicker">DETALHES DO CLIENTE</span><h2 id="customer-details-title">{customer.name}</h2></div><button className="modal-close" onClick={onClose} aria-label="Fechar"><X size={18} /></button></header>
      <dl className="customer-details-grid">{items.filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <footer className="customer-form-actions"><button className="customers-secondary" onClick={onClose}>Fechar</button><button className="customers-primary" onClick={onEdit}><Pencil size={15} /> Editar cadastro</button></footer>
    </section>
  </div>;
}
