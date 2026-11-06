import { PUBLIC_SITE_ORIGIN } from '../../../../shared/public-site.js';

const PUBLIC_ID = /^[a-f0-9]{64}$/;

export function isLocalOrigin(value) {
  const { hostname } = new URL(value);
  return hostname === 'localhost' || hostname.endsWith('.localhost')
    || hostname === '[::1]' || /^127\./.test(hostname);
}

export function publicOriginUrl(publicId, {
  configuredOrigin = import.meta.env?.VITE_PUBLIC_SITE_URL,
  production = import.meta.env?.PROD === true,
} = {}) {
  if (!PUBLIC_ID.test(publicId)) throw new Error('O registro não possui um identificador público válido.');
  let base;
  try {
    base = new URL(configuredOrigin || PUBLIC_SITE_ORIGIN);
  } catch {
    throw new Error('Configure um endereço válido para a consulta pública.');
  }

  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password
    || base.search || base.hash || base.pathname !== '/') {
    throw new Error('O endereço público deve conter apenas o domínio, sem credenciais ou caminhos.');
  }
  if (production && (base.protocol !== 'https:' || isLocalOrigin(base.href))) {
    throw new Error('Use um domínio HTTPS público para gerar etiquetas de produção.');
  }
  return new URL(`/rastrear/${publicId}`, base.origin).href;
}
