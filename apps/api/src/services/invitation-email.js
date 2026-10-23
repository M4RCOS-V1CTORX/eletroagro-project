import { createHash } from 'node:crypto';

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function invitationEmailConfiguration(environment = process.env) {
  const missing = [];
  if (!environment.RESEND_API_KEY?.trim()) missing.push('RESEND_API_KEY');
  if (!environment.EMAIL_FROM?.trim()) missing.push('EMAIL_FROM');
  return { configured: missing.length === 0, missing };
}

function invitationUrl(environment, code) {
  const base = (environment.APP_URL || environment.WEB_ORIGIN || '').split(',')[0].trim();
  if (!base) return '';
  try {
    const url = new URL(base);
    url.searchParams.set('invite', code);
    return url.toString();
  } catch {
    return '';
  }
}

function deliveryFailure(status, message = '') {
  if (status === 401 || status === 403) return 'provider_auth_failed';
  if (status === 429) return 'rate_limited';
  if (status === 422 && /(domain|sender|from).*(verif|valid)|verif.*(domain|sender)/i.test(message)) return 'sender_not_verified';
  return 'delivery_failed';
}

export async function sendInvitationEmail({ email, companyName, code, environment = process.env, fetchImpl = fetch }) {
  const configuration = invitationEmailConfiguration(environment);
  if (!configuration.configured) return { sent: false, reason: 'not_configured' };

  const appUrl = invitationUrl(environment, code);
  const safeCompanyName = escapeHtml(companyName);
  const safeCode = escapeHtml(code);
  const safeAppUrl = escapeHtml(appUrl);
  const payload = {
    from: environment.EMAIL_FROM.trim(),
    to: [email],
    subject: `Convite para acessar ${companyName}`,
    text: `Você foi convidado para ${companyName}. Entre com este mesmo e-mail e use o código: ${code}.${appUrl ? ` Abra: ${appUrl}` : ''} O convite expira em 7 dias.`,
    html: `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:auto;color:#173f58"><div style="height:5px;border-radius:8px;background:linear-gradient(90deg,#176da3,#27856e)"></div><h2 style="margin:28px 0 8px">Você foi convidado para ${safeCompanyName}</h2><p style="color:#667d8c;line-height:1.6">Crie ou acesse sua conta com este mesmo e-mail para entrar na equipe.</p><p style="padding:16px;background:#f2f7f5;border:1px solid #dce9e3;border-radius:10px;font-size:17px;word-break:break-all"><strong>${safeCode}</strong></p>${safeAppUrl ? `<p><a href="${safeAppUrl}" style="display:inline-block;padding:12px 18px;border-radius:9px;background:#176da3;color:#fff;text-decoration:none;font-weight:700">Abrir EletroAgro e aceitar convite</a></p>` : ''}<p style="margin-top:24px;color:#82929c;font-size:13px">O convite expira em 7 dias.</p></div>`,
  };
  if (environment.EMAIL_REPLY_TO?.trim()) payload.reply_to = environment.EMAIL_REPLY_TO.trim();

  let response;
  try {
    response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${environment.RESEND_API_KEY.trim()}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `invite-${createHash('sha256').update(code).digest('hex').slice(0, 32)}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    console.error('Falha de conexão com o serviço de e-mail:', error.message);
    return { sent: false, reason: 'provider_unavailable' };
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('Serviço de e-mail recusou o convite:', response.status, body?.name || body?.message || 'erro sem detalhes');
    return { sent: false, reason: deliveryFailure(response.status, body?.message), status: response.status };
  }
  return { sent: true, providerId: body?.id || null };
}

export const invitationEmailTestHelpers = { escapeHtml, invitationUrl, deliveryFailure };
