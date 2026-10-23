import { createAuthClient } from '@neondatabase/neon-js/auth';
import { BetterAuthVanillaAdapter } from '@neondatabase/neon-js/auth/vanilla/adapters';

const neonAuthUrl = import.meta.env.VITE_NEON_AUTH_URL
  || 'https://ep-flat-sky-b6ju7s7a.neonauth.c-2.sa-east-1.aws.neon.tech/neondb/auth';

// Mobile browsers can block third-party auth cookies when the app calls Neon
// directly from a Vercel domain. The production rewrite keeps auth first-party.
const authUrl = import.meta.env.PROD
  ? new URL('/neon-auth', window.location.origin).toString()
  : neonAuthUrl;

export const authClient = authUrl
  ? createAuthClient(authUrl, {
      adapter: BetterAuthVanillaAdapter({
        fetchOptions: { credentials: 'include' },
      }),
    })
  : null;

export async function getAuthAccessToken(sessionResult, { forceRefresh = false } = {}) {
  if (!authClient) throw new Error('A autenticação não está configurada.');

  let currentSession = sessionResult;
  if (!currentSession?.data?.session) currentSession = await authClient.getSession();
  if (currentSession.error) {
    throw new Error(currentSession.error.message || 'Não foi possível recuperar sua sessão. Entre novamente.');
  }

  let token = forceRefresh ? null : currentSession.data?.session?.token;
  if (!token) {
    const tokenResult = await authClient.token();
    if (tokenResult.error) {
      throw new Error(tokenResult.error.message || 'Não foi possível renovar sua sessão. Entre novamente.');
    }
    token = tokenResult.data?.token || currentSession.data?.session?.token;
  }

  if (!token) throw new Error('Sua sessão expirou. Entre novamente.');
  return token;
}
