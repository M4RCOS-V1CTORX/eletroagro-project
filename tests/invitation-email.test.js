import assert from 'node:assert/strict';
import test from 'node:test';
import { invitationEmailConfiguration, invitationEmailTestHelpers, sendInvitationEmail } from '../apps/api/src/services/invitation-email.js';

test('identifica configuração ausente sem expor credenciais', () => {
  assert.deepEqual(invitationEmailConfiguration({}), { configured: false, missing: ['RESEND_API_KEY', 'EMAIL_FROM'] });
  assert.deepEqual(invitationEmailConfiguration({ RESEND_API_KEY: 're_test', EMAIL_FROM: 'EletroAgro <acesso@example.com>' }), { configured: true, missing: [] });
});

test('monta link de convite e protege o HTML do nome da empresa', () => {
  const url = invitationEmailTestHelpers.invitationUrl({ APP_URL: 'https://eletroagro.example/' }, 'abc+/=');
  assert.equal(new URL(url).searchParams.get('invite'), 'abc+/=');
  assert.equal(invitationEmailTestHelpers.escapeHtml('<Empresa & Filhos>'), '&lt;Empresa &amp; Filhos&gt;');
});

test('envia convite com versão texto, link direto e chave de idempotência', async () => {
  let request;
  const result = await sendInvitationEmail({
    email: 'convidado@example.com', companyName: 'Eletro & Agro', code: 'codigo-seguro',
    environment: { RESEND_API_KEY: 're_test', EMAIL_FROM: 'EletroAgro <acesso@example.com>', APP_URL: 'https://app.example.com' },
    fetchImpl: async (url, options) => { request = { url, options }; return { ok: true, status: 200, json: async () => ({ id: 'email_123' }) }; },
  });
  const body = JSON.parse(request.options.body);
  assert.deepEqual(result, { sent: true, providerId: 'email_123' });
  assert.equal(request.url, 'https://api.resend.com/emails');
  assert.match(request.options.headers['Idempotency-Key'], /^invite-[a-f0-9]{32}$/);
  assert.match(body.text, /codigo-seguro/);
  assert.match(body.html, /Eletro &amp; Agro/);
  assert.equal(new URL(body.html.match(/href="([^"]+)/)[1]).searchParams.get('invite'), 'codigo-seguro');
});

test('traduz recusas comuns do provedor em causas úteis', async () => {
  const result = await sendInvitationEmail({
    email: 'convidado@example.com', companyName: 'Empresa', code: 'codigo',
    environment: { RESEND_API_KEY: 're_test', EMAIL_FROM: 'EletroAgro <acesso@example.com>' },
    fetchImpl: async () => ({ ok: false, status: 422, json: async () => ({ message: 'The sender domain is not verified' }) }),
  });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'sender_not_verified');
  assert.equal(result.status, 422);
});
