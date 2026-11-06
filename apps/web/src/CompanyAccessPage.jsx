import { useState } from 'react';
import { apiRequest } from './apiClient.js';

export default function CompanyAccessPage({ user, onComplete, onSignOut }) {
  const initialCode = new URLSearchParams(window.location.search).get('invite') || '';
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function sendRequest(path, body) {
    setBusy(true);
    setError('');
    try {
      const result = await apiRequest(path, { method: 'POST', body: JSON.stringify(body) });
      onComplete(result.company);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  function acceptInvitation(event) {
    event.preventDefault();
    return sendRequest('/api/company/invitations/accept', { code: code.trim() });
  }

  return (
    <main className="company-access-screen">
      <section className="company-access-card">
        <div className="company-access-brand"><img src="/logo-eletroagro.jpeg" alt="EletroAgro Soluções" /></div>
        <span className="workspace-eyebrow">ACESSO À EQUIPE</span>
        <h1>Entre com seu convite</h1>
        <p>Olá, {user.name || user.email}. Use o código enviado pelo responsável da empresa. Se ainda não recebeu um convite, solicite sua liberação.</p>
        {user.databaseUnavailable ? (
          <p role="status">Não foi possível consultar sua empresa agora. Tente novamente mais tarde.</p>
        ) : (
          <>
            <form onSubmit={acceptInvitation}>
              <label>
                Código de convite
                <input required minLength={30} maxLength={100} value={code} disabled={busy}
                  onChange={event => setCode(event.target.value)} placeholder="Cole o código recebido" />
              </label>
              <small>Use o convite destinado a {user.email}.</small>
              <button className="workspace-button primary" disabled={busy}>
                {busy ? 'Validando…' : 'Aceitar convite'}
              </button>
            </form>
            {user.canCreateCompany && (
              <button className="workspace-button subtle" disabled={busy}
                onClick={() => sendRequest('/api/company', { name: 'EletroAgro Soluções' })}>
                Criar espaço autorizado
              </button>
            )}
          </>
        )}
        {error && <p className="workspace-message is-error" role="alert">{error}</p>}
        <button className="company-access-signout" disabled={busy} onClick={onSignOut}>Sair desta conta</button>
      </section>
    </main>
  );
}
