import { Router } from 'express';
import { idempotencyGuard, requireAreaPermission, requireCompanyMembership } from '../middleware/neon-auth.js';

const fields = {
  name: { column: 'name', max: 200, required: true },
  taxIdentifier: { column: 'tax_identifier', max: 30 },
  phone: { column: 'phone', max: 40 },
  email: { column: 'email', max: 254, email: true },
  postalCode: { column: 'postal_code', max: 12 },
  street: { column: 'street', max: 200 },
  streetNumber: { column: 'street_number', max: 30 },
  addressComplement: { column: 'address_complement', max: 120 },
  neighborhood: { column: 'neighborhood', max: 120 },
  city: { column: 'city', max: 120 },
  state: { column: 'state', max: 2, state: true },
  notes: { column: 'notes', max: 5000 },
  isActive: { column: 'is_active', boolean: true },
};

function parseSupplier(input, { partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Envie os dados do fornecedor em formato válido.' };
  const value = {};
  for (const [key, rule] of Object.entries(fields)) {
    if (!Object.hasOwn(input, key)) continue;
    const raw = input[key];
    if (rule.boolean) {
      if (typeof raw !== 'boolean') return { error: 'A situação do fornecedor é inválida.' };
      value[rule.column] = raw;
      continue;
    }
    if (raw !== null && typeof raw !== 'string') return { error: `O campo ${key} deve ser texto.` };
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (rule.required && text.length < 2) return { error: 'Informe o nome ou a razão social do fornecedor.' };
    if (text.length > rule.max) return { error: `Um campo do fornecedor excede o limite permitido (${rule.max} caracteres).` };
    if (rule.email && text && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return { error: 'Informe um e-mail válido.' };
    if (rule.state && text && !/^[a-z]{2}$/i.test(text)) return { error: 'Informe a sigla do estado com duas letras.' };
    value[rule.column] = text ? (rule.state ? text.toUpperCase() : text) : null;
  }
  if (!partial && !Object.hasOwn(value, 'name')) return { error: 'Informe o nome ou a razão social do fornecedor.' };
  if (partial && !Object.keys(value).length) return { error: 'Informe ao menos um campo para atualizar.' };
  return { value };
}

function handleError(error, response, action) {
  if (error.code === '23505') return response.status(409).json({ error: { code: 'SUPPLIER_DOCUMENT_EXISTS', message: 'Já existe um fornecedor ativo com esse CPF ou CNPJ.' } });
  console.error(`Falha ao ${action} fornecedor:`, error.message);
  return response.status(500).json({ error: { code: 'SUPPLIER_OPERATION_FAILED', message: `Não foi possível ${action} o fornecedor.` } });
}

export function createSuppliersRouter({ pool, requireAuth, requireDatabase }) {
  const router = Router();
  router.use(requireAuth, requireDatabase(pool), requireCompanyMembership(pool), requireAreaPermission('commercial'), idempotencyGuard(pool));
  router.param('id', (request, response, next, id) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return response.status(400).json({ error: { code: 'INVALID_SUPPLIER_ID', message: 'Identificador de fornecedor inválido.' } });
    return next();
  });

  router.get('/', async (request, response) => {
    const query = typeof request.query.q === 'string' ? request.query.q.trim().slice(0, 120) : '';
    const status = ['active', 'inactive', 'archived', 'all'].includes(request.query.status) ? request.query.status : 'active';
    const limit = Math.min(Math.max(Number.parseInt(request.query.limit, 10) || 25, 1), 100);
    const offset = Math.max(Number.parseInt(request.query.offset, 10) || 0, 0);
    try {
      const result = await pool.query(
        `SELECT id, name, tax_identifier, phone, email, postal_code, street, street_number,
                address_complement, neighborhood, city, state, notes, is_active, archived_at,
                created_at, updated_at, count(*) OVER()::int AS total_count
         FROM public.suppliers
         WHERE company_id = $1
           AND ($2 = 'all' OR ($2 = 'archived' AND archived_at IS NOT NULL)
             OR ($2 = 'active' AND archived_at IS NULL AND is_active)
             OR ($2 = 'inactive' AND archived_at IS NULL AND NOT is_active))
           AND ($3 = '' OR name ILIKE '%' || $3 || '%' OR COALESCE(tax_identifier, '') ILIKE '%' || $3 || '%'
             OR COALESCE(phone, '') ILIKE '%' || $3 || '%')
         ORDER BY lower(name), id LIMIT $4 OFFSET $5`,
        [request.company.company_id, status, query, limit, offset],
      );
      return response.json({ suppliers: result.rows.map(({ total_count, ...supplier }) => supplier), pagination: { limit, offset, total: result.rowCount ? result.rows[0].total_count : 0 } });
    } catch (error) { return handleError(error, response, 'listar'); }
  });

  router.post('/', async (request, response) => {
    const parsed = parseSupplier(request.body);
    if (parsed.error) return response.status(400).json({ error: { code: 'INVALID_SUPPLIER', message: parsed.error } });
    const entries = Object.entries(parsed.value);
    try {
      const result = await pool.query(
        `INSERT INTO public.suppliers (company_id, ${entries.map(([column]) => column).join(', ')})
         VALUES ($1, ${entries.map((_, index) => `$${index + 2}`).join(', ')}) RETURNING *`,
        [request.company.company_id, ...entries.map(([, value]) => value)],
      );
      return response.status(201).json({ supplier: result.rows[0] });
    } catch (error) { return handleError(error, response, 'cadastrar'); }
  });

  router.patch('/:id', async (request, response) => {
    const parsed = parseSupplier(request.body, { partial: true });
    if (parsed.error) return response.status(400).json({ error: { code: 'INVALID_SUPPLIER', message: parsed.error } });
    const entries = Object.entries(parsed.value);
    try {
      const result = await pool.query(
        `UPDATE public.suppliers SET ${entries.map(([column], index) => `${column} = $${index + 3}`).join(', ')}, updated_at = now()
         WHERE id = $1 AND company_id = $2 RETURNING *`,
        [request.params.id, request.company.company_id, ...entries.map(([, value]) => value)],
      );
      if (!result.rowCount) return response.status(404).json({ error: { code: 'SUPPLIER_NOT_FOUND', message: 'Fornecedor não encontrado.' } });
      return response.json({ supplier: result.rows[0] });
    } catch (error) { return handleError(error, response, 'atualizar'); }
  });

  router.patch('/:id/restore', async (request, response) => {
    if (request.company.role !== 'owner') return response.status(403).json({ error: { code: 'OWNER_REQUIRED', message: 'Somente o responsável da empresa pode restaurar fornecedores.' } });
    try {
      const result = await pool.query(
        'UPDATE public.suppliers SET archived_at = NULL, updated_at = now() WHERE id = $1 AND company_id = $2 AND archived_at IS NOT NULL RETURNING id',
        [request.params.id, request.company.company_id],
      );
      if (!result.rowCount) return response.status(404).json({ error: { code: 'SUPPLIER_NOT_FOUND', message: 'Fornecedor arquivado não encontrado.' } });
      return response.json({ restored: true, id: result.rows[0].id });
    } catch (error) {
      if (error.code === '23505') return response.status(409).json({ error: { code: 'SUPPLIER_DOCUMENT_EXISTS', message: 'Já existe outro fornecedor ativo com esse CPF ou CNPJ.' } });
      return handleError(error, response, 'restaurar');
    }
  });

  router.delete('/:id', async (request, response) => {
    if (request.company.role !== 'owner') return response.status(403).json({ error: { code: 'OWNER_REQUIRED', message: 'Somente o responsável da empresa pode excluir fornecedores permanentemente.' } });
    try {
      const result = await pool.query('DELETE FROM public.suppliers WHERE id = $1 AND company_id = $2 RETURNING id', [request.params.id, request.company.company_id]);
      if (!result.rowCount) return response.status(404).json({ error: { code: 'SUPPLIER_NOT_FOUND', message: 'Fornecedor não encontrado.' } });
      return response.json({ deleted: true, id: result.rows[0].id });
    } catch (error) { return handleError(error, response, 'excluir'); }
  });

  return router;
}
