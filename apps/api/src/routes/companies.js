import { Router } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { requireCompanyMembership, requireDatabase } from '../middleware/neon-auth.js';
import { sendInvitationEmail } from '../services/invitation-email.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const permissionKeys = ['commercial', 'operations', 'finance', 'reports', 'audit'];
const defaultPermissions = Object.fromEntries(permissionKeys.map((key) => [key, true]));
function normalizePermissions(input) { return Object.fromEntries(permissionKeys.map((key) => [key, input?.[key] !== false])); }
export const companyTestHelpers = { normalizePermissions, permissionKeys };

export function createCompaniesRouter({ pool, requireAuth }) {
  const router = Router();
  router.use(requireAuth, requireDatabase(pool));

  router.get('/me', async (request, response) => {
    try {
      await pool.query(
        `UPDATE public.company_memberships SET
           email = COALESCE(NULLIF($3,''), email), display_name = COALESCE(NULLIF($4,''), display_name), updated_at = now()
         WHERE auth_issuer = $1 AND auth_subject = $2 AND is_active`,
        [request.auth.issuer, request.auth.subject, request.auth.email || '', request.auth.name || ''],
      );
      const result = await pool.query(
        `SELECT c.id, c.name, c.tax_identifier, c.phone, c.email, c.document_settings, m.role, m.permissions, m.email AS member_email,
                m.display_name AS member_name
         FROM public.company_memberships m
         JOIN public.companies c ON c.id = m.company_id
         WHERE m.auth_issuer = $1 AND m.auth_subject = $2
           AND m.is_active AND c.archived_at IS NULL
         ORDER BY m.created_at ASC
         LIMIT 1`,
        [request.auth.issuer, request.auth.subject],
      );
      return response.json({ company: result.rows[0] || null });
    } catch (error) {
      console.error('Falha ao carregar empresa do usuário:', error.message);
      return response.status(500).json({ error: { code: 'COMPANY_LOOKUP_FAILED', message: 'Não foi possível carregar a empresa.' } });
    }
  });

  router.get('/access', requireCompanyMembership(pool), async (request, response) => {
    if (request.company.role !== 'owner') return response.status(403).json({ error: { code: 'OWNER_REQUIRED', message: 'Somente o responsável da empresa pode gerenciar acessos.' } });
    try {
      const [members, invitations] = await Promise.all([
        pool.query(`SELECT id, email, display_name, role, is_active, permissions, created_at FROM public.company_memberships WHERE company_id=$1 ORDER BY role DESC, created_at`, [request.company.company_id]),
        pool.query(`SELECT id, invited_email, role, permissions, expires_at, created_at FROM public.company_invitations WHERE company_id=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now() ORDER BY created_at DESC`, [request.company.company_id]),
      ]);
      return response.json({ members: members.rows, invitations: invitations.rows });
    } catch (error) {
      console.error('Falha ao carregar acessos da empresa:', error.message);
      return response.status(500).json({ error: { code: 'ACCESS_LOOKUP_FAILED', message: 'Não foi possível carregar os acessos.' } });
    }
  });

  router.patch('/access/members/:id', requireCompanyMembership(pool), async (request, response) => {
    if (request.company.role !== 'owner') return response.status(403).json({ error: { code: 'OWNER_REQUIRED', message: 'Somente o responsável da empresa pode alterar acessos.' } });
    const active = request.body?.active;
    if (!uuidPattern.test(request.params.id) || typeof active !== 'boolean' || request.params.id === request.company.membership_id) return response.status(400).json({ error: { code: 'INVALID_MEMBERSHIP_CHANGE', message: 'Selecione uma pessoa da equipe e uma situação válida.' } });
    try {
      const result = await pool.query(`UPDATE public.company_memberships SET is_active=$3,updated_at=now()
        WHERE company_id=$1 AND id=$2 AND role='member' RETURNING id,email,display_name,is_active`, [request.company.company_id,request.params.id,active]);
      if (!result.rowCount) return response.status(404).json({ error: { code: 'MEMBER_NOT_FOUND', message: 'Membro não encontrado.' } });
      await pool.query(`INSERT INTO public.audit_logs(company_id,actor_subject,action,entity_type,entity_id,summary) VALUES($1,$2,$3,'company_membership',$4,$5::jsonb)`,[request.company.company_id,request.auth.subject,active?'access_restored':'access_suspended',request.params.id,JSON.stringify({email:result.rows[0].email})]);
      return response.json({ member: result.rows[0] });
    } catch (error) {
      if (error.code === '23514') return response.status(409).json({ error: { code: 'TEAM_LIMIT_REACHED', message: 'A empresa já atingiu o limite de cinco usuários ativos.' } });
      console.error('Falha ao atualizar acesso:',error.message);
      return response.status(500).json({ error: { code: 'MEMBER_UPDATE_FAILED', message: 'Não foi possível atualizar o acesso.' } });
    }
  });

  router.patch('/access/members/:id/permissions', requireCompanyMembership(pool), async (request, response) => {
    if (request.company.role !== 'owner') return response.status(403).json({ error: { code: 'OWNER_REQUIRED', message: 'Somente o responsável da empresa pode alterar permissões.' } });
    if (!uuidPattern.test(request.params.id) || request.params.id === request.company.membership_id) return response.status(400).json({ error: { code: 'INVALID_MEMBER', message: 'Selecione um membro válido.' } });
    const permissions = normalizePermissions(request.body?.permissions);
    try {
      const result = await pool.query(`UPDATE public.company_memberships SET permissions=$3::jsonb,updated_at=now() WHERE company_id=$1 AND id=$2 AND role='member' RETURNING id,email,display_name,is_active,permissions`, [request.company.company_id, request.params.id, JSON.stringify(permissions)]);
      if (!result.rowCount) return response.status(404).json({ error: { code: 'MEMBER_NOT_FOUND', message: 'Membro não encontrado.' } });
      await pool.query(`INSERT INTO public.audit_logs(company_id,actor_subject,action,entity_type,entity_id,summary) VALUES($1,$2,'permissions_updated','company_membership',$3,$4::jsonb)`, [request.company.company_id, request.auth.subject, request.params.id, JSON.stringify({ permissions })]);
      return response.json({ member: result.rows[0] });
    } catch (error) { console.error('Falha ao atualizar permissões:', error.message); return response.status(500).json({ error: { code: 'PERMISSIONS_UPDATE_FAILED', message: 'Não foi possível atualizar as permissões.' } }); }
  });

  router.post('/invitations', requireCompanyMembership(pool), async (request, response) => {
    if (request.company.role !== 'owner') return response.status(403).json({ error: { code: 'OWNER_REQUIRED', message: 'Somente o responsável da empresa pode convidar pessoas.' } });
    const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return response.status(400).json({ error: { code: 'INVALID_INVITE_EMAIL', message: 'Informe um e-mail válido.' } });
    const code = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(code).digest('hex');
    const permissions = normalizePermissions(request.body?.permissions);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM public.companies WHERE id=$1 FOR UPDATE', [request.company.company_id]);
      await client.query(`UPDATE public.company_invitations SET revoked_at=now() WHERE company_id=$1 AND lower(invited_email)=lower($2) AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at<=now()`, [request.company.company_id,email]);
      const existing = await client.query(`SELECT 1 FROM public.company_memberships WHERE company_id=$1 AND lower(email)=lower($2) AND is_active`, [request.company.company_id, email]);
      if (existing.rowCount) { await client.query('ROLLBACK'); return response.status(409).json({ error: { code: 'MEMBER_ALREADY_ACTIVE', message: 'Esse e-mail já tem acesso à empresa.' } }); }
      const capacity = await client.query(`SELECT (SELECT count(*) FROM public.company_memberships WHERE company_id=$1 AND is_active)::int AS members,
        (SELECT count(*) FROM public.company_invitations WHERE company_id=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now())::int AS invitations`, [request.company.company_id]);
      if (capacity.rows[0].members + capacity.rows[0].invitations >= 5) { await client.query('ROLLBACK'); return response.status(409).json({ error: { code: 'TEAM_LIMIT_REACHED', message: 'A empresa já usa todas as cinco vagas, incluindo convites pendentes.' } }); }
      const invite = await client.query(`INSERT INTO public.company_invitations(company_id,invited_email,token_hash,invited_by_membership_id,permissions,expires_at)
        VALUES($1,$2,$3,$4,$5::jsonb,now()+interval '7 days') RETURNING id,invited_email,permissions,expires_at`, [request.company.company_id,email,tokenHash,request.company.membership_id,JSON.stringify(permissions)]);
      await client.query(`INSERT INTO public.audit_logs(company_id,actor_subject,action,entity_type,entity_id,summary) VALUES($1,$2,'invited','company_invitation',$3,$4::jsonb)`,[request.company.company_id,request.auth.subject,invite.rows[0].id,JSON.stringify({email})]);
      await client.query('COMMIT');
      const delivery = await sendInvitationEmail({ email, companyName: request.company.company_name, code });
      return response.status(201).json({ invitation: invite.rows[0], code, delivery });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error.code === '23505') return response.status(409).json({ error: { code: 'INVITE_ALREADY_PENDING', message: 'Já existe um convite pendente para esse e-mail.' } });
      console.error('Falha ao criar convite:', error.message);
      return response.status(500).json({ error: { code: 'INVITE_CREATE_FAILED', message: 'Não foi possível criar o convite.' } });
    } finally { client.release(); }
  });

  router.delete('/invitations/:id', requireCompanyMembership(pool), async (request, response) => {
    if (request.company.role !== 'owner') return response.status(403).json({ error: { code: 'OWNER_REQUIRED', message: 'Somente o responsável da empresa pode cancelar convites.' } });
    if (!uuidPattern.test(request.params.id)) return response.status(400).json({ error: { code: 'INVALID_INVITATION_ID', message: 'Identificador de convite inválido.' } });
    try {
      const result = await pool.query(`UPDATE public.company_invitations SET revoked_at=now() WHERE company_id=$1 AND id=$2 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id`, [request.company.company_id,request.params.id]);
      if (!result.rowCount) return response.status(404).json({ error: { code: 'INVITE_NOT_FOUND', message: 'Convite não encontrado ou já utilizado.' } });
      return response.json({ revoked: true });
    } catch (error) { console.error('Falha ao cancelar convite:',error.message); return response.status(500).json({ error: { code: 'INVITE_REVOKE_FAILED', message: 'Não foi possível cancelar o convite.' } }); }
  });

  router.post('/invitations/accept', async (request, response) => {
    const code = typeof request.body?.code === 'string' ? request.body.code.trim() : '';
    const email = typeof request.auth.email === 'string' ? request.auth.email.trim().toLowerCase() : '';
    if (code.length < 30 || code.length > 100 || !email) return response.status(400).json({ error: { code: 'INVALID_INVITE', message: 'Entre com o e-mail convidado e informe o código recebido.' } });
    const tokenHash = createHash('sha256').update(code).digest('hex');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const invite = await client.query(`SELECT i.*, c.name AS company_name FROM public.company_invitations i JOIN public.companies c ON c.id=i.company_id
        WHERE i.token_hash=$1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>now() AND lower(i.invited_email)=lower($2) AND c.archived_at IS NULL FOR UPDATE OF i`, [tokenHash,email]);
      if (!invite.rowCount) { await client.query('ROLLBACK'); return response.status(404).json({ error: { code: 'INVITE_UNAVAILABLE', message: 'Código inválido, expirado ou destinado a outro e-mail.' } }); }
      const existing = await client.query(`SELECT 1 FROM public.company_memberships WHERE auth_issuer=$1 AND auth_subject=$2 AND is_active`, [request.auth.issuer,request.auth.subject]);
      if (existing.rowCount) { await client.query('ROLLBACK'); return response.status(409).json({ error: { code: 'ACCOUNT_ALREADY_LINKED', message: 'Esta conta já está vinculada a uma empresa.' } }); }
      await client.query('SELECT id FROM public.companies WHERE id=$1 FOR UPDATE',[invite.rows[0].company_id]);
      const membership = await client.query(`INSERT INTO public.company_memberships(company_id,auth_issuer,auth_subject,role,email,display_name,permissions)
        VALUES($1,$2,$3,'member',$4,$5,$6::jsonb) RETURNING id`, [invite.rows[0].company_id,request.auth.issuer,request.auth.subject,email,(request.auth.name||'').slice(0,120),JSON.stringify(invite.rows[0].permissions || defaultPermissions)]);
      await client.query('UPDATE public.company_invitations SET accepted_at=now() WHERE id=$1',[invite.rows[0].id]);
      await client.query(`INSERT INTO public.audit_logs(company_id,actor_subject,action,entity_type,entity_id,summary) VALUES($1,$2,'joined','company_membership',$3,$4::jsonb)`,[invite.rows[0].company_id,request.auth.subject,membership.rows[0].id,JSON.stringify({email})]);
      await client.query('COMMIT');
      return response.status(201).json({ company: { id: invite.rows[0].company_id, name: invite.rows[0].company_name, role: 'member' } });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error.code === '23514') return response.status(409).json({ error: { code: 'TEAM_LIMIT_REACHED', message: 'A empresa já atingiu o limite de cinco usuários.' } });
      console.error('Falha ao aceitar convite:',error.message);
      return response.status(500).json({ error: { code: 'INVITE_ACCEPT_FAILED', message: 'Não foi possível aceitar o convite.' } });
    } finally { client.release(); }
  });

  router.patch('/me', requireCompanyMembership(pool), async (request, response) => {
    if (request.company.role !== 'owner') return response.status(403).json({ error: { code: 'OWNER_REQUIRED', message: 'Somente o responsável da empresa pode editar estes dados.' } });
    const input = request.body || {};
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    const taxIdentifier = typeof input.taxIdentifier === 'string' ? input.taxIdentifier.trim() : '';
    const phone = typeof input.phone === 'string' ? input.phone.trim() : '';
    const email = typeof input.email === 'string' ? input.email.trim() : '';
    if (name.length < 2 || name.length > 160) return response.status(400).json({ error: { code: 'INVALID_COMPANY_NAME', message: 'Informe o nome da empresa (de 2 a 160 caracteres).' } });
    if (taxIdentifier.length > 30 || phone.length > 40 || email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      return response.status(400).json({ error: { code: 'INVALID_COMPANY_DETAILS', message: 'Confira o CPF/CNPJ, telefone e e-mail informados.' } });
    }
    try {
      const result = await pool.query(
        `UPDATE public.companies SET name = $3, tax_identifier = $4, phone = $5, email = $6, updated_at = now()
         WHERE id = $1 AND archived_at IS NULL AND EXISTS (
           SELECT 1 FROM public.company_memberships WHERE id = $2 AND role = 'owner' AND is_active
         ) RETURNING id, name, tax_identifier, phone, email`,
        [request.company.company_id, request.company.membership_id, name, taxIdentifier || null, phone || null, email || null],
      );
      if (!result.rowCount) return response.status(404).json({ error: { code: 'COMPANY_NOT_FOUND', message: 'Empresa não encontrada.' } });
      return response.json({ company: { ...result.rows[0], role: 'owner' } });
    } catch (error) {
      if (error.code === '23505') return response.status(409).json({ error: { code: 'COMPANY_DOCUMENT_EXISTS', message: 'Já existe uma empresa ativa com esse CPF/CNPJ.' } });
      console.error('Falha ao atualizar empresa:', error.message);
      return response.status(500).json({ error: { code: 'COMPANY_UPDATE_FAILED', message: 'Não foi possível atualizar a empresa.' } });
    }
  });

  router.delete('/me', requireCompanyMembership(pool), async (request, response) => {
    if (request.company.role !== 'owner') return response.status(403).json({ error: { code: 'OWNER_REQUIRED', message: 'Somente o responsável da empresa pode excluir todos os dados.' } });
    const confirmation = typeof request.body?.confirmation === 'string' ? request.body.confirmation.trim() : '';
    if (confirmation !== request.company.company_name) return response.status(400).json({ error: { code: 'COMPANY_CONFIRMATION_REQUIRED', message: 'Digite o nome exato da empresa para confirmar a exclusão.' } });
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const locked = await client.query('SELECT name FROM public.companies WHERE id = $1 AND archived_at IS NULL FOR UPDATE', [request.company.company_id]);
      if (!locked.rowCount || locked.rows[0].name !== confirmation) {
        await client.query('ROLLBACK');
        return response.status(409).json({ error: { code: 'COMPANY_CHANGED', message: 'O nome da empresa foi alterado. Atualize a tela e tente novamente.' } });
      }
      const companyId = request.company.company_id;
      await client.query('DELETE FROM public.idempotency_keys WHERE company_id = $1', [companyId]);
      await client.query('DELETE FROM public.notification_preferences WHERE company_id = $1', [companyId]);
      await client.query('DELETE FROM public.service_order_attachments WHERE company_id = $1', [companyId]);
      await client.query('DELETE FROM public.receipts WHERE company_id = $1', [companyId]);
      await client.query('DELETE FROM public.audit_logs WHERE company_id = $1', [companyId]);
      await client.query('DELETE FROM public.company_invitations WHERE company_id = $1', [companyId]);
      await client.query('DELETE FROM public.financial_payments WHERE company_id = $1', [companyId]);
      await client.query('DELETE FROM public.financial_entries WHERE company_id = $1', [companyId]);
      await client.query('DELETE FROM public.appointments WHERE company_id = $1', [companyId]);
      await client.query('DELETE FROM public.service_order_items WHERE company_id = $1', [companyId]);
      await client.query('DELETE FROM public.service_orders WHERE company_id = $1', [companyId]);
      await client.query('DELETE FROM public.stock_movements WHERE company_id = $1', [companyId]);
      await client.query('DELETE FROM public.purchase_items WHERE company_id = $1', [companyId]);
      await client.query('DELETE FROM public.purchases WHERE company_id = $1', [companyId]);
      await client.query('DELETE FROM public.sale_payments WHERE company_id = $1', [companyId]);
      await client.query('DELETE FROM public.sale_items WHERE company_id = $1', [companyId]);
      await client.query('DELETE FROM public.sales WHERE company_id = $1', [companyId]);
      await client.query('DELETE FROM public.quote_versions WHERE company_id = $1', [companyId]);
      await client.query('DELETE FROM public.quote_status_history WHERE company_id = $1', [companyId]);
      await client.query('DELETE FROM public.quote_items WHERE company_id = $1', [companyId]);
      await client.query('DELETE FROM public.quotes WHERE company_id = $1', [companyId]);
      await client.query('DELETE FROM public.document_counters WHERE company_id = $1', [companyId]);
      await client.query('DELETE FROM public.customers WHERE company_id = $1', [companyId]);
      await client.query('DELETE FROM public.catalog_items WHERE company_id = $1', [companyId]);
      await client.query('DELETE FROM public.suppliers WHERE company_id = $1', [companyId]);
      await client.query('DELETE FROM public.company_memberships WHERE company_id = $1', [companyId]);
      await client.query('DELETE FROM public.companies WHERE id = $1', [companyId]);
      await client.query('COMMIT');
      return response.json({ deleted: true });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      console.error('Falha ao excluir dados da empresa:', error.message);
      return response.status(500).json({ error: { code: 'COMPANY_DELETE_FAILED', message: 'Não foi possível excluir todos os dados da empresa.' } });
    } finally { client?.release(); }
  });

  router.post('/', async (request, response) => {
    const name = typeof request.body?.name === 'string' ? request.body.name.trim() : '';
    if (name.length < 2 || name.length > 160) {
      return response.status(400).json({ error: { code: 'INVALID_COMPANY_NAME', message: 'Informe o nome da empresa (de 2 a 160 caracteres).' } });
    }

    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      // Serialize first-company creation for the same identity.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [request.auth.issuer, request.auth.subject]);
      const existing = await client.query(
        `SELECT c.id, c.name, c.tax_identifier, c.phone, c.email, m.role
         FROM public.company_memberships m
         JOIN public.companies c ON c.id = m.company_id
         WHERE m.auth_issuer = $1 AND m.auth_subject = $2 AND m.is_active
           AND c.archived_at IS NULL
         ORDER BY m.created_at ASC LIMIT 1`,
        [request.auth.issuer, request.auth.subject],
      );
      if (existing.rowCount) {
        await client.query('ROLLBACK');
        return response.status(409).json({
          error: { code: 'COMPANY_ALREADY_EXISTS', message: 'Sua conta já está vinculada a uma empresa.' },
          company: existing.rows[0],
        });
      }

      const company = await client.query(
        'INSERT INTO public.companies (name) VALUES ($1) RETURNING id, name, tax_identifier, phone, email',
        [name],
      );
      await client.query(
        `INSERT INTO public.company_memberships (company_id, auth_issuer, auth_subject, role, email, display_name)
         VALUES ($1, $2, $3, 'owner', $4, $5)`,
        [company.rows[0].id, request.auth.issuer, request.auth.subject, request.auth.email || null, request.auth.name || null],
      );
      await client.query('COMMIT');
      return response.status(201).json({ company: { ...company.rows[0], role: 'owner' } });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      console.error('Falha ao cadastrar empresa:', error.message);
      return response.status(error.code === '23514' ? 400 : 500).json({
        error: {
          code: error.code === '23514' ? 'MEMBERSHIP_LIMIT_REACHED' : 'COMPANY_CREATE_FAILED',
          message: error.code === '23514' ? 'A empresa atingiu o limite de usuários ativos.' : 'Não foi possível cadastrar a empresa.',
        },
      });
    } finally {
      client?.release();
    }
  });

  return router;
}
