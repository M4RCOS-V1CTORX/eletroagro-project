import { Router } from 'express';
import { requireCompanyMembership } from '../middleware/neon-auth.js';

const fields = {
  name: { column: 'name', max: 200, required: true },
  customerType: { column: 'customer_type', max: 20, values: ['individual', 'business', 'other'] },
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
};

function normalizeCustomerInput(input, { partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Envie os dados do cliente em formato válido.' };
  }
  const output = {};
  for (const [key, rule] of Object.entries(fields)) {
    if (!Object.hasOwn(input, key)) continue;
    const raw = input[key];
    if (raw !== null && typeof raw !== 'string') return { error: `O campo ${key} deve ser texto.` };
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (rule.required && !value) return { error: 'Informe o nome ou a razão social do cliente.' };
    if (rule.required && value.length < 2) return { error: 'O nome do cliente deve ter pelo menos 2 caracteres.' };
    if (value.length > rule.max) return { error: `O campo ${key} excede o limite de ${rule.max} caracteres.` };
    if (rule.values && value && !rule.values.includes(value)) return { error: 'Tipo de cliente inválido.' };
    if (rule.email && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { error: 'Informe um e-mail válido.' };
    if (rule.state && value && !/^[a-z]{2}$/i.test(value)) return { error: 'Informe a sigla do estado com duas letras.' };
    output[rule.column] = value ? (rule.state ? value.toUpperCase() : value) : null;
  }
  if (!partial && !Object.hasOwn(output, 'name')) return { error: 'Informe o nome ou a razão social do cliente.' };
  if (partial && Object.keys(output).length === 0) return { error: 'Informe ao menos um campo para atualizar.' };
  return { value: output };
}

function handleCustomerError(error, response, action) {
  if (error.code === '23505') {
    return response.status(409).json({ error: { code: 'CUSTOMER_DOCUMENT_EXISTS', message: 'Já existe um cliente ativo com esse CPF ou CNPJ.' } });
  }
  console.error(`Falha ao ${action} cliente:`, error.message);
  return response.status(500).json({ error: { code: 'CUSTOMER_OPERATION_FAILED', message: `Não foi possível ${action} o cliente.` } });
}

export function createCustomersRouter({ pool, requireAuth, requireDatabase }) {
  const router = Router();
  router.use(requireAuth, requireDatabase(pool), requireCompanyMembership(pool));
  router.param('id', (request, response, next, id) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      return response.status(400).json({ error: { code: 'INVALID_CUSTOMER_ID', message: 'Identificador de cliente inválido.' } });
    }
    return next();
  });

  router.get('/', async (request, response) => {
    const query = typeof request.query.q === 'string' ? request.query.q.trim().slice(0, 120) : '';
    const limit = Math.min(Math.max(Number.parseInt(request.query.limit, 10) || 25, 1), 100);
    const offset = Math.max(Number.parseInt(request.query.offset, 10) || 0, 0);
    const status = ['active', 'archived', 'all'].includes(request.query.status) ? request.query.status : 'active';
    const order = ['asc', 'oldest'].includes(request.query.order) ? 'ASC' : 'DESC';
    const sort = request.query.sort === 'created' ? `created_at ${order}, id ${order}` : `lower(name) ${order}, id ${order}`;
    try {
      const result = await pool.query(
        `SELECT id, name, customer_type, tax_identifier, phone, email, postal_code,
                street, street_number, address_complement, neighborhood, city, state,
                notes, created_at, updated_at, archived_at, count(*) OVER()::int AS total_count
         FROM public.customers
         WHERE company_id = $1
           AND ($5 = 'all' OR ($5 = 'active' AND archived_at IS NULL) OR ($5 = 'archived' AND archived_at IS NOT NULL))
           AND ($2 = '' OR name ILIKE '%' || $2 || '%'
             OR COALESCE(tax_identifier, '') ILIKE '%' || $2 || '%'
             OR COALESCE(phone, '') ILIKE '%' || $2 || '%')
         ORDER BY ${sort}
         LIMIT $3 OFFSET $4`,
        [request.company.company_id, query, limit, offset, status],
      );
      return response.json({
        customers: result.rows.map(({ total_count, ...customer }) => customer),
        pagination: { limit, offset, total: result.rowCount ? result.rows[0].total_count : 0 },
      });
    } catch (error) {
      return handleCustomerError(error, response, 'listar');
    }
  });

  router.post('/', async (request, response) => {
    const parsed = normalizeCustomerInput(request.body);
    if (parsed.error) return response.status(400).json({ error: { code: 'INVALID_CUSTOMER', message: parsed.error } });
    const entries = Object.entries(parsed.value);
    const columns = entries.map(([column]) => column);
    const values = entries.map(([, value]) => value);
    const placeholders = values.map((_, index) => `$${index + 2}`);
    try {
      const result = await pool.query(
        `INSERT INTO public.customers (company_id, ${columns.join(', ')})
         VALUES ($1, ${placeholders.join(', ')}) RETURNING *`,
        [request.company.company_id, ...values],
      );
      return response.status(201).json({ customer: result.rows[0] });
    } catch (error) {
      return handleCustomerError(error, response, 'cadastrar');
    }
  });

  router.get('/:id', async (request, response) => {
    try {
      const result = await pool.query(
        `SELECT id, name, customer_type, tax_identifier, phone, email, postal_code,
                street, street_number, address_complement, neighborhood, city, state,
                notes, created_at, updated_at, archived_at
         FROM public.customers
         WHERE id = $1 AND company_id = $2`,
        [request.params.id, request.company.company_id],
      );
      if (!result.rowCount) return response.status(404).json({ error: { code: 'CUSTOMER_NOT_FOUND', message: 'Cliente não encontrado.' } });
      return response.json({ customer: result.rows[0] });
    } catch (error) {
      return handleCustomerError(error, response, 'consultar');
    }
  });

  router.patch('/:id', async (request, response) => {
    const parsed = normalizeCustomerInput(request.body, { partial: true });
    if (parsed.error) return response.status(400).json({ error: { code: 'INVALID_CUSTOMER', message: parsed.error } });
    const entries = Object.entries(parsed.value);
    const assignments = entries.map(([column], index) => `${column} = $${index + 3}`);
    const values = entries.map(([, value]) => value);
    try {
      const result = await pool.query(
        `UPDATE public.customers SET ${assignments.join(', ')}, updated_at = now()
         WHERE id = $1 AND company_id = $2
         RETURNING *`,
        [request.params.id, request.company.company_id, ...values],
      );
      if (!result.rowCount) return response.status(404).json({ error: { code: 'CUSTOMER_NOT_FOUND', message: 'Cliente não encontrado.' } });
      return response.json({ customer: result.rows[0] });
    } catch (error) {
      return handleCustomerError(error, response, 'atualizar');
    }
  });

  router.patch('/:id/restore', async (request, response) => {
    if (request.company.role !== 'owner') return response.status(403).json({ error: { code: 'OWNER_REQUIRED', message: 'Somente o responsável da empresa pode restaurar clientes.' } });
    try {
      const result = await pool.query(
        `UPDATE public.customers SET archived_at = NULL, updated_at = now()
         WHERE id = $1 AND company_id = $2 AND archived_at IS NOT NULL RETURNING id`,
        [request.params.id, request.company.company_id],
      );
      if (!result.rowCount) return response.status(404).json({ error: { code: 'CUSTOMER_NOT_FOUND', message: 'Cliente arquivado não encontrado.' } });
      return response.json({ restored: true, id: result.rows[0].id });
    } catch (error) {
      if (error.code === '23505') return response.status(409).json({ error: { code: 'CUSTOMER_DOCUMENT_EXISTS', message: 'Não foi possível restaurar: já existe um cliente ativo com esse CPF ou CNPJ.' } });
      return handleCustomerError(error, response, 'restaurar');
    }
  });

  router.delete('/:id', async (request, response) => {
    if (request.company.role !== 'owner') return response.status(403).json({ error: { code: 'OWNER_REQUIRED', message: 'Somente o responsável da empresa pode excluir clientes permanentemente.' } });
    try {
      const result = await pool.query(
        `DELETE FROM public.customers
         WHERE id = $1 AND company_id = $2
         RETURNING id`,
        [request.params.id, request.company.company_id],
      );
      if (!result.rowCount) return response.status(404).json({ error: { code: 'CUSTOMER_NOT_FOUND', message: 'Cliente não encontrado.' } });
      return response.json({ deleted: true, id: result.rows[0].id });
    } catch (error) {
      return handleCustomerError(error, response, 'excluir');
    }
  });

  return router;
}
