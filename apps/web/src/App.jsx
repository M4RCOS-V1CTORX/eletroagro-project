import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Activity, Bell, Bolt, Boxes, BriefcaseBusiness, CalendarDays, ChartNoAxesCombined, CircleDollarSign, ClipboardList, ContactRound, Download, FileBarChart, LayoutDashboard, LogOut, Menu, Package, ReceiptText, Settings, ShieldCheck, Wifi, WifiOff, X } from 'lucide-react';
import { authClient, getAuthAccessToken } from './authClient.js';
import { apiUrl } from './apiUrl.js';
import { apiRequest, flushOfflineQueue, offlineQueueCount } from './apiClient.js';
const CustomersPage = lazy(() => import('./CustomersPage.jsx'));
const CatalogPage = lazy(() => import('./CatalogPage.jsx'));
const QuotesPage = lazy(() => import('./QuotesPage.jsx'));
const SettingsPage = lazy(() => import('./SettingsPage.jsx'));
const SuppliersPage = lazy(() => import('./SuppliersPage.jsx'));
const SalesPage = lazy(() => import('./SalesPage.jsx'));
const OverviewPage = lazy(() => import('./OperationsPages.jsx').then((module) => ({ default: module.OverviewPage })));
const FinancePage = lazy(() => import('./OperationsPages.jsx').then((module) => ({ default: module.FinancePage })));
const ServiceOrdersPage = lazy(() => import('./OperationsPages.jsx').then((module) => ({ default: module.ServiceOrdersPage })));
const AgendaPage = lazy(() => import('./OperationsPages.jsx').then((module) => ({ default: module.AgendaPage })));
const StockPage = lazy(() => import('./OperationsPages.jsx').then((module) => ({ default: module.StockPage })));
const AuditPage = lazy(() => import('./OperationsPages.jsx').then((module) => ({ default: module.AuditPage })));
const CompanyAccessPage = lazy(() => import('./OperationsPages.jsx').then((module) => ({ default: module.CompanyAccessPage })));
const ReportsPage = lazy(() => import('./ReportsPage.jsx'));
const ReceiptsPage = lazy(() => import('./ReceiptsPage.jsx'));

const navigation = [
  { label: 'Visão geral', icon: LayoutDashboard, key: 'overview' },
  { label: 'Clientes', icon: ContactRound, key: 'customers' },
  { label: 'Produtos e serviços', icon: Boxes, key: 'catalog' },
  { label: 'Fornecedores', icon: BriefcaseBusiness, key: 'suppliers' },
  { label: 'Orçamentos', icon: ClipboardList, key: 'quotes' },
  { label: 'Vendas', icon: CircleDollarSign, key: 'sales' },
  { label: 'Ordens de serviço', icon: Bolt, key: 'orders' },
  { label: 'Estoque', icon: Package, key: 'stock' },
  { label: 'Financeiro', icon: ChartNoAxesCombined, key: 'finance' },
  { label: 'Recibos', icon: ReceiptText, key: 'receipts' },
  { label: 'Relatórios', icon: FileBarChart, key: 'reports' },
  { label: 'Agenda', icon: CalendarDays, key: 'agenda' },
  { label: 'Histórico', icon: Activity, key: 'audit' },
  { label: 'Configurações', icon: Settings, key: 'settings' },
];
const desktopNavigationGroups = [
  { label: 'PAINEL', keys: ['overview'] },
  { label: 'COMERCIAL', keys: ['customers', 'catalog', 'suppliers', 'quotes', 'sales'] },
  { label: 'OPERAÇÃO', keys: ['orders', 'stock', 'agenda'] },
  { label: 'GESTÃO', keys: ['finance', 'receipts', 'reports', 'audit'] },
];

const pageLabels = { overview: 'Visão geral', customers: 'Clientes', catalog: 'Produtos e serviços', suppliers: 'Fornecedores', quotes: 'Orçamentos', sales: 'Vendas', orders: 'Ordens de serviço', stock: 'Estoque', finance: 'Financeiro', receipts: 'Recibos', reports: 'Relatórios', agenda: 'Agenda', audit: 'Histórico', settings: 'Configurações' };
const mobilePrimaryKeys = ['overview', 'customers', 'quotes', 'sales'];
const mobileMoreGroups = [
  { label: 'Operação', keys: ['orders', 'stock', 'finance', 'agenda'] },
  { label: 'Cadastros', keys: ['catalog', 'suppliers'] },
  { label: 'Gestão', keys: ['receipts', 'reports', 'audit', 'settings'] },
];

async function readAuthSessionWithRetry() {
  let latest;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    latest = await authClient.getSession();
    if (latest.error || (latest.data?.session && latest.data?.user)) return latest;
    if (attempt < 3) await new Promise((resolve) => window.setTimeout(resolve, 250 * (attempt + 1)));
  }
  return latest;
}

async function verifyApiSession(sessionResult) {
  const token = await getAuthAccessToken(sessionResult);
  const response = await fetch(`${apiUrl}/api/session`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || 'A API não conseguiu validar sua sessão.');
  const companyResponse = await fetch(`${apiUrl}/api/company/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const companyBody = await companyResponse.json().catch(() => ({}));
  if (!companyResponse.ok && companyResponse.status !== 503) throw new Error(companyBody.error?.message || 'Não foi possível consultar o espaço da empresa.');
  return { ...body.user, company: companyBody.company || null, databaseUnavailable: companyResponse.status === 503 };
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [authNotice, setAuthNotice] = useState('');
  const [isSignUp, setIsSignUp] = useState(true);
  const [authView, setAuthView] = useState(new URLSearchParams(window.location.search).get('token') ? 'reset' : 'access');
  const [authBusy, setAuthBusy] = useState(false);
  const [apiStatus, setApiStatus] = useState('checking');
  const [databaseStatus, setDatabaseStatus] = useState('checking');
  const [page, setPage] = useState('overview');
  const [companyName, setCompanyName] = useState('EletroAgro Soluções');
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [pendingSync, setPendingSync] = useState(0);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [reminderCount, setReminderCount] = useState(0);
  const mobileMoreTriggerRef = useRef(null);
  const mobileMoreSheetRef = useRef(null);
  const hadMobileMoreOpen = useRef(false);

  useEffect(() => {
    const updateQueue = (event) => setPendingSync(event?.detail?.count ?? 0);
    const handleOnline = async () => { setOnline(true); const result = await flushOfflineQueue(); setPendingSync(result.remaining); };
    const handleOffline = () => setOnline(false);
    const handleInstall = (event) => { event.preventDefault(); setInstallPrompt(event); };
    offlineQueueCount().then(setPendingSync).catch(() => {});
    window.addEventListener('online', handleOnline); window.addEventListener('offline', handleOffline);
    window.addEventListener('eletroagro:offline-queue', updateQueue); window.addEventListener('beforeinstallprompt', handleInstall);
    return () => { window.removeEventListener('online', handleOnline); window.removeEventListener('offline', handleOffline); window.removeEventListener('eletroagro:offline-queue', updateQueue); window.removeEventListener('beforeinstallprompt', handleInstall); };
  }, []);

  useEffect(() => {
    if (!user?.company || !online) return undefined;
    let active = true;
    apiRequest('/api/completion/notifications').then((result) => {
      if (!active) return;
      const soon = (result.reminders || []).filter((item) => new Date(item.starts_at).getTime() - Date.now() <= Number(result.preferences?.reminder_minutes || 60) * 60000 && new Date(item.starts_at) > new Date());
      setReminderCount(soon.length);
      if (soon.length && result.preferences?.browser_notifications && 'Notification' in window && Notification.permission === 'granted') {
        const marker = `eletroagro-reminder-${soon[0].id}`;
        if (!sessionStorage.getItem(marker)) { new Notification('Próximo compromisso', { body: soon[0].title, icon: '/logo-eletroagro.jpeg' }); sessionStorage.setItem(marker, '1'); }
      }
    }).catch(() => {});
    return () => { active = false; };
  }, [user?.company, online]);

  useEffect(() => {
    if (!mobileMoreOpen) {
      if (hadMobileMoreOpen.current) {
        hadMobileMoreOpen.current = false;
        mobileMoreTriggerRef.current?.focus({ preventScroll: true });
      }
      return undefined;
    }
    hadMobileMoreOpen.current = true;
    mobileMoreSheetRef.current?.focus({ preventScroll: true });
    const closeOnEscape = (event) => { if (event.key === 'Escape') setMobileMoreOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [mobileMoreOpen]);

  useEffect(() => {
    let active = true;
    async function restoreSession() {
      if (!authClient) {
        setAuthError('Configure VITE_NEON_AUTH_URL em apps/web/.env para ativar o acesso.');
        setAuthLoading(false);
        return;
      }
      try {
        const result = await readAuthSessionWithRetry();
        if (result.data?.session && result.data?.user) {
          const verifiedUser = await verifyApiSession(result);
          if (active) { setUser(verifiedUser); setCompanyName(verifiedUser.company?.name || ''); }
        }
      } catch (error) {
        if (active) setAuthError(error.message);
      } finally {
        if (active) setAuthLoading(false);
      }
    }
    restoreSession();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function checkServices() {
      try {
        const response = await fetch(`${apiUrl}/api/health`, { signal: controller.signal });
        if (!response.ok) throw new Error('API indisponível');
        const health = await response.json();
        setApiStatus('online');
        setDatabaseStatus(health.database === 'configured' ? 'configured' : 'not_configured');
      } catch (error) {
        if (error.name !== 'AbortError') {
          setApiStatus('offline');
          setDatabaseStatus('unknown');
        }
      }
    }
    checkServices();
    return () => controller.abort();
  }, []);

  async function handleAuthSubmit(event) {
    event.preventDefault();
    setAuthBusy(true);
    setAuthError('');
    setAuthNotice('');
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') || '').trim().toLowerCase();
    const password = String(form.get('password') || '');
    const name = String(form.get('name') || '').trim();
    try {
      const result = isSignUp
        ? await authClient.signUp.email({ name, email, password })
        : await authClient.signIn.email({ email, password });
      if (result.error) {
        const authMessage = result.error.message || '';
        const authCode = result.error.code || '';
        const combinedAuthError = `${authCode} ${authMessage}`;
        if (!isSignUp && /email.*(not verified|unverified|not confirmed)|verify.*email|confirm.*email|EMAIL_NOT_VERIFIED/i.test(combinedAuthError)) {
          setAuthNotice('Seu e-mail ainda não foi confirmado. Abra a mensagem de confirmação que enviamos, confira também o spam e depois volte para entrar.');
          return;
        }
        if (isSignUp && /already.*(exist|register)|user.*exists|EMAIL_ALREADY_EXISTS/i.test(combinedAuthError)) {
          throw new Error('Este e-mail já tem uma conta. Toque em Entrar e use a senha que você cadastrou.');
        }
        if (!isSignUp && /invalid.*(email|password|credential)|incorrect.*(email|password)|INVALID_EMAIL_OR_PASSWORD/i.test(combinedAuthError)) {
          throw new Error('E-mail ou senha não conferem. Confira os dados e tente novamente.');
        }
        if (/failed to fetch|network error|load failed|fetch failed/i.test(authMessage)) {
          throw new Error('Não foi possível conectar ao serviço de acesso. Verifique sua internet e tente novamente.');
        }
        throw new Error(authMessage || (isSignUp ? 'Não foi possível criar sua conta.' : 'Não foi possível entrar. Tente novamente.'));
      }

      const sessionResult = await readAuthSessionWithRetry();
      if (sessionResult.error) {
        throw new Error(`O serviço de autenticação não conseguiu ler a sessão (HTTP ${sessionResult.error.status || 'erro'}): ${sessionResult.error.message || 'resposta inválida do servidor'}`);
      }
      if (!sessionResult.data?.session) {
        if (isSignUp) {
          setAuthNotice(`Conta criada${email ? ` para ${email}` : ''}. Abra o e-mail de confirmação, inclusive a pasta de spam, e confirme seu endereço. Depois, volte aqui e toque em Entrar.`);
          setIsSignUp(false);
          return;
        }
        throw new Error('A autenticação respondeu, mas o navegador não confirmou a sessão. Confira se os cookies estão permitidos para este site e tente novamente.');
      }
      let verifiedUser;
      try {
        verifiedUser = await verifyApiSession(sessionResult);
      } catch (verificationError) {
        const detail = verificationError.message || '';
        if (/token|jwt|sess[aã]o|session|unauthorized|401/i.test(detail)) {
          throw new Error('Sua sessão não foi aceita pela API. Saia, entre novamente e, se continuar, envie este erro ao suporte: ' + detail);
        }
        throw verificationError;
      }
      setUser(verifiedUser);
      setCompanyName(verifiedUser.company?.name || '');
    } catch (error) {
      setAuthError(error.message || 'Ocorreu um erro ao acessar sua conta.');
    } finally {
      setAuthBusy(false);
    }
  }

  async function handlePasswordRecovery(event) {
    event.preventDefault(); setAuthBusy(true); setAuthError(''); setAuthNotice('');
    const email = String(new FormData(event.currentTarget).get('email') || '').trim().toLowerCase();
    try {
      const result = await authClient.requestPasswordReset({ email, redirectTo: `${window.location.origin}/?reset=1` });
      if (result?.error) throw new Error(result.error.message || 'Não foi possível enviar a recuperação.');
      setAuthNotice('Enviamos as instruções de recuperação. Confira sua caixa de entrada e a pasta de spam.');
    } catch (error) { setAuthError(error.message || 'Não foi possível enviar a recuperação.'); }
    finally { setAuthBusy(false); }
  }

  async function handlePasswordReset(event) {
    event.preventDefault(); setAuthBusy(true); setAuthError(''); setAuthNotice('');
    const data = new FormData(event.currentTarget); const password = String(data.get('password') || ''); const confirmation = String(data.get('confirmation') || ''); const token = new URLSearchParams(window.location.search).get('token');
    try {
      if (password.length < 8 || password !== confirmation) throw new Error('Use pelo menos 8 caracteres e repita a mesma senha.');
      if (!token) throw new Error('Este link de recuperação não possui um token válido. Solicite um novo link.');
      const result = await authClient.resetPassword({ newPassword: password, token });
      if (result?.error) throw new Error(result.error.message || 'Não foi possível alterar a senha.');
      window.history.replaceState({}, '', window.location.pathname); setAuthView('access'); setIsSignUp(false); setAuthNotice('Senha alterada. Entre com sua nova senha.');
    } catch (error) { setAuthError(error.message || 'Não foi possível alterar a senha.'); }
    finally { setAuthBusy(false); }
  }

  async function handleSignOut() {
    await authClient?.signOut();
    setUser(null);
    setCompanyName('');
    setPage('overview');
    setMobileMoreOpen(false);
    setAuthError('');
    setAuthNotice('');
  }

  if (authLoading) return <div className="auth-loading">Conferindo sua sessão…</div>;
  if (!user) return <AuthScreen view={authView} isSignUp={isSignUp} onToggleMode={(nextMode) => { setAuthView('access'); setIsSignUp(nextMode); setAuthError(''); setAuthNotice(''); }} onForgot={() => { setAuthView('forgot'); setAuthError(''); setAuthNotice(''); }} onBack={() => { setAuthView('access'); setIsSignUp(false); setAuthError(''); setAuthNotice(''); }} onSubmit={handleAuthSubmit} onRecovery={handlePasswordRecovery} onReset={handlePasswordReset} busy={authBusy} error={authError} notice={authNotice} />;
  if (!user.company) return <Suspense fallback={<div className="auth-loading">Preparando seu espaço…</div>}><CompanyAccessPage user={user} onComplete={(company) => { setUser((current) => ({ ...current, company })); setCompanyName(company.name); setPage('overview'); }} onSignOut={handleSignOut} /></Suspense>;

  const apiLabel = apiStatus === 'online' ? 'API conectada' : apiStatus === 'checking' ? 'Verificando API' : 'API desconectada';
  const ApiIcon = apiStatus === 'online' ? Wifi : WifiOff;
  const permissionArea = { customers: 'commercial', catalog: 'commercial', suppliers: 'commercial', quotes: 'commercial', sales: 'commercial', orders: 'operations', stock: 'operations', agenda: 'operations', finance: 'finance', receipts: 'finance', reports: 'reports', audit: 'audit' };
  const canUsePage = (key) => user.company?.role === 'owner' || !permissionArea[key] || user.company?.permissions?.[permissionArea[key]] !== false;
  async function installApplication() { if (!installPrompt) return; await installPrompt.prompt(); await installPrompt.userChoice; setInstallPrompt(null); }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand sidebar-brand" href="#inicio" aria-label="EletroAgro Soluções — início">
          <span className="brand-monogram" aria-hidden="true"><span className="monogram-e">E</span><span className="monogram-a">A</span></span>
        </a>
        <div className="sidebar-company-title" title="EletroAgro Soluções"><small>SEU SISTEMA</small><strong><span>EletroAgro</span><em>Soluções</em></strong></div>
        <nav aria-label="Menu principal">
          {desktopNavigationGroups.map((group) => <div className="nav-group" key={group.label}>
            <p className="nav-caption">{group.label}</p>
            {group.keys.filter(canUsePage).map((key) => {
              const { label, icon: Icon } = navigation.find((item) => item.key === key);
              const active = page === key;
              return <a className={`nav-link${active ? ' active' : ''}`} href={`#${key}`} key={key} aria-label={label} aria-current={active ? 'page' : undefined} title={label} onClick={(event) => { event.preventDefault(); setPage(key); }}>
                <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
              </a>;
            })}
          </div>)}
        </nav>
        <div className="sidebar-bottom">
          <a className={`nav-link${page === 'settings' ? ' active' : ''}`} href="#configuracoes" aria-label="Configurações" title="Configurações" onClick={(event) => { event.preventDefault(); setPage('settings'); }}><Settings size={18} /><span>Configurações</span></a>
          <div className="user-card"><span className="user-avatar">{(user.name || user.email || 'U').slice(0, 1).toUpperCase()}</span><span><b>{user.name || 'Usuário'}</b><small>{user.email}</small></span><button className="logout-button" onClick={handleSignOut} title="Sair" aria-label="Sair"><LogOut size={16} /></button></div>
        </div>
      </aside>

      <main className="main-content" id="inicio">
        <header className="topbar">
          <div className="breadcrumbs">Início <span>/</span> <b>{pageLabels[page] || 'Visão geral'}</b></div>
          <div className="topbar-tools">{installPrompt && <button className="topbar-install" onClick={installApplication}><Download size={15}/>Instalar</button>}{reminderCount > 0 && <button className="topbar-reminders" onClick={() => setPage('agenda')} title="Compromissos próximos"><Bell size={15}/><b>{reminderCount}</b></button>}<div className={`connection ${online && apiStatus === 'online' ? 'connected' : ''}`}><ApiIcon size={15} />{!online ? 'Sem conexão' : pendingSync ? `${pendingSync} pendente(s)` : apiLabel}<i /></div></div>
        </header>
        <Suspense fallback={<div className="app-module-loading">Abrindo {pageLabels[page]?.toLowerCase() || 'módulo'}…</div>}>
          {page === 'customers' ? <CustomersPage onCompanyChange={setCompanyName} /> : page === 'catalog' ? <CatalogPage /> : page === 'quotes' ? <QuotesPage /> : page === 'suppliers' ? <SuppliersPage /> : page === 'sales' ? <SalesPage /> : page === 'orders' ? <ServiceOrdersPage /> : page === 'stock' ? <StockPage /> : page === 'finance' ? <FinancePage /> : page === 'receipts' ? <ReceiptsPage /> : page === 'reports' ? <ReportsPage /> : page === 'agenda' ? <AgendaPage /> : page === 'audit' ? <AuditPage /> : page === 'settings' ? <SettingsPage onCompanyChange={setCompanyName} onCompanyDeleted={() => { setCompanyName(''); setUser((current) => ({ ...current, company: null })); setPage('customers'); }} /> : <OverviewPage onNavigate={setPage} />}
        </Suspense>
      </main>
      {mobileMoreOpen && <>
        <button className="mobile-more-dismiss" type="button" aria-label="Fechar menu" onClick={() => setMobileMoreOpen(false)} />
        <section id="mobile-more-menu" ref={mobileMoreSheetRef} className="mobile-more-sheet" aria-label="Mais módulos" tabIndex={-1}>
          <header><div><span>MENU</span><h2>Acesse outras áreas</h2></div><button type="button" aria-label="Fechar menu" onClick={() => setMobileMoreOpen(false)}><X size={19} /></button></header>
          {mobileMoreGroups.map((group) => <div className="mobile-more-group" key={group.label}>
            <h3>{group.label}</h3>
            <div>{group.keys.filter(canUsePage).map((key) => {
              const item = navigation.find((entry) => entry.key === key);
              const Icon = item.icon;
              return <button type="button" className={page === key ? 'active' : ''} key={key} onClick={() => { setPage(key); setMobileMoreOpen(false); }}><Icon size={19} /><span>{item.label}</span></button>;
            })}</div>
          </div>)}
          {installPrompt && <button className="mobile-install-app" type="button" onClick={installApplication}><Download size={18}/><span><b>Instalar aplicativo</b><small>Adicionar à tela inicial deste aparelho</small></span></button>}
          <div className="mobile-more-account"><span className="user-avatar">{(user.name || user.email || 'U').slice(0, 1).toUpperCase()}</span><span><b>{user.name || 'Usuário'}</b><small>{user.email}</small></span><button type="button" onClick={handleSignOut}><LogOut size={17} /><span>Sair</span></button></div>
        </section>
      </>}
      <nav className="mobile-bottom-nav" aria-label="Navegação principal no celular">
        {navigation.filter(({ key }) => mobilePrimaryKeys.includes(key) && canUsePage(key)).map(({ label, icon: Icon, key }) => (
          <button className={`mobile-nav-item${page === key ? ' active' : ''}`} type="button" key={key} aria-current={page === key ? 'page' : undefined} onClick={() => setPage(key)}>
            <Icon size={20} strokeWidth={1.9} /><span>{label}</span>
          </button>
        ))}
        <button ref={mobileMoreTriggerRef} className={`mobile-nav-item${mobileMoreOpen || !mobilePrimaryKeys.includes(page) ? ' active' : ''}`} type="button" aria-expanded={mobileMoreOpen} onClick={() => setMobileMoreOpen((open) => !open)}>
          {mobileMoreOpen ? <X size={20} strokeWidth={1.9} /> : <Menu size={20} strokeWidth={1.9} />}<span>Mais</span>
        </button>
      </nav>
    </div>
  );
}

function AuthScreen({ view, isSignUp, onToggleMode, onForgot, onBack, onSubmit, onRecovery, onReset, busy, error, notice }) {
  if (!authClient) {
    return <main className="auth-shell"><section className="auth-card"><Brand /><h1>Configuração necessária</h1><p className="auth-description">Configure VITE_NEON_AUTH_URL em apps/web/.env e reinicie o Vite para ativar o acesso.</p></section></main>;
  }
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <Brand />
        <p className="auth-eyebrow"><span className="auth-eyebrow-dot" /> ACESSO SEGURO</p>
        <h1>{view === 'forgot' ? 'Recuperar acesso' : view === 'reset' ? 'Criar nova senha' : isSignUp ? 'Crie sua conta' : 'Bem-vindo de volta'}</h1>
        <p className="auth-description">{view === 'forgot' ? 'Informe seu e-mail para receber o link seguro de recuperação.' : view === 'reset' ? 'Escolha uma senha nova para voltar ao sistema.' : isSignUp ? 'Organize sua operação em um só lugar. Cadastre seu acesso para começar.' : 'Entre para continuar no sistema de gestão da EletroAgro.'}</p>
        <form className="auth-form" onSubmit={view === 'forgot' ? onRecovery : view === 'reset' ? onReset : onSubmit}>
          {view === 'access' && isSignUp && <label>Nome<input name="name" type="text" autoComplete="name" minLength="2" maxLength="120" required placeholder="Seu nome" /></label>}
          {view !== 'reset' && <label>E-mail<input name="email" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck="false" autoComplete="email" required placeholder="voce@empresa.com" /></label>}
          {view !== 'forgot' && <label>{view === 'reset' ? 'Nova senha' : 'Senha'}<input name="password" type="password" autoCapitalize="none" autoComplete={view === 'reset' || isSignUp ? 'new-password' : 'current-password'} minLength="8" required placeholder={view === 'reset' || isSignUp ? 'Pelo menos 8 caracteres' : 'Digite sua senha'} /></label>}
          {view === 'reset' && <label>Repita a nova senha<input name="confirmation" type="password" autoComplete="new-password" minLength="8" required placeholder="Digite novamente" /></label>}
          {error && <p className="auth-message error" role="alert">{error}</p>}
          {notice && <p className="auth-message notice" role="status">{notice}</p>}
          <button className="auth-submit" type="submit" disabled={busy}>{busy ? <><span className="auth-spinner" /> Aguarde…</> : view === 'forgot' ? 'Enviar recuperação' : view === 'reset' ? 'Salvar nova senha' : isSignUp ? 'Criar minha conta' : 'Entrar na minha conta'}</button>
        </form>
        {view === 'access' ? <><p className="auth-toggle">{isSignUp ? 'Já tem uma conta?' : 'Ainda não tem uma conta?'} <button type="button" onClick={() => onToggleMode(!isSignUp)}>{isSignUp ? 'Entrar' : 'Criar conta'}</button></p>{!isSignUp && <p className="auth-toggle auth-forgot"><button type="button" onClick={onForgot}>Esqueci minha senha</button></p>}</> : <p className="auth-toggle"><button type="button" onClick={onBack}>Voltar para entrar</button></p>}
        <div className="auth-security"><ShieldCheck size={16} /><span><b>Acesso protegido</b><small>Seus dados ficam seguros com autenticação criptografada.</small></span></div>
      </section>
    </main>
  );
}

function Brand() {
  return <div className="auth-brand-wrap"><a className="auth-brand" href="#inicio" aria-label="EletroAgro Soluções"><img src="/logo-eletroagro.jpeg" alt="EletroAgro Soluções" /></a><span><b>EletroAgro</b><small>GESTÃO E OPERAÇÃO</small></span></div>;
}

function Metric({ icon: Icon, tone, label, value, note }) {
  return <article className="metric-card"><span className={`metric-icon ${tone}`}><Icon size={18} /></span><span className="metric-label">{label}</span><strong>{value}</strong><span className="metric-note">{note}</span></article>;
}

function StatusRow({ icon: Icon, title, detail, state }) {
  return <div className="status-row"><span className="status-icon"><Icon size={17} /></span><span className="status-text"><b>{title}</b><small>{detail}</small></span><i className={`status-dot ${state}`} /> </div>;
}
