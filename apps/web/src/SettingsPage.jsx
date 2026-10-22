import { useEffect, useState } from 'react';
import { Building2, Check, Copy, LoaderCircle, MailPlus, Save, ShieldAlert, Users, X } from 'lucide-react';
import { getAuthAccessToken } from './authClient.js';
import { apiUrl } from './apiUrl.js';

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

export default function SettingsPage({ onCompanyChange, onCompanyDeleted }) {
  const [company, setCompany] = useState(null);
  const [draft, setDraft] = useState({ name: '', taxIdentifier: '', phone: '', email: '' });
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [access, setAccess] = useState(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteCode, setInviteCode] = useState('');

  async function loadCompany() {
    setLoading(true); setError('');
    try {
      const result = await apiRequest('/api/company/me');
      setCompany(result.company);
      if (result.company?.role === 'owner') {
        try { setAccess(await apiRequest('/api/company/access')); } catch (accessError) { setError(accessError.message); }
      }
      if (result.company) setDraft({ name: result.company.name || '', taxIdentifier: result.company.tax_identifier || '', phone: result.company.phone || '', email: result.company.email || '' });
    } catch (loadError) { setError(loadError.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadCompany(); }, []);

  async function saveCompany(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const result = await apiRequest('/api/company/me', { method: 'PATCH', body: JSON.stringify(draft) });
      setCompany(result.company); setDraft({ name: result.company.name, taxIdentifier: result.company.tax_identifier || '', phone: result.company.phone || '', email: result.company.email || '' });
      setConfirmation(''); onCompanyChange(result.company.name); setNotice('Dados da empresa atualizados.');
    } catch (saveError) { setError(saveError.message); }
    finally { setBusy(false); }
  }

  async function deleteCompany(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    if (confirmation !== company.name) { setBusy(false); setError('Digite o nome exato da empresa para habilitar a exclusão.'); return; }
    if (!window.confirm(`Excluir permanentemente “${company.name}” e todos os dados vinculados? Essa ação não pode ser desfeita.`)) { setBusy(false); return; }
    try {
      await apiRequest('/api/company/me', { method: 'DELETE', body: JSON.stringify({ confirmation }) });
      onCompanyDeleted();
    } catch (deleteError) { setError(deleteError.message); }
    finally { setBusy(false); }
  }

  async function inviteMember(event) {
    event.preventDefault(); setBusy(true); setError(''); setInviteCode('');
    try {
      const result = await apiRequest('/api/company/invitations', { method: 'POST', body: JSON.stringify({ email: inviteEmail }) });
      setInviteCode(result.code); setInviteEmail(''); setAccess(await apiRequest('/api/company/access'));
      setNotice(`Convite criado para ${result.invitation.invited_email}. Copie o código e envie à pessoa.`);
    } catch (inviteError) { setError(inviteError.message); }
    finally { setBusy(false); }
  }

  async function copyInvite() {
    try { await navigator.clipboard.writeText(inviteCode); setNotice('Código copiado. Envie-o à pessoa convidada.'); }
    catch { setError('Não foi possível copiar automaticamente. Selecione e copie o código exibido.'); }
  }

  async function changeMember(member) {
    setBusy(true); setError('');
    try {
      await apiRequest(`/api/company/access/members/${member.id}`, { method: 'PATCH', body: JSON.stringify({ active: !member.is_active }) });
      setAccess(await apiRequest('/api/company/access'));
      setNotice(member.is_active ? 'Acesso suspenso.' : 'Acesso restaurado.');
    } catch (memberError) { setError(memberError.message); }
    finally { setBusy(false); }
  }

  async function revokeInvite(invitation) {
    setBusy(true); setError('');
    try { await apiRequest(`/api/company/invitations/${invitation.id}`, { method: 'DELETE' }); setAccess(await apiRequest('/api/company/access')); setNotice(`Convite para ${invitation.invited_email} cancelado.`); }
    catch (inviteError) { setError(inviteError.message); }
    finally { setBusy(false); }
  }

  if (loading) return <section className="customers-loading"><LoaderCircle size={18} className="spin" /> Carregando configurações…</section>;
  if (!company) return <section className="customers-page settings-page"><h1>Configurações</h1><p>{error || 'Cadastre os dados da empresa no módulo Clientes antes de abrir as configurações.'}</p><button className="customers-secondary" onClick={loadCompany}>Tentar novamente</button></section>;

  return <section className="customers-page settings-page">
    <div className="customers-heading"><div><span className="customers-kicker">SISTEMA</span><h1>Configurações</h1><p>Edite os dados da empresa e gerencie os dados armazenados no sistema.</p></div></div>
    {error && <p className="customers-feedback error" role="alert">{error}</p>}{notice && <p className="customers-feedback success" role="status">{notice}</p>}
    <section className="settings-card"><header><span className="settings-icon"><Building2 size={19} /></span><span><strong>Dados da empresa</strong><small>{company.role === 'owner' ? 'Responsável da empresa' : 'Apenas o responsável pode editar'}</small></span></header>
      <form className="customer-form settings-form" onSubmit={saveCompany}>
        <label className="field-wide">Nome da empresa<input required minLength="2" maxLength="160" disabled={company.role !== 'owner'} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>CPF/CNPJ<input maxLength="30" disabled={company.role !== 'owner'} value={draft.taxIdentifier} onChange={(event) => setDraft({ ...draft, taxIdentifier: event.target.value })} /></label>
        <label>Telefone<input maxLength="40" disabled={company.role !== 'owner'} value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} /></label>
        <label className="field-wide">E-mail<input type="email" maxLength="254" disabled={company.role !== 'owner'} value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} /></label>
        {company.role === 'owner' && <div className="customer-form-actions field-wide"><button className="customers-primary" disabled={busy}><Save size={15} /> {busy ? 'Salvando…' : 'Salvar dados da empresa'}</button></div>}
      </form>
    </section>
    {company.role === 'owner' && <TeamAccess access={access} email={inviteEmail} setEmail={setInviteEmail} code={inviteCode} busy={busy} onInvite={inviteMember} onCopy={copyInvite} onChangeMember={changeMember} onRevoke={revokeInvite} />}
    {company.role === 'owner' && <section className="settings-danger-card"><header><span className="settings-danger-icon"><ShieldAlert size={19} /></span><span><strong>Excluir todos os dados da empresa</strong><small>Remove permanentemente clientes, produtos, serviços, orçamentos, históricos e o cadastro da empresa.</small></span></header>
      <form onSubmit={deleteCompany}><label>Para confirmar, digite <b>{company.name}</b><input required autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Nome exato da empresa" /></label><button className="settings-delete-button" disabled={busy || confirmation !== company.name}>{busy ? 'Excluindo…' : 'Excluir empresa e todos os dados'}</button></form>
    </section>}
  </section>;
}

function TeamAccess({ access, email, setEmail, code, busy, onInvite, onCopy, onChangeMember, onRevoke }) {
  return <section className="settings-card team-access-card"><header><span className="settings-icon team-settings-icon"><Users size={19} /></span><span><strong>Equipe e acessos</strong><small>{access ? `${access.members.filter((m) => m.is_active).length} de 5 acessos ativos` : 'Gerencie quem pode acessar os dados da empresa.'}</small></span></header>
    <div className="team-member-list">{access?.members.map((member) => <article key={member.id}><span className="team-member-avatar">{(member.display_name||member.email||'?').slice(0,1).toUpperCase()}</span><span className="team-member-name"><b>{member.display_name || member.email || 'Membro sem identificação'}</b><small>{member.email || 'E-mail ainda não sincronizado'} · {member.role === 'owner' ? 'Responsável' : member.is_active ? 'Acesso ativo' : 'Acesso suspenso'}</small></span>{member.role === 'owner' ? <span className="team-owner-badge"><Check size={13}/>Responsável</span> : <button className="team-access-action" disabled={busy} onClick={() => onChangeMember(member)}>{member.is_active ? 'Suspender' : 'Restaurar'}</button>}</article>)}</div>
    <form className="team-invite-form" onSubmit={onInvite}><div><b>Convidar uma pessoa</b><small>O código vale por sete dias. Compartilhe-o por um canal que você já usa.</small></div><label>E-mail da pessoa<input required type="email" maxLength="254" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nome@empresa.com"/></label><button className="customers-primary" disabled={busy}><MailPlus size={15}/> Criar convite</button></form>
    {code && <div className="team-code-card"><div><strong>Código de convite</strong><small>A pessoa deve entrar com o e-mail convidado e colar este código na tela de acesso à equipe.</small><code>{code}</code></div><button className="customers-secondary" onClick={onCopy}><Copy size={14}/> Copiar código</button></div>}
    {access?.invitations?.length>0&&<div className="team-pending"><strong>Convites pendentes</strong>{access.invitations.map((invite)=><article key={invite.id}><span><b>{invite.invited_email}</b><small>Expira em {new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short'}).format(new Date(invite.expires_at))}</small></span><button disabled={busy} onClick={()=>onRevoke(invite)} aria-label={`Cancelar convite para ${invite.invited_email}`}><X size={15}/></button></article>)}</div>}
  </section>;
}
