import { useEffect, useState } from 'react';
import { Bell, Building2, Check, Copy, FileText, Link, LoaderCircle, MailPlus, Palette, Save, ShieldAlert, ShieldCheck, Users, X } from 'lucide-react';
import { apiRequest } from './apiClient.js';


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
  const [invitePermissions, setInvitePermissions] = useState({ commercial: true, operations: true, finance: true, reports: true, audit: true });
  const [documentSettings, setDocumentSettings] = useState({ accentColor: '#176da3', footerText: 'Obrigado pela preferência.', showSignature: true });
  const [notificationSettings, setNotificationSettings] = useState({ browserNotifications: false, reminderMinutes: 60 });

  async function loadCompany() {
    setLoading(true); setError('');
    try {
      const result = await apiRequest('/api/company/me');
      setCompany(result.company);
      if (result.company?.role === 'owner') {
        try { setAccess(await apiRequest('/api/company/access')); } catch (accessError) { setError(accessError.message); }
      }
      if (result.company) setDraft({ name: result.company.name || '', taxIdentifier: result.company.tax_identifier || '', phone: result.company.phone || '', email: result.company.email || '' });
      const [documents, notifications] = await Promise.all([apiRequest('/api/completion/document-settings'), apiRequest('/api/completion/notifications')]);
      setDocumentSettings(documents.settings); setNotificationSettings({ browserNotifications: notifications.preferences.browser_notifications, reminderMinutes: notifications.preferences.reminder_minutes });
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
      const result = await apiRequest('/api/company/invitations', { method: 'POST', body: JSON.stringify({ email: inviteEmail, permissions: invitePermissions }) });
      setInviteCode(result.code); setInviteEmail(''); setAccess(await apiRequest('/api/company/access'));
      const deliveryMessages = {
        not_configured: 'O envio de e-mail ainda não está configurado na API.',
        sender_not_verified: 'O domínio do remetente ainda não foi verificado no serviço de e-mail.',
        provider_auth_failed: 'A chave do serviço de e-mail foi recusada.',
        rate_limited: 'O serviço de e-mail atingiu o limite temporário de envios.',
        provider_unavailable: 'O serviço de e-mail está temporariamente indisponível.',
        delivery_failed: 'O serviço de e-mail recusou o envio.',
      };
      setNotice(result.delivery?.sent
        ? `Convite enviado por e-mail para ${result.invitation.invited_email}.`
        : `Convite criado para ${result.invitation.invited_email}. ${deliveryMessages[result.delivery?.reason] || 'O e-mail não pôde ser enviado.'} Copie o código abaixo e envie à pessoa.`);
    } catch (inviteError) { setError(inviteError.message); }
    finally { setBusy(false); }
  }

  async function copyInvite() {
    try { await navigator.clipboard.writeText(inviteCode); setNotice('Código copiado. Envie-o à pessoa convidada.'); }
    catch { setError('Não foi possível copiar automaticamente. Selecione e copie o código exibido.'); }
  }

  async function copyInviteLink() {
    try {
      const url = new URL(window.location.origin);
      url.searchParams.set('invite', inviteCode);
      await navigator.clipboard.writeText(url.toString());
      setNotice('Link de convite copiado. Envie-o à pessoa convidada.');
    } catch { setError('Não foi possível copiar o link automaticamente. Copie o código exibido.'); }
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

  async function changePermissions(member, key) {
    setBusy(true); setError('');
    try { await apiRequest(`/api/company/access/members/${member.id}/permissions`, { method: 'PATCH', body: JSON.stringify({ permissions: { ...member.permissions, [key]: member.permissions?.[key] === false } }) }); setAccess(await apiRequest('/api/company/access')); setNotice('Permissões atualizadas.'); }
    catch (permissionsError) { setError(permissionsError.message); }
    finally { setBusy(false); }
  }

  async function saveDocuments(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { const result = await apiRequest('/api/completion/document-settings', { method: 'PUT', body: JSON.stringify(documentSettings) }); setDocumentSettings(result.settings); setNotice('Aparência dos documentos atualizada.'); }
    catch (settingsError) { setError(settingsError.message); }
    finally { setBusy(false); }
  }

  async function saveNotifications(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      let enabled = notificationSettings.browserNotifications;
      if (enabled && 'Notification' in window && Notification.permission !== 'granted') enabled = (await Notification.requestPermission()) === 'granted';
      const result = await apiRequest('/api/completion/notifications/preferences', { method: 'PUT', body: JSON.stringify({ browserNotifications: enabled, reminderMinutes: Number(notificationSettings.reminderMinutes) }) });
      setNotificationSettings({ browserNotifications: result.preferences.browser_notifications, reminderMinutes: result.preferences.reminder_minutes }); setNotice(enabled ? 'Lembretes ativados neste navegador.' : 'Preferências de lembrete atualizadas.');
    } catch (settingsError) { setError(settingsError.message); }
    finally { setBusy(false); }
  }

  if (loading) return <section className="customers-loading"><LoaderCircle size={18} className="spin" /> Carregando configurações…</section>;
  if (!company) return <section className="customers-page settings-page"><h1>Configurações</h1><p>{error || 'Cadastre os dados da empresa no módulo Clientes antes de abrir as configurações.'}</p><button className="customers-secondary" onClick={loadCompany}>Tentar novamente</button></section>;

  return <section className="customers-page settings-page">
    <div className="customers-heading"><div><span className="customers-kicker">SISTEMA</span><h1>Configurações</h1><p>Edite os dados da empresa e gerencie os dados armazenados no sistema.</p></div></div>
    {error && <p className="customers-feedback error" role="alert">{error}</p>}{notice && <p className="customers-feedback success" role="status">{notice}</p>}
    <section className="settings-card"><header><span className="settings-icon"><Building2 size={19} /></span><span><strong>Dados da empresa</strong><small>{company.role === 'owner' ? 'Responsável da empresa' : 'Apenas o responsável pode editar'}</small></span></header>
      <form className="customer-form settings-form" onSubmit={saveCompany}>
        <label className="field-wide">Nome da empresa<input disabled value="EletroAgro Soluções" aria-describedby="fixed-company-name" /><small id="fixed-company-name">Identidade institucional definida para o sistema.</small></label>
        <label>CPF/CNPJ<input maxLength="30" disabled={company.role !== 'owner'} value={draft.taxIdentifier} onChange={(event) => setDraft({ ...draft, taxIdentifier: event.target.value })} /></label>
        <label>Telefone<input maxLength="40" disabled={company.role !== 'owner'} value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} /></label>
        <label className="field-wide">E-mail<input type="email" maxLength="254" disabled={company.role !== 'owner'} value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} /></label>
        {company.role === 'owner' && <div className="customer-form-actions field-wide"><button className="customers-primary" disabled={busy}><Save size={15} /> {busy ? 'Salvando…' : 'Salvar dados da empresa'}</button></div>}
      </form>
    </section>
    {company.role === 'owner' && <TeamAccess access={access} email={inviteEmail} setEmail={setInviteEmail} code={inviteCode} busy={busy} invitePermissions={invitePermissions} setInvitePermissions={setInvitePermissions} onInvite={inviteMember} onCopy={copyInvite} onCopyLink={copyInviteLink} onChangeMember={changeMember} onChangePermissions={changePermissions} onRevoke={revokeInvite} />}
    <section className="settings-card"><header><span className="settings-icon"><Bell size={19}/></span><span><strong>Lembretes no navegador</strong><small>Avise sobre compromissos próximos quando o sistema estiver aberto.</small></span></header><form className="settings-preferences-form" onSubmit={saveNotifications}><label className="settings-check"><input type="checkbox" checked={notificationSettings.browserNotifications} onChange={(event) => setNotificationSettings({ ...notificationSettings, browserNotifications: event.target.checked })}/><span>Ativar notificações neste aparelho</span></label><label>Avisar com antecedência<select value={notificationSettings.reminderMinutes} onChange={(event) => setNotificationSettings({ ...notificationSettings, reminderMinutes: Number(event.target.value) })}><option value="15">15 minutos</option><option value="30">30 minutos</option><option value="60">1 hora</option><option value="1440">1 dia</option><option value="10080">7 dias</option></select></label><button className="customers-primary" disabled={busy}><Save size={15}/>Salvar lembretes</button></form></section>
    {company.role === 'owner' && <section className="settings-card"><header><span className="settings-icon"><Palette size={19}/></span><span><strong>Personalização dos documentos</strong><small>Aplique a identidade da empresa em recibos e documentos novos.</small></span></header><form className="settings-preferences-form document-settings-form" onSubmit={saveDocuments}><label>Cor de destaque<input type="color" value={documentSettings.accentColor} onChange={(event) => setDocumentSettings({ ...documentSettings, accentColor: event.target.value })}/></label><label className="field-wide">Rodapé<input maxLength="300" value={documentSettings.footerText} onChange={(event) => setDocumentSettings({ ...documentSettings, footerText: event.target.value })}/></label><label className="settings-check"><input type="checkbox" checked={documentSettings.showSignature} onChange={(event) => setDocumentSettings({ ...documentSettings, showSignature: event.target.checked })}/><span>Exibir campo de assinatura</span></label><button className="customers-primary" disabled={busy}><FileText size={15}/>Salvar documentos</button></form></section>}
    {company.role === 'owner' && <section className="settings-danger-card"><header><span className="settings-danger-icon"><ShieldAlert size={19} /></span><span><strong>Excluir todos os dados da empresa</strong><small>Remove permanentemente clientes, produtos, serviços, orçamentos, históricos e o cadastro da empresa.</small></span></header>
      <form onSubmit={deleteCompany}><label>Para confirmar, digite <b>{company.name}</b><input required autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Nome exato da empresa" /></label><button className="settings-delete-button" disabled={busy || confirmation !== company.name}>{busy ? 'Excluindo…' : 'Excluir empresa e todos os dados'}</button></form>
    </section>}
  </section>;
}

const permissionLabels = { commercial: 'Comercial', operations: 'Operação', finance: 'Financeiro', reports: 'Relatórios', audit: 'Histórico' };
function TeamAccess({ access, email, setEmail, code, busy, invitePermissions, setInvitePermissions, onInvite, onCopy, onCopyLink, onChangeMember, onChangePermissions, onRevoke }) {
  return <section className="settings-card team-access-card"><header><span className="settings-icon team-settings-icon"><Users size={19} /></span><span><strong>Equipe e acessos</strong><small>{access ? `${access.members.filter((m) => m.is_active).length} de 5 acessos ativos` : 'Gerencie quem pode acessar os dados da empresa.'}</small></span></header>
    <div className="team-member-list">{access?.members.map((member) => <article className="team-member-row" key={member.id}><span className="team-member-avatar">{(member.display_name||member.email||'?').slice(0,1).toUpperCase()}</span><span className="team-member-name"><b>{member.display_name || member.email || 'Membro sem identificação'}</b><small>{member.email || 'E-mail ainda não sincronizado'} · {member.role === 'owner' ? 'Responsável' : member.is_active ? 'Acesso ativo' : 'Acesso suspenso'}</small></span>{member.role === 'owner' ? <span className="team-owner-badge"><Check size={13}/>Responsável</span> : <><button className="team-access-action" disabled={busy} onClick={() => onChangeMember(member)}>{member.is_active ? 'Suspender' : 'Restaurar'}</button><div className="member-permissions"><span><ShieldCheck size={14}/>Áreas permitidas</span>{Object.entries(permissionLabels).map(([key,label])=><label key={key}><input type="checkbox" disabled={busy} checked={member.permissions?.[key] !== false} onChange={()=>onChangePermissions(member,key)}/>{label}</label>)}</div></>}</article>)}</div>
    <form className="team-invite-form" onSubmit={onInvite}><div><b>Convidar uma pessoa</b><small>O sistema tenta enviar por e-mail. O código continua disponível para compartilhamento manual.</small></div><label>E-mail da pessoa<input required type="email" maxLength="254" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nome@empresa.com"/></label><div className="invite-permissions"><span>Permissões iniciais</span>{Object.entries(permissionLabels).map(([key,label])=><label key={key}><input type="checkbox" checked={invitePermissions[key]} onChange={(event)=>setInvitePermissions({...invitePermissions,[key]:event.target.checked})}/>{label}</label>)}</div><button className="customers-primary" disabled={busy}><MailPlus size={15}/> Criar convite</button></form>
    {code && <div className="team-code-card"><div><strong>Convite pronto para compartilhar</strong><small>Envie o link pelo WhatsApp ou compartilhe somente o código. O convite continua vinculado ao e-mail informado.</small><code>{code}</code></div><div className="team-code-actions"><button className="customers-primary" onClick={onCopyLink}><Link size={14}/> Copiar link</button><button className="customers-secondary" onClick={onCopy}><Copy size={14}/> Copiar código</button></div></div>}
    {access?.invitations?.length>0&&<div className="team-pending"><strong>Convites pendentes</strong>{access.invitations.map((invite)=><article key={invite.id}><span><b>{invite.invited_email}</b><small>Expira em {new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short'}).format(new Date(invite.expires_at))}</small></span><button disabled={busy} onClick={()=>onRevoke(invite)} aria-label={`Cancelar convite para ${invite.invited_email}`}><X size={15}/></button></article>)}</div>}
  </section>;
}
