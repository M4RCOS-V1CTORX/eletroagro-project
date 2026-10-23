import { Router } from 'express';
import { requireAreaPermission, requireCompanyMembership } from '../middleware/neon-auth.js';

const statuses = new Set(['draft', 'sent', 'approved', 'rejected', 'expired', 'cancelled']);
const transitions = {
  draft: new Set(['sent', 'cancelled']),
  sent: new Set(['approved', 'rejected', 'expired', 'cancelled']),
  approved: new Set(['cancelled']),
  rejected: new Set(), expired: new Set(), cancelled: new Set(),
};
const maxCents = 999_999_999_999n;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRealDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function decimalUnits(raw, decimals, { allowZero = true } = {}) {
  const value = String(raw ?? '');
  const pattern = decimals === 2 ? /^\d{1,10}(?:\.\d{1,2})?$/ : /^\d{1,9}(?:\.\d{1,3})?$/;
  if (!pattern.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const units = BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0');
  const maximum = decimals === 3 ? 999_999_999_999n : maxCents;
  if ((!allowZero && units <= 0n) || units > maximum) return null;
  return units;
}

function moneyText(cents) {
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}

function quantityText(millis) {
  const whole = millis / 1000n;
  const fraction = String(millis % 1000n).padStart(3, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function lineTotalCents(priceCents, quantityMillis) {
  return (priceCents * quantityMillis + 500n) / 1000n;
}

function parseQuoteItems(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 100) return { error: 'Adicione de 1 a 100 itens ao orçamento.' };
  const requested = [];
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return { error: 'Um dos itens do orçamento é inválido.' };
    const catalogItemId = typeof item.catalogItemId === 'string' && uuidPattern.test(item.catalogItemId) ? item.catalogItemId : null;
    const customName = typeof item.name === 'string' ? item.name.trim() : '';
    const itemType = item.itemType;
    const unit = typeof item.unit === 'string' ? item.unit.trim() : '';
    const description = typeof item.description === 'string' ? item.description.trim() : '';
    if (!catalogItemId && (customName.length < 2 || customName.length > 180 || !['product', 'service'].includes(itemType) || !unit || unit.length > 20 || description.length > 3000)) {
      return { error: 'Informe nome, tipo e unidade válidos para o item personalizado.' };
    }
    const quantityMillis = decimalUnits(item.quantity, 3, { allowZero: false });
    const unitPriceCents = decimalUnits(item.unitPrice, 2);
    if (quantityMillis === null || unitPriceCents === null) return { error: 'Confira as quantidades e os preços dos itens.' };
    requested.push({ catalogItemId, customName, itemType, unit, description, quantityMillis, unitPriceCents });
  }
  return { value: requested };
}

function calculateQuoteItems(requestedItems, catalog) {
  return requestedItems.map((requested, index) => {
    const source = requested.catalogItemId
      ? catalog.get(requested.catalogItemId)
      : { id: null, item_type: requested.itemType, name: requested.customName, unit: requested.unit, description: requested.description || null };
    const totalCents = lineTotalCents(requested.unitPriceCents, requested.quantityMillis);
    return {
      ...source,
      position: index + 1,
      quantity: quantityText(requested.quantityMillis),
      unitPrice: moneyText(requested.unitPriceCents),
      lineTotal: moneyText(totalCents),
      totalCents,
    };
  });
}

function errorResponse(error, response, action) {
  console.error(`Falha ao ${action} orçamento:`, error.message);
  return response.status(500).json({ error: { code: 'QUOTE_OPERATION_FAILED', message: `Não foi possível ${action} o orçamento.` } });
}

export function createQuotesRouter({ pool, requireAuth, requireDatabase }) {
  const router = Router();
  router.use(requireAuth, requireDatabase(pool), requireCompanyMembership(pool), requireAreaPermission('commercial'));
  router.param('id', (request, response, next, id) => {
    if (!uuidPattern.test(id)) return response.status(400).json({ error: { code: 'INVALID_QUOTE_ID', message: 'Identificador de orçamento inválido.' } });
    return next();
  });

  router.get('/', async (request, response) => {
    const query = typeof request.query.q === 'string' ? request.query.q.trim().slice(0, 120) : '';
    const status = request.query.status === 'all' || statuses.has(request.query.status) ? request.query.status : 'all';
    const limit = Math.min(Math.max(Number.parseInt(request.query.limit, 10) || 25, 1), 100);
    const offset = Math.max(Number.parseInt(request.query.offset, 10) || 0, 0);
    try {
      const result = await pool.query(
        `SELECT id, quote_number, customer_name, status, issued_at, valid_until,
                subtotal, discount_amount, total, count(*) OVER()::int AS total_count
         FROM public.quotes
         WHERE company_id = $1 AND archived_at IS NULL
           AND ($2 = 'all' OR status = $2)
           AND ($3 = '' OR customer_name ILIKE '%' || $3 || '%'
             OR quote_number::text ILIKE '%' || $3 || '%')
         ORDER BY issued_at DESC, quote_number DESC
         LIMIT $4 OFFSET $5`,
        [request.company.company_id, status, query, limit, offset],
      );
      return response.json({
        quotes: result.rows.map(({ total_count, ...quote }) => quote),
        pagination: { limit, offset, total: result.rowCount ? result.rows[0].total_count : 0 },
      });
    } catch (error) { return errorResponse(error, response, 'listar'); }
  });

  router.get('/summary', async (request, response) => {
    try {
      const result = await pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'draft' AND archived_at IS NULL)::int AS draft_count,
           COUNT(*) FILTER (WHERE status = 'sent' AND archived_at IS NULL)::int AS sent_count,
           COALESCE(SUM(total) FILTER (WHERE status = 'sent' AND archived_at IS NULL), 0)::text AS sent_total,
           COUNT(*) FILTER (WHERE status = 'approved' AND archived_at IS NULL)::int AS approved_count,
           COALESCE(SUM(total) FILTER (WHERE status = 'approved' AND archived_at IS NULL), 0)::text AS approved_total,
           COUNT(*) FILTER (WHERE status = 'sent' AND archived_at IS NULL
             AND valid_until BETWEEN CURRENT_DATE AND CURRENT_DATE + 7)::int AS expiring_count,
           COUNT(*) FILTER (WHERE status = 'sent' AND archived_at IS NULL
             AND valid_until < CURRENT_DATE)::int AS overdue_count
         FROM public.quotes WHERE company_id = $1`,
        [request.company.company_id],
      );
      return response.json({ summary: result.rows[0] });
    } catch (error) { return errorResponse(error, response, 'resumir'); }
  });

  router.post('/', async (request, response) => {
    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return response.status(400).json({ error: { code: 'INVALID_QUOTE', message: 'Envie os dados do orçamento em formato válido.' } });
    if (typeof body.customerId !== 'string' || !uuidPattern.test(body.customerId)) return response.status(400).json({ error: { code: 'INVALID_QUOTE_CUSTOMER', message: 'Selecione um cliente válido.' } });
    const parsedItems = parseQuoteItems(body.items);
    if (parsedItems.error) return response.status(400).json({ error: { code: 'INVALID_QUOTE_ITEMS', message: parsedItems.error } });
    const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
    const terms = typeof body.terms === 'string' ? body.terms.trim() : '';
    if (notes.length > 5000 || terms.length > 3000) return response.status(400).json({ error: { code: 'INVALID_QUOTE_TEXT', message: 'As observações ou condições excedem o limite permitido.' } });
    let validUntil = null;
    if (body.validUntil) {
      if (!isRealDate(body.validUntil)) {
        return response.status(400).json({ error: { code: 'INVALID_QUOTE_VALIDITY', message: 'Informe uma data de validade válida.' } });
      }
      validUntil = body.validUntil;
    }
    const discountCents = decimalUnits(body.discountAmount ?? '0', 2);
    if (discountCents === null) return response.status(400).json({ error: { code: 'INVALID_QUOTE_DISCOUNT', message: 'Informe um desconto válido com até duas casas decimais.' } });

    const requestedItems = parsedItems.value;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const customerResult = await client.query(
        `SELECT id, name, tax_identifier, phone FROM public.customers
         WHERE id = $1 AND company_id = $2 AND archived_at IS NULL FOR SHARE`,
        [body.customerId, request.company.company_id],
      );
      if (!customerResult.rowCount) {
        await client.query('ROLLBACK');
        return response.status(400).json({ error: { code: 'QUOTE_CUSTOMER_UNAVAILABLE', message: 'O cliente selecionado não está disponível.' } });
      }

      const catalogIds = [...new Set(requestedItems.map((item) => item.catalogItemId).filter(Boolean))];
      const catalogResult = catalogIds.length ? await client.query(
        `SELECT id, item_type, name, description, unit FROM public.catalog_items
         WHERE company_id = $1 AND id = ANY($2::uuid[]) AND archived_at IS NULL AND is_active`,
        [request.company.company_id, catalogIds],
      ) : { rows: [] };
      const catalog = new Map(catalogResult.rows.map((item) => [item.id, item]));
      if (catalog.size !== catalogIds.length) {
        await client.query('ROLLBACK');
        return response.status(400).json({ error: { code: 'QUOTE_ITEM_UNAVAILABLE', message: 'Um produto ou serviço foi desativado. Atualize o catálogo e tente novamente.' } });
      }

      const calculated = calculateQuoteItems(requestedItems, catalog);
      const subtotalCents = calculated.reduce((sum, item) => sum + item.totalCents, 0n);
      if (subtotalCents > maxCents || discountCents > subtotalCents) {
        await client.query('ROLLBACK');
        return response.status(400).json({ error: { code: 'INVALID_QUOTE_TOTAL', message: 'O desconto não pode superar o subtotal e o total deve caber no limite monetário.' } });
      }
      const totalCents = subtotalCents - discountCents;

      const counter = await client.query(
        `INSERT INTO public.document_counters (company_id, document_type, last_number)
         VALUES ($1, 'quote', 1)
         ON CONFLICT (company_id, document_type)
         DO UPDATE SET last_number = public.document_counters.last_number + 1
         RETURNING last_number`,
        [request.company.company_id],
      );
      const customer = customerResult.rows[0];
      const quoteResult = await client.query(
        `INSERT INTO public.quotes (
          company_id, quote_number, customer_id, customer_name, customer_tax_identifier,
          customer_phone, valid_until, subtotal, discount_amount, total, notes, terms, created_by_subject
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING id, quote_number, status, issued_at, valid_until, subtotal, discount_amount, total`,
        [request.company.company_id, counter.rows[0].last_number, customer.id, customer.name,
          customer.tax_identifier, customer.phone, validUntil, moneyText(subtotalCents),
          moneyText(discountCents), moneyText(totalCents), notes || null, terms || null, request.auth.subject],
      );
      const quote = quoteResult.rows[0];
      for (const item of calculated) {
        await client.query(
          `INSERT INTO public.quote_items (
            company_id, quote_id, position, catalog_item_id, item_type, name, description,
            unit, quantity, unit_price, line_total
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [request.company.company_id, quote.id, item.position, item.id, item.item_type,
            item.name, item.description, item.unit, item.quantity, item.unitPrice, item.lineTotal],
        );
      }
      await client.query(
        `INSERT INTO public.quote_status_history (company_id, quote_id, previous_status, new_status, reason, actor_subject)
         VALUES ($1, $2, NULL, 'draft', 'Orçamento criado', $3)`,
        [request.company.company_id, quote.id, request.auth.subject],
      );
      await client.query('COMMIT');
      return response.status(201).json({ quote: { ...quote, customer_name: customer.name, items: calculated.map(({ id, item_type, name, description, unit, quantity, unitPrice, lineTotal, position }) => ({ catalog_item_id: id, item_type, name, description, unit, quantity, unit_price: unitPrice, line_total: lineTotal, position })) } });
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* connection may already be closed */ }
      return errorResponse(error, response, 'criar');
    } finally { client.release(); }
  });

  router.patch('/:id', async (request, response) => {
    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return response.status(400).json({ error: { code: 'INVALID_QUOTE', message: 'Envie os dados do orçamento em formato válido.' } });
    if (typeof body.customerId !== 'string' || !uuidPattern.test(body.customerId)) return response.status(400).json({ error: { code: 'INVALID_QUOTE_CUSTOMER', message: 'Selecione um cliente válido.' } });
    const parsedItems = parseQuoteItems(body.items);
    if (parsedItems.error) return response.status(400).json({ error: { code: 'INVALID_QUOTE_ITEMS', message: parsedItems.error } });
    const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
    const terms = typeof body.terms === 'string' ? body.terms.trim() : '';
    if (notes.length > 5000 || terms.length > 3000) return response.status(400).json({ error: { code: 'INVALID_QUOTE_TEXT', message: 'As observações ou condições excedem o limite permitido.' } });
    let validUntil = null;
    if (body.validUntil) {
      if (!isRealDate(body.validUntil)) return response.status(400).json({ error: { code: 'INVALID_QUOTE_VALIDITY', message: 'Informe uma data de validade válida.' } });
      validUntil = body.validUntil;
    }
    const discountCents = decimalUnits(body.discountAmount ?? '0', 2);
    if (discountCents === null) return response.status(400).json({ error: { code: 'INVALID_QUOTE_DISCOUNT', message: 'Informe um desconto válido com até duas casas decimais.' } });
    const requestedItems = parsedItems.value;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const currentResult = await client.query(
        'SELECT * FROM public.quotes WHERE id = $1 AND company_id = $2 AND archived_at IS NULL FOR UPDATE',
        [request.params.id, request.company.company_id],
      );
      if (!currentResult.rowCount) {
        await client.query('ROLLBACK');
        return response.status(404).json({ error: { code: 'QUOTE_NOT_FOUND', message: 'Orçamento não encontrado.' } });
      }
      const current = currentResult.rows[0];
      const previousItems = await client.query(
        `SELECT position, catalog_item_id, item_type, name, description, unit, quantity, unit_price, line_total
         FROM public.quote_items WHERE company_id = $1 AND quote_id = $2 ORDER BY position`,
        [request.company.company_id, current.id],
      );
      const customerResult = await client.query(
        `SELECT id, name, tax_identifier, phone FROM public.customers
         WHERE id = $1 AND company_id = $2 AND archived_at IS NULL FOR SHARE`,
        [body.customerId, request.company.company_id],
      );
      if (!customerResult.rowCount) {
        await client.query('ROLLBACK');
        return response.status(400).json({ error: { code: 'QUOTE_CUSTOMER_UNAVAILABLE', message: 'O cliente selecionado não está disponível.' } });
      }
      const catalogIds = [...new Set(requestedItems.map((item) => item.catalogItemId).filter(Boolean))];
      const catalogResult = catalogIds.length ? await client.query(
        `SELECT id, item_type, name, description, unit FROM public.catalog_items
         WHERE company_id = $1 AND id = ANY($2::uuid[]) AND archived_at IS NULL AND is_active`,
        [request.company.company_id, catalogIds],
      ) : { rows: [] };
      const catalog = new Map(catalogResult.rows.map((item) => [item.id, item]));
      if (catalog.size !== catalogIds.length) {
        await client.query('ROLLBACK');
        return response.status(400).json({ error: { code: 'QUOTE_ITEM_UNAVAILABLE', message: 'Um produto ou serviço foi desativado. Atualize o catálogo e tente novamente.' } });
      }
      const calculated = calculateQuoteItems(requestedItems, catalog);
      const subtotalCents = calculated.reduce((sum, item) => sum + item.totalCents, 0n);
      if (subtotalCents > maxCents || discountCents > subtotalCents) {
        await client.query('ROLLBACK');
        return response.status(400).json({ error: { code: 'INVALID_QUOTE_TOTAL', message: 'O desconto não pode superar o subtotal e o total deve caber no limite monetário.' } });
      }
      const customer = customerResult.rows[0];
      const versionResult = await client.query(
        'SELECT COALESCE(MAX(version_number), 0)::int + 1 AS next_version FROM public.quote_versions WHERE company_id = $1 AND quote_id = $2',
        [request.company.company_id, current.id],
      );
      await client.query(
        `INSERT INTO public.quote_versions (company_id, quote_id, version_number, snapshot, actor_subject)
         VALUES ($1, $2, $3, $4::jsonb, $5)`,
        [request.company.company_id, current.id, versionResult.rows[0].next_version,
          JSON.stringify({ ...current, items: previousItems.rows }), request.auth.subject],
      );
      await client.query(
        `UPDATE public.quotes SET customer_id = $3, customer_name = $4, customer_tax_identifier = $5,
           customer_phone = $6, valid_until = $7, subtotal = $8, discount_amount = $9, total = $10,
           notes = $11, terms = $12, status = 'draft', sent_at = NULL, approved_at = NULL, updated_at = now()
         WHERE id = $1 AND company_id = $2`,
        [current.id, request.company.company_id, customer.id, customer.name, customer.tax_identifier, customer.phone,
          validUntil, moneyText(subtotalCents), moneyText(discountCents), moneyText(subtotalCents - discountCents),
          notes || null, terms || null],
      );
      await client.query('DELETE FROM public.quote_items WHERE company_id = $1 AND quote_id = $2', [request.company.company_id, current.id]);
      for (const item of calculated) {
        await client.query(
          `INSERT INTO public.quote_items (company_id, quote_id, position, catalog_item_id, item_type, name, description, unit, quantity, unit_price, line_total)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [request.company.company_id, current.id, item.position, item.id, item.item_type, item.name,
            item.description, item.unit, item.quantity, item.unitPrice, item.lineTotal],
        );
      }
      if (current.status !== 'draft') {
        await client.query(
          `INSERT INTO public.quote_status_history (company_id, quote_id, previous_status, new_status, reason, actor_subject)
           VALUES ($1, $2, $3, 'draft', 'Orçamento editado; requer novo envio e aprovação', $4)`,
          [request.company.company_id, current.id, current.status, request.auth.subject],
        );
      }
      await client.query('COMMIT');
      return response.json({ quote: { id: current.id, quote_number: current.quote_number, customer_name: customer.name, status: 'draft', valid_until: validUntil, subtotal: moneyText(subtotalCents), discount_amount: moneyText(discountCents), total: moneyText(subtotalCents - discountCents) } });
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* connection may already be closed */ }
      return errorResponse(error, response, 'atualizar');
    } finally { client.release(); }
  });

  router.get('/:id', async (request, response) => {
    try {
      const result = await pool.query(
        `SELECT q.*, qi.id AS line_id, qi.position, qi.catalog_item_id, qi.item_type,
                qi.name AS item_name, qi.description AS item_description, qi.unit,
                qi.quantity, qi.unit_price, qi.line_total
         FROM public.quotes q
         LEFT JOIN public.quote_items qi ON qi.company_id = q.company_id AND qi.quote_id = q.id
         WHERE q.id = $1 AND q.company_id = $2 AND q.archived_at IS NULL
         ORDER BY qi.position`,
        [request.params.id, request.company.company_id],
      );
      if (!result.rowCount) return response.status(404).json({ error: { code: 'QUOTE_NOT_FOUND', message: 'Orçamento não encontrado.' } });
      const first = result.rows[0];
      const { line_id, position, catalog_item_id, item_type, item_name, item_description, unit, quantity, unit_price, line_total, ...quote } = first;
      const history = await pool.query(
        `SELECT previous_status, new_status, reason, created_at
         FROM public.quote_status_history WHERE company_id = $1 AND quote_id = $2
         ORDER BY created_at DESC`,
        [request.company.company_id, request.params.id],
      );
      const versions = await pool.query(
        `SELECT version_number, reason, created_at FROM public.quote_versions
         WHERE company_id = $1 AND quote_id = $2 ORDER BY version_number DESC`,
        [request.company.company_id, request.params.id],
      );
      return response.json({ quote: { ...quote, items: result.rows.filter((row) => row.line_id).map((row) => ({ id: row.line_id, position: row.position, catalog_item_id: row.catalog_item_id, item_type: row.item_type, name: row.item_name, description: row.item_description, unit: row.unit, quantity: row.quantity, unit_price: row.unit_price, line_total: row.line_total })), status_history: history.rows, versions: versions.rows } });
    } catch (error) { return errorResponse(error, response, 'consultar'); }
  });

  router.delete('/:id', async (request, response) => {
    if (request.company.role !== 'owner') return response.status(403).json({ error: { code: 'OWNER_REQUIRED', message: 'Somente o responsável da empresa pode excluir orçamentos permanentemente.' } });
    const confirmation = typeof request.body?.confirmation === 'string' ? request.body.confirmation.trim() : '';
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const quote = await client.query(
        'SELECT quote_number FROM public.quotes WHERE id = $1 AND company_id = $2 AND archived_at IS NULL FOR UPDATE',
        [request.params.id, request.company.company_id],
      );
      if (!quote.rowCount) {
        await client.query('ROLLBACK');
        return response.status(404).json({ error: { code: 'QUOTE_NOT_FOUND', message: 'Orçamento não encontrado.' } });
      }
      if (confirmation !== String(quote.rows[0].quote_number)) {
        await client.query('ROLLBACK');
        return response.status(400).json({ error: { code: 'QUOTE_CONFIRMATION_REQUIRED', message: `Digite o número ${quote.rows[0].quote_number} para confirmar a exclusão.` } });
      }
      const values = [request.company.company_id, request.params.id];
      await client.query('DELETE FROM public.quote_versions WHERE company_id = $1 AND quote_id = $2', values);
      await client.query('DELETE FROM public.quote_status_history WHERE company_id = $1 AND quote_id = $2', values);
      await client.query('DELETE FROM public.quote_items WHERE company_id = $1 AND quote_id = $2', values);
      await client.query('DELETE FROM public.quotes WHERE company_id = $1 AND id = $2', values);
      await client.query('COMMIT');
      return response.json({ deleted: true, id: request.params.id });
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* connection may already be closed */ }
      return errorResponse(error, response, 'excluir');
    } finally { client.release(); }
  });

  router.patch('/:id/status', async (request, response) => {
    const nextStatus = request.body?.status;
    if (!statuses.has(nextStatus)) return response.status(400).json({ error: { code: 'INVALID_QUOTE_STATUS', message: 'Status de orçamento inválido.' } });
    const reason = typeof request.body?.reason === 'string' ? request.body.reason.trim() : '';
    if (reason.length > 1000 || (nextStatus === 'cancelled' && !reason)) return response.status(400).json({ error: { code: 'INVALID_QUOTE_STATUS_REASON', message: 'Informe o motivo do cancelamento (até 1.000 caracteres).' } });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query(
        'SELECT status FROM public.quotes WHERE id = $1 AND company_id = $2 AND archived_at IS NULL FOR UPDATE',
        [request.params.id, request.company.company_id],
      );
      if (!current.rowCount) {
        await client.query('ROLLBACK');
        return response.status(404).json({ error: { code: 'QUOTE_NOT_FOUND', message: 'Orçamento não encontrado.' } });
      }
      const previous = current.rows[0].status;
      if (previous === nextStatus) {
        await client.query('COMMIT');
        return response.json({ status: nextStatus });
      }
      if (!transitions[previous].has(nextStatus)) {
        await client.query('ROLLBACK');
        return response.status(409).json({ error: { code: 'INVALID_QUOTE_TRANSITION', message: 'Essa mudança de status não é permitida.' } });
      }
      const result = await client.query(
        `UPDATE public.quotes SET status = $3, updated_at = now(),
           sent_at = CASE WHEN $3 = 'sent' THEN now() ELSE sent_at END,
           approved_at = CASE WHEN $3 = 'approved' THEN now() ELSE approved_at END
        WHERE id = $1 AND company_id = $2 AND status = $4 AND archived_at IS NULL
         RETURNING status, sent_at, approved_at, updated_at`,
        [request.params.id, request.company.company_id, nextStatus, previous],
      );
      if (!result.rowCount) {
        await client.query('ROLLBACK');
        return response.status(409).json({ error: { code: 'QUOTE_CHANGED', message: 'O orçamento foi alterado em outra sessão. Atualize a lista.' } });
      }
      await client.query(
        `INSERT INTO public.quote_status_history (company_id, quote_id, previous_status, new_status, reason, actor_subject)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [request.company.company_id, request.params.id, previous, nextStatus, reason || null, request.auth.subject],
      );
      await client.query('COMMIT');
      return response.json({ ...result.rows[0] });
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* connection may already be closed */ }
      return errorResponse(error, response, 'atualizar');
    } finally { client.release(); }
  });

  return router;
}
