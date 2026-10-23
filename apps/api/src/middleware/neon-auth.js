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
        `SELECT c.id AS company_id, c.name AS company_name, m.id AS membership_id, m.role, m.permissions
         FROM public.company_memberships m
         JOIN public.companies c ON c.id = m.company_id
         WHERE m.auth_issuer = $1 AND m.auth_subject = $2
           AND m.is_active AND c.archived_at IS NULL
         ORDER BY m.created_at ASC
         LIMIT 1`,
        [request.auth.issuer, request.auth.subject],
      );
      if (!result.rowCount) {
        return response.status(409).json({ error: { code: 'COMPANY_SETUP_REQUIRED', message: 'Cadastre sua empresa para acessar os clientes.' } });
      }
      request.company = result.rows[0];
      return next();
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

export function idempotencyGuard(pool) {
  return async (request, response, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next();
    const key = request.get('x-idempotency-key');
    if (!key) return next();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) return response.status(400).json({ error: { code: 'INVALID_IDEMPOTENCY_KEY', message: 'Identificador de sincronização inválido.' } });
    try {
      const inserted = await pool.query(`INSERT INTO public.idempotency_keys(company_id,idempotency_key,request_path) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING idempotency_key`, [request.company.company_id, key, request.originalUrl]);
      if (!inserted.rowCount) {
        const existing = await pool.query('SELECT response_status,response_body FROM public.idempotency_keys WHERE company_id=$1 AND idempotency_key=$2', [request.company.company_id, key]);
        if (existing.rows[0]?.response_body) return response.status(existing.rows[0].response_status || 200).json(existing.rows[0].response_body);
        return response.status(409).json({ error: { code: 'SYNC_IN_PROGRESS', message: 'Esta operação já está sendo sincronizada.' } });
      }
      const originalJson = response.json.bind(response);
      response.json = (body) => {
        if (response.statusCode < 500) pool.query('UPDATE public.idempotency_keys SET response_status=$3,response_body=$4::jsonb WHERE company_id=$1 AND idempotency_key=$2', [request.company.company_id, key, response.statusCode, JSON.stringify(body)]).catch((error) => console.error('Falha ao concluir chave de sincronização:', error.message));
        return originalJson(body);
      };
      return next();
    } catch (error) {
      console.error('Falha ao validar chave de sincronização:', error.message);
      return response.status(500).json({ error: { code: 'SYNC_GUARD_FAILED', message: 'Não foi possível validar a sincronização.' } });
    }
  };
}
