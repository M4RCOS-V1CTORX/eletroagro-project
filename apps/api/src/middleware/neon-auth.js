import {authorizeRequest} from '../lib/access-control.js';
import '../env.js';
import {atomicIdempotency} from '../lib/request-pool.js';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const issuer = process.env.NEON_AUTH_ISSUER;
const jwksUrl = process.env.NEON_AUTH_JWKS_URL;
const jwks = jwksUrl ? createRemoteJWKSet(new URL(jwksUrl)) : null;

export async function requireNeonAuth(request, response, next) {
  if (!jwks || !issuer) {
    return response.status(503).json({ error: { code: 'AUTH_NOT_CONFIGURED', message: 'Neon Auth não está configurado na API.' } });
  }

  const match = request.get('authorization')?.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return response.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Entre na sua conta para continuar.' } });
  }

  try {
    const { payload } = await jwtVerify(match[1], jwks, {
      issuer,
      audience: issuer,
      algorithms: ['EdDSA'],
    });
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      return response.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Token de acesso inválido.' } });
    }
    request.auth = { subject: payload.sub, issuer: payload.iss, email: payload.email, name: payload.name };
    return next();
  } catch {
    return response.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Sessão inválida ou expirada. Entre novamente.' } });
  }
}

export function requireDatabase(pool) {
  return (_request, response, next) => {
    if (!pool) {
      return response.status(503).json({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Configure a conexão PostgreSQL para usar este módulo.' } });
    }
    return next();
  };
}

export function requireCompanyMembership(pool) {
  return async (request, response, next) => {
    if (!pool) {
      return response.status(503).json({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Configure a conexão PostgreSQL para usar este módulo.' } });
    }
    try {
      const result = await pool.query(
        `SELECT c.id AS company_id, c.name AS company_name, m.id AS membership_id, m.role, COALESCE(ap.permissions,m.permissions) AS permissions,m.access_profile_id
         FROM public.company_memberships m
         JOIN public.companies c ON c.id = m.company_id
         LEFT JOIN public.company_access_profiles ap ON ap.company_id=m.company_id AND ap.id=m.access_profile_id
         WHERE m.auth_issuer = $1 AND m.auth_subject = $2
           AND m.is_active AND c.archived_at IS NULL
         ORDER BY m.created_at ASC
         LIMIT 1`,
        [request.auth.issuer, request.auth.subject],
      );
      if (!result.rowCount) {
        return response.status(409).json({ error: { code: 'COMPANY_SETUP_REQUIRED', message: 'Cadastre sua empresa para acessar os clientes.' } });
      }
      if(request.get('x-company-context') && request.get('x-company-context')!==result.rows[0].company_id)return response.status(409).json({error:{code:'COMPANY_CONTEXT_CHANGED',message:'A empresa da sessão mudou. Reabra o sistema antes de sincronizar.'}});
      request.company = result.rows[0];
      return await authorizeRequest(pool,request,response,next);
    } catch (error) {
      console.error('Falha ao consultar vínculo da empresa:', error.message);
      return response.status(500).json({ error: { code: 'COMPANY_LOOKUP_FAILED', message: 'Não foi possível carregar a empresa.' } });
    }
  };
}

export function requireAreaPermission(area) {
  return (request, response, next) => {
    if (request.company?.role === 'owner' || request.company?.permissions?.[area] !== false) return next();
    return response.status(403).json({ error: { code: 'AREA_FORBIDDEN', message: 'Seu acesso não permite usar esta área.' } });
  };
}

export function idempotencyGuard(pool) { return (request,response,next)=>atomicIdempotency(pool,request,response,next); }
