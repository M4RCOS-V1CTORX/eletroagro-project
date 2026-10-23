import { lazy, Suspense, useEffect, useState } from 'react';
import { Activity, Bolt, Boxes, BriefcaseBusiness, CalendarDays, ChartNoAxesCombined, CircleDollarSign, ClipboardList, ContactRound, LayoutDashboard, LogOut, Package, Settings, ShieldCheck, Wifi, WifiOff } from 'lucide-react';
import { authClient, getAuthAccessToken } from './authClient.js';
import { apiUrl } from './apiUrl.js';
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
  { label: 'Agenda', icon: CalendarDays, key: 'agenda' },
  { label: 'Histórico', icon: Activity, key: 'audit' },
];

const pageLabels = { overview: 'Visão geral', customers: 'Clientes', catalog: 'Produtos e serviços', suppliers: 'Fornecedores', quotes: 'Orçamentos', sales: 'Vendas', orders: 'Ordens de serviço', stock: 'Estoque', finance: 'Financeiro', agenda: 'Agenda', audit: 'Histórico', settings: 'Configurações' };

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
  const [authBusy, setAuthBusy] = useState(false);
  const [apiStatus, setApiStatus] = useState('checking');
  const [databaseStatus, setDatabaseStatus] = useState('checking');
  const [page, setPage] = useState('overview');
  const [companyName, setCompanyName] = useState('');

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

  async function handleSignOut() {
    await authClient?.signOut();
    setUser(null);
    setCompanyName('');
    setPage('overview');
    setAuthError('');
    setAuthNotice('');
  }

  if (authLoading) return <div className="auth-loading">Conferindo sua sessão…</div>;
  if (!user) return <AuthScreen isSignUp={isSignUp} onToggleMode={(nextMode) => { setIsSignUp(nextMode); setAuthError(''); setAuthNotice(''); }} onSubmit={handleAuthSubmit} busy={authBusy} error={authError} notice={authNotice} />;
  if (!user.company) return <Suspense fallback={<div className="auth-loading">Preparando seu espaço…</div>}><CompanyAccessPage user={user} onComplete={(company) => { setUser((current) => ({ ...current, company })); setCompanyName(company.name); setPage('overview'); }} onSignOut={handleSignOut} /></Suspense>;

  const apiLabel = apiStatus === 'online' ? 'API conectada' : apiStatus === 'checking' ? 'Verificando API' : 'API desconectada';
  const ApiIcon = apiStatus === 'online' ? Wifi : WifiOff;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#inicio" aria-label="EletroAgro início">
          <img className="brand-logo" src="/logo-eletroagro.jpeg" alt="EletroAgro Soluções" />
        </a>
        <div className="company-chip"><span className="company-avatar">EA</span><span><b>{companyName || 'Minha empresa'}</b><small>Ambiente local</small></span><span className="chevron">⌄</span></div>
        <p className="nav-caption">MENU PRINCIPAL</p>
        <nav aria-label="Menu principal">
          {navigation.map(({ label, icon: Icon, key }) => {
            const active = page === key;
            return <a className={`nav-link${active ? ' active' : ''}`} href={`#${key}`} key={label} aria-label={label} aria-current={active ? 'page' : undefined} title={label} onClick={(event) => { event.preventDefault(); setPage(key); }}>
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
            </a>;
          })}
        </nav>
        <div className="sidebar-bottom">
          <a className={`nav-link${page === 'settings' ? ' active' : ''}`} href="#configuracoes" aria-label="Configurações" title="Configurações" onClick={(event) => { event.preventDefault(); setPage('settings'); }}><Settings size={18} /><span>Configurações</span></a>
          <div className="user-card"><span className="user-avatar">{(user.name || user.email || 'U').slice(0, 1).toUpperCase()}</span><span><b>{user.name || 'Usuário'}</b><small>{user.email}</small></span><button className="logout-button" onClick={handleSignOut} title="Sair" aria-label="Sair"><LogOut size={16} /></button></div>
        </div>
      </aside>

      <main className="main-content" id="inicio">
        <header className="topbar">
          <div className="breadcrumbs">Início <span>/</span> <b>{pageLabels[page] || 'Visão geral'}</b></div>
          <div className={`connection ${apiStatus === 'online' ? 'connected' : ''}`}><ApiIcon size={15} />{apiLabel}<i /></div>
        </header>
        <Suspense fallback={<div className="app-module-loading">Abrindo {pageLabels[page]?.toLowerCase() || 'módulo'}…</div>}>
          {page === 'customers' ? <CustomersPage onCompanyChange={setCompanyName} /> : page === 'catalog' ? <CatalogPage /> : page === 'quotes' ? <QuotesPage /> : page === 'suppliers' ? <SuppliersPage /> : page === 'sales' ? <SalesPage /> : page === 'orders' ? <ServiceOrdersPage /> : page === 'stock' ? <StockPage /> : page === 'finance' ? <FinancePage /> : page === 'agenda' ? <AgendaPage /> : page === 'audit' ? <AuditPage /> : page === 'settings' ? <SettingsPage onCompanyChange={setCompanyName} onCompanyDeleted={() => { setCompanyName(''); setUser((current) => ({ ...current, company: null })); setPage('customers'); }} /> : <OverviewPage onNavigate={setPage} />}
        </Suspense>
      </main>
    </div>
  );
}

function AuthScreen({ isSignUp, onToggleMode, onSubmit, busy, error, notice }) {
  if (!authClient) {
    return <main className="auth-shell"><section className="auth-card"><Brand /><h1>Configuração necessária</h1><p className="auth-description">Configure VITE_NEON_AUTH_URL em apps/web/.env e reinicie o Vite para ativar o acesso.</p></section></main>;
  }
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <Brand />
        <p className="auth-eyebrow"><span className="auth-eyebrow-dot" /> ACESSO SEGURO</p>
        <h1>{isSignUp ? 'Crie sua conta' : 'Bem-vindo de volta'}</h1>
        <p className="auth-description">{isSignUp ? 'Organize sua operação em um só lugar. Cadastre seu acesso para começar.' : 'Entre para continuar no sistema de gestão da EletroAgro.'}</p>
        <form className="auth-form" onSubmit={onSubmit}>
          {isSignUp && <label>Nome<input name="name" type="text" autoComplete="name" minLength="2" maxLength="120" required placeholder="Seu nome" /></label>}
          <label>E-mail<input name="email" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck="false" autoComplete="email" required placeholder="voce@empresa.com" /></label>
          <label>Senha<input name="password" type="password" autoCapitalize="none" autoComplete={isSignUp ? 'new-password' : 'current-password'} minLength="8" required placeholder={isSignUp ? 'Pelo menos 8 caracteres' : 'Digite sua senha'} /></label>
          {error && <p className="auth-message error" role="alert">{error}</p>}
          {notice && <p className="auth-message notice" role="status">{notice}</p>}
          <button className="auth-submit" type="submit" disabled={busy}>{busy ? <><span className="auth-spinner" /> Aguarde…</> : isSignUp ? 'Criar minha conta' : 'Entrar na minha conta'}</button>
        </form>
        <p className="auth-toggle">{isSignUp ? 'Já tem uma conta?' : 'Ainda não tem uma conta?'} <button type="button" onClick={() => onToggleMode(!isSignUp)}>{isSignUp ? 'Entrar' : 'Criar conta'}</button></p>
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
