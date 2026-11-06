import { ShieldCheck } from 'lucide-react';
import { authClient } from './authClient.js';

const screens = {
  access: {
    title: 'Bem-vindo de volta',
    description: 'Entre com sua conta autorizada para acessar a EletroAgro.',
    submitLabel: 'Entrar na minha conta',
  },
  forgot: {
    title: 'Recuperar acesso',
    description: 'Informe seu e-mail para receber o link seguro de recuperação.',
    submitLabel: 'Enviar recuperação',
  },
  reset: {
    title: 'Criar nova senha',
    description: 'Escolha uma senha nova para voltar ao sistema.',
    submitLabel: 'Salvar nova senha',
  },
};

export default function AuthScreen({ view, onForgot, onBack, onSubmit, onRecovery, onReset, busy, error, notice }) {
  const screen = screens[view] || screens.access;
  const submitHandlers = { access: onSubmit, forgot: onRecovery, reset: onReset };
  const resettingPassword = view === 'reset';

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-brand-wrap">
          <span className="auth-brand"><img src="/logo-eletroagro.jpeg" alt="EletroAgro Soluções" /></span>
          <span><b>EletroAgro</b><small>GESTÃO E OPERAÇÃO</small></span>
        </div>
        <p className="auth-eyebrow"><span className="auth-eyebrow-dot" /> ACESSO SEGURO</p>
        <h1>{screen.title}</h1>
        <p className="auth-description">{screen.description}</p>
        {!authClient && <p className="auth-message error" role="alert">O serviço de acesso está indisponível.</p>}
        <form className="auth-form" onSubmit={submitHandlers[view] || onSubmit}>
          {!resettingPassword && (
            <label>
              E-mail
              <input name="email" type="email" inputMode="email" autoCapitalize="none"
                autoCorrect="off" spellCheck={false} autoComplete="email" required placeholder="voce@empresa.com" />
            </label>
          )}
          {view !== 'forgot' && (
            <label>
              {resettingPassword ? 'Nova senha' : 'Senha'}
              <input name="password" type="password" autoCapitalize="none"
                autoComplete={resettingPassword ? 'new-password' : 'current-password'}
                minLength={8} required placeholder={resettingPassword ? 'Pelo menos 8 caracteres' : 'Digite sua senha'} />
            </label>
          )}
          {resettingPassword && (
            <label>
              Repita a nova senha
              <input name="confirmation" type="password" autoComplete="new-password"
                minLength={8} required placeholder="Digite novamente" />
            </label>
          )}
          {error && <p className="auth-message error" role="alert">{error}</p>}
          {notice && <p className="auth-message notice" role="status">{notice}</p>}
          <button className="auth-submit" type="submit" disabled={busy || !authClient}>
            {busy ? <><span className="auth-spinner" /> Aguarde…</> : screen.submitLabel}
          </button>
        </form>
        {view === 'access' ? (
          <>
            <p className="auth-toggle">Acesso restrito. Solicite a liberação da sua conta ao administrador.</p>
            <p className="auth-toggle auth-forgot"><button type="button" onClick={onForgot}>Esqueci minha senha</button></p>
          </>
        ) : <p className="auth-toggle"><button type="button" onClick={onBack}>Voltar para entrar</button></p>}
        <div className="auth-security">
          <ShieldCheck size={16} />
          <span><b>Acesso protegido</b><small>O acesso aos dados exige autorização da empresa.</small></span>
        </div>
      </section>
    </main>
  );
}
