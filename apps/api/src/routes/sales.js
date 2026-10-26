import { Router } from 'express';
import { activities, parseSaleExtras, dueDateFromTerm } from '../lib/commercial.js';
import { idempotencyGuard, requireAreaPermission, requireCompanyMembership } from '../middleware/neon-auth.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const paymentMethods = new Set(['pix', 'cash', 'card_debit', 'card_credit', 'transfer', 'boleto', 'other']);
const saleStatuses = new Set(['completed', 'cancelled']);
const maxCents = 999_999_999_999n;

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

function moneyText(cents) { return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`; }
function lineTotalCents(priceCents, quantityMillis) { return (priceCents * quantityMillis + 500n) / 1000n; }
function quantityText(millis) {
  const whole = millis / 1000n;
  const fraction = String(millis % 1000n).padStart(3, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function realDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function parseItems(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 100) return { error: 'Adicione de 1 a 100 itens à venda.' };
  const parsed = [];
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return { error: 'Um dos itens da venda é inválido.' };
    const catalogItemId = typeof item.catalogItemId === 'string' && uuidPattern.test(item.catalogItemId) ? item.catalogItemId : null;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const itemType = item.itemType;
    const unit = typeof item.unit === 'string' ? item.unit.trim() : '';
    const description = typeof item.description === 'string' ? item.description.trim() : '';
    if (!catalogItemId && (name.length < 2 || name.length > 180 || !['product', 'service'].includes(itemType) || !unit || unit.length > 20 || description.length > 3000)) {
      return { error: 'Informe nome, tipo e unidade válidos para o item personalizado.' };
    }
    const quantity = decimalUnits(item.quantity, 3, { allowZero: false });
    const unitPrice = decimalUnits(item.unitPrice, 2);
    if (quantity === null || unitPrice === null) return { error: 'Confira as quantidades e os preços dos itens.' };
    parsed.push({ catalogItemId, name, itemType, unit, description, quantity, unitPrice });
  }
  return { value: parsed };
}

function saleError(error, response, action) {
  if (error.code === '23505' && error.constraint === 'sales_company_quote_uq') {
    return response.status(409).json({ error: { code: 'QUOTE_ALREADY_CONVERTED', message: 'Este orçamento já foi convertido em venda.' } });
  }
  console.error(`Falha ao ${action} venda:`, error.message);
  return response.status(500).json({ error: { code: 'SALE_OPERATION_FAILED', message: `Não foi possível ${action} a venda.` } });
}

export function createSalesRouter({ pool, requireAuth, requireDatabase }) {
  const router = Router();
  router.use(requireAuth, requireDatabase(pool), requireCompanyMembership(pool), requireAreaPermission('commercial'), idempotencyGuard(pool));
  router.param('id', (request, response, next, id) => {
    if (!uuidPattern.test(id)) return response.status(400).json({ error: { code: 'INVALID_SALE_ID', message: 'Identificador de venda inválido.' } });
    return next();
  });

  router.get('/transport-profiles', async (request, response) => {
    try {
      const result = await pool.query('SELECT id,vehicle,plate,driver FROM public.transport_profiles WHERE company_id=$1 ORDER BY vehicle,driver', [request.company.company_id]);
      return response.json({ profiles: result.rows });
    } catch (error) { return saleError(error,response,'listar transportes'); }
  });
  router.post('/transport-profiles', async (request,response) => {
    const parsed = parseSaleExtras(request.body || {});
    if (parsed.error || parsed.value.vehicle.length < 2) return response.status(400).json({error:{message:parsed.error || 'Informe o veículo com pelo menos 2 caracteres.'}});
    const {vehicle,plate,driver} = parsed.value;
    try {
      const result = await pool.query('INSERT INTO public.transport_profiles(company_id,vehicle,plate,driver) VALUES($1,$2,$3,$4) ON CONFLICT(company_id,vehicle,plate,driver) DO UPDATE SET vehicle=EXCLUDED.vehicle RETURNING id,vehicle,plate,driver',[request.company.company_id,vehicle,plate,driver]);
      return response.status(201).json({profile:result.rows[0]});
    } catch(error) { return saleError(error,response,'salvar transporte'); }
  });
  router.delete('/transport-profiles/:id', async (request,response) => {
    try { await pool.query('DELETE FROM public.transport_profiles WHERE company_id=$1 AND id=$2',[request.company.company_id,request.params.id]); return response.sendStatus(204); }
    catch(error) { return saleError(error,response,'remover transporte'); }
  });
  router.get('/customer-statement/:id', async (request,response) => {
    try {
      const customer=await pool.query('SELECT id,name,payment_term_days FROM public.customers WHERE company_id=$1 AND id=$2',[request.company.company_id,request.params.id]);
      if(!customer.rowCount) return response.status(404).json({error:{message:'Cliente não encontrado.'}});
      const summary=await pool.query(
        `SELECT COUNT(*)::int AS count,COALESCE(SUM(total),0)::text AS total,COALESCE(SUM(amount_paid),0)::text AS paid,
        COALESCE(SUM(total-amount_paid),0)::text AS balance,
        COALESCE(SUM(total-amount_paid) FILTER(WHERE due_date<CURRENT_DATE),0)::text AS overdue
        FROM public.sales WHERE company_id=$1 AND customer_id=$2 AND status='completed'`,[request.company.company_id,request.params.id]);
      const offset=Math.max(0,Number.parseInt(request.query.offset,10)||0);
      const sales=await pool.query(`SELECT id,sale_number,sale_year,sale_date,due_date,total,amount_paid,status,COUNT(*) OVER()::int AS total_count
        FROM public.sales WHERE company_id=$1 AND customer_id=$2 ORDER BY sale_date DESC,created_at DESC LIMIT 50 OFFSET $3`,[request.company.company_id,request.params.id,offset]);
      return response.json({customer:customer.rows[0],summary:summary.rows[0],sales:sales.rows,pagination:{offset,limit:50,total:sales.rows[0]?.total_count||0}});
    } catch(error) { return saleError(error,response,'consultar extrato do cliente'); }
  });

  router.get('/summary', async (request, response) => {
    const activity = activities.has(request.query.activity) ? request.query.activity : 'all';
    const from = realDate(request.query.from) ? request.query.from : null;
    const to = realDate(request.query.to) ? request.query.to : null;
    try {
      const result = await pool.query(
        `SELECT COUNT(*) FILTER (WHERE status = 'completed')::int AS sales_count,
                COALESCE(SUM(total) FILTER (WHERE status = 'completed'), 0)::text AS sales_total,
                COALESCE(SUM(amount_paid) FILTER (WHERE status = 'completed'), 0)::text AS received_total,
                COALESCE(SUM(total - amount_paid) FILTER (WHERE status = 'completed'), 0)::text AS outstanding_total,
                COUNT(*) FILTER (WHERE status = 'completed' AND payment_status <> 'paid')::int AS open_count,
                COALESCE(SUM(total - amount_paid) FILTER (WHERE status = 'completed' AND payment_status <> 'paid' AND due_date < CURRENT_DATE), 0)::text AS overdue_total,
                COUNT(*) FILTER (WHERE status = 'completed' AND payment_status <> 'paid' AND due_date < CURRENT_DATE)::int AS overdue_count
         FROM public.sales
         WHERE company_id = $1 AND ($4='all' OR business_activity=$4)
           AND sale_date >= COALESCE($2::date, date_trunc('month', CURRENT_DATE)::date)
           AND sale_date <= COALESCE($3::date, (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date)`,
        [request.company.company_id, from, to, activity],
      );
      return response.json({ summary: result.rows[0] });
    } catch (error) { return saleError(error, response, 'resumir'); }
  });

  router.get('/approved-quotes', async (request, response) => {
    try {
      const result = await pool.query(
        `SELECT q.id, q.quote_number, q.customer_name, q.total, q.valid_until
         FROM public.quotes q
         WHERE q.company_id = $1 AND q.status = 'approved' AND q.archived_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM public.sales s WHERE s.company_id = q.company_id AND s.quote_id = q.id)
         ORDER BY q.approved_at DESC NULLS LAST, q.quote_number DESC
         LIMIT 100`, [request.company.company_id],
      );
      return response.json({ quotes: result.rows });
    } catch (error) { return saleError(error, response, 'listar orçamentos aprovados'); }
  });

  router.get('/', async (request, response) => {
    const activity = activities.has(request.query.activity) ? request.query.activity : 'all';
    const query = typeof request.query.q === 'string' ? request.query.q.trim().slice(0, 120) : '';
    const status = request.query.status === 'all' || saleStatuses.has(request.query.status) ? request.query.status : 'all';
    const paymentStatus = ['all', 'pending', 'partial', 'paid', 'overdue'].includes(request.query.paymentStatus) ? request.query.paymentStatus : 'all';
    const from = realDate(request.query.from) ? request.query.from : null;
    const to = realDate(request.query.to) ? request.query.to : null;
    const limit = Math.min(Math.max(Number.parseInt(request.query.limit, 10) || 25, 1), 100);
    const offset = Math.max(Number.parseInt(request.query.offset, 10) || 0, 0);
    try {
      const result = await pool.query(
        `SELECT id, sale_number, sale_year, business_activity, freight_amount, freight_cost, customer_id, customer_name, quote_id, status, payment_method, payment_status,
                sale_date, due_date, subtotal, discount_amount, total, amount_paid,
                (total - amount_paid)::numeric(12,2)::text AS amount_due,
                (status = 'completed' AND payment_status <> 'paid' AND due_date < CURRENT_DATE) AS overdue,
                count(*) OVER()::int AS total_count
         FROM public.sales
         WHERE company_id = $1 AND ($2 = 'all' OR status = $2)
           AND ($3 = 'all' OR ($3 = 'overdue' AND payment_status <> 'paid' AND due_date < CURRENT_DATE) OR payment_status = $3)
           AND ($4 = '' OR customer_name ILIKE '%' || $4 || '%' OR sale_number::text ILIKE '%' || $4 || '%' OR (LPAD(sale_number::text,GREATEST(3,LENGTH(sale_number::text)),'0') || '/' || sale_year::text) ILIKE '%' || $4 || '%')
           AND ($9='all' OR business_activity=$9)
           AND ($7::date IS NULL OR sale_date >= $7) AND ($8::date IS NULL OR sale_date <= $8)
         ORDER BY sale_date DESC, sale_number DESC
         LIMIT $5 OFFSET $6`,
        [request.company.company_id, status, paymentStatus, query, limit, offset, from, to, activity],
      );
      return response.json({
        sales: result.rows.map(({ total_count, ...sale }) => sale),
        pagination: { limit, offset, total: result.rowCount ? result.rows[0].total_count : 0 },
      });
    } catch (error) { return saleError(error, response, 'listar'); }
  });

  router.post('/', async (request, response) => {
    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return response.status(400).json({ error: { code: 'INVALID_SALE', message: 'Envie os dados da venda em formato válido.' } });
    if (!paymentMethods.has(body.paymentMethod)) return response.status(400).json({ error: { code: 'INVALID_PAYMENT_METHOD', message: 'Selecione uma forma de pagamento válida.' } });
    if (body.saleDate && !realDate(body.saleDate)) return response.status(400).json({ error: { code: 'INVALID_SALE_DATE', message: 'Informe uma data de venda válida.' } });
    if (body.dueDate && !realDate(body.dueDate)) return response.status(400).json({ error: { code: 'INVALID_DUE_DATE', message: 'Informe uma data de vencimento válida.' } });
    const extraResult = parseSaleExtras(body);
    if (extraResult.error) return response.status(400).json({ error: { code: 'INVALID_SALE_DETAILS', message: extraResult.error } });
    const extra = extraResult.value;
    const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
    if (notes.length > 5000) return response.status(400).json({ error: { code: 'INVALID_SALE_NOTES', message: 'As observações excedem o limite de 5.000 caracteres.' } });
    const amountPaid = decimalUnits(body.amountPaid ?? '0', 2);
    if (amountPaid === null) return response.status(400).json({ error: { code: 'INVALID_AMOUNT_PAID', message: 'Informe um valor recebido válido.' } });

    const quoteId = typeof body.quoteId === 'string' && uuidPattern.test(body.quoteId) ? body.quoteId : null;
    if (body.quoteId && !quoteId) return response.status(400).json({ error: { code: 'INVALID_QUOTE_ID', message: 'Orçamento de origem inválido.' } });
    let requestedItems = null;
    if (!quoteId) {
      if (typeof body.customerId !== 'string' || !uuidPattern.test(body.customerId)) return response.status(400).json({ error: { code: 'INVALID_SALE_CUSTOMER', message: 'Selecione um cliente válido.' } });
      const parsed = parseItems(body.items);
      if (parsed.error) return response.status(400).json({ error: { code: 'INVALID_SALE_ITEMS', message: parsed.error } });
      requestedItems = parsed.value;
    }
    const discountCents = quoteId ? null : decimalUnits(body.discountAmount ?? '0', 2);
    if (!quoteId && discountCents === null) return response.status(400).json({ error: { code: 'INVALID_SALE_DISCOUNT', message: 'Informe um desconto válido.' } });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const dateResult = await client.query("SELECT COALESCE($1::date,(now() AT TIME ZONE 'America/Bahia')::date)::text AS sale_date", [body.saleDate || null]);
      const saleDate = dateResult.rows[0].sale_date;
      const saleYear = Number(saleDate.slice(0,4));
      let customer;
      let quote = null;
      let calculated;
      let subtotalCents;
      let saleDiscountCents;

      if (quoteId) {
        const quoteResult = await client.query(
          `SELECT id, quote_number, customer_id, customer_name, customer_tax_identifier, customer_phone,
                  subtotal, discount_amount, total, notes
           FROM public.quotes WHERE id = $1 AND company_id = $2 AND status = 'approved' AND archived_at IS NULL
           FOR SHARE`,
          [quoteId, request.company.company_id],
        );
        if (!quoteResult.rowCount) {
          await client.query('ROLLBACK');
          return response.status(400).json({ error: { code: 'QUOTE_NOT_CONVERTIBLE', message: 'Só é possível converter orçamentos aprovados e ativos.' } });
        }
        quote = quoteResult.rows[0];
        const customerResult = quote.customer_id ? await client.query(
          `SELECT id, name, tax_identifier, phone, payment_term_days FROM public.customers
           WHERE id = $1 AND company_id = $2`, [quote.customer_id, request.company.company_id],
        ) : { rows: [] };
        customer = customerResult.rows[0] || { id: null, name: quote.customer_name, tax_identifier: quote.customer_tax_identifier, phone: quote.customer_phone };
        const itemResult = await client.query(
          `SELECT catalog_item_id, item_type, name, description, unit, quantity, unit_price, line_total
           FROM public.quote_items WHERE company_id = $1 AND quote_id = $2 ORDER BY position`,
          [request.company.company_id, quoteId],
        );
        if (!itemResult.rowCount) {
          await client.query('ROLLBACK');
          return response.status(409).json({ error: { code: 'QUOTE_WITHOUT_ITEMS', message: 'O orçamento aprovado não possui itens para converter.' } });
        }
        calculated = itemResult.rows;
        subtotalCents = decimalUnits(quote.subtotal, 2);
        saleDiscountCents = decimalUnits(quote.discount_amount, 2);
      } else {
        const customerResult = await client.query(
          `SELECT id, name, tax_identifier, phone, payment_term_days FROM public.customers
           WHERE id = $1 AND company_id = $2 AND archived_at IS NULL FOR SHARE`,
          [body.customerId, request.company.company_id],
        );
        if (!customerResult.rowCount) {
          await client.query('ROLLBACK');
          return response.status(400).json({ error: { code: 'SALE_CUSTOMER_UNAVAILABLE', message: 'O cliente selecionado não está disponível.' } });
        }
        customer = customerResult.rows[0];
        const catalogIds = [...new Set(requestedItems.map((item) => item.catalogItemId).filter(Boolean))];
        const catalogResult = catalogIds.length ? await client.query(
          `SELECT id, item_type, name, description, unit, minimum_stock FROM public.catalog_items
           WHERE company_id = $1 AND id = ANY($2::uuid[]) AND archived_at IS NULL AND is_active`,
          [request.company.company_id, catalogIds],
        ) : { rows: [] };
        const catalog = new Map(catalogResult.rows.map((item) => [item.id, item]));
        if (catalog.size !== catalogIds.length) {
          await client.query('ROLLBACK');
          return response.status(400).json({ error: { code: 'SALE_ITEM_UNAVAILABLE', message: 'Um item não está mais ativo no catálogo. Atualize a venda e tente novamente.' } });
        }
        calculated = requestedItems.map((item, index) => {
          const source = item.catalogItemId
            ? catalog.get(item.catalogItemId)
            : { id: null, item_type: item.itemType, name: item.name, description: item.description || null, unit: item.unit };
          const lineCents = lineTotalCents(item.unitPrice, item.quantity);
          return { ...source, position: index + 1, quantity: quantityText(item.quantity), unit_price: moneyText(item.unitPrice), line_total: moneyText(lineCents), totalCents: lineCents };
        });
        subtotalCents = calculated.reduce((sum, item) => sum + item.totalCents, 0n);
        saleDiscountCents = discountCents;
      }

      if (subtotalCents === null || saleDiscountCents === null || subtotalCents > maxCents || saleDiscountCents > subtotalCents) {
        await client.query('ROLLBACK');
        return response.status(400).json({ error: { code: 'INVALID_SALE_TOTAL', message: 'O desconto não pode superar o subtotal da venda.' } });
      }
      const stockRequirements = new Map();
      for (const item of calculated) {
        const itemId = item.catalog_item_id ?? item.id ?? null;
        if (item.item_type !== 'product' || !itemId) continue;
        const qty = decimalUnits(item.quantity, 3, { allowZero: false });
        if (qty === null) continue;
        stockRequirements.set(itemId, (stockRequirements.get(itemId) || 0n) + qty);
      }
      const trackedStock = new Map();
      for (const [itemId, required] of stockRequirements) {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [request.company.company_id, itemId]);
        const item = await client.query(
          `SELECT minimum_stock FROM public.catalog_items WHERE company_id = $1 AND id = $2`,
          [request.company.company_id, itemId],
        );
        if (!item.rowCount) continue;
        const balance = await client.query(
          `SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN quantity ELSE -quantity END), 0)::numeric(12,3)::text AS stock,
             COUNT(*)::int AS movements FROM public.stock_movements WHERE company_id = $1 AND catalog_item_id = $2`,
          [request.company.company_id, itemId],
        );
        const available = decimalUnits(balance.rows[0].stock, 3);
        const isTracked = decimalUnits(item.rows[0].minimum_stock, 3) > 0n || balance.rows[0].movements > 0;
        if (isTracked && (available === null || available < required)) {
          await client.query('ROLLBACK');
          return response.status(409).json({ error: { code: 'INSUFFICIENT_STOCK', message: `Estoque insuficiente para ${calculated.find((line) => (line.catalog_item_id ?? line.id) === itemId)?.name || 'um produto'}.` } });
        }
        if (isTracked) trackedStock.set(itemId, required);
      }
      const paymentTerm = extra.paymentTermDays ?? customer.payment_term_days ?? null;
      const dueDate = body.dueDate || dueDateFromTerm(saleDate,paymentTerm);
      const totalCents = subtotalCents - saleDiscountCents + extra.freightAmount;
      if (totalCents > maxCents) { await client.query('ROLLBACK'); return response.status(400).json({error:{message:'O total com frete excede o limite permitido.'}}); }
      if (amountPaid > totalCents) {
        await client.query('ROLLBACK');
        return response.status(400).json({ error: { code: 'AMOUNT_PAID_EXCEEDS_TOTAL', message: 'O valor recebido não pode superar o total da venda.' } });
      }
      const paymentStatus = amountPaid === totalCents ? 'paid' : amountPaid > 0n ? 'partial' : 'pending';
      const counter = await client.query(
        `INSERT INTO public.sale_year_counters (company_id, sale_year, last_number)
         VALUES ($1, $2, 1)
         ON CONFLICT (company_id, sale_year)
         DO UPDATE SET last_number = public.sale_year_counters.last_number + 1
         RETURNING last_number`, [request.company.company_id, saleYear],
      );
      const saleResult = await client.query(
        `INSERT INTO public.sales (company_id, sale_number, customer_id, quote_id, customer_name,
          customer_tax_identifier, customer_phone, payment_method, payment_status, sale_date, due_date,
          subtotal, discount_amount, total, amount_paid, notes, created_by_subject, sale_year,business_activity,vehicle,plate,driver,destination,freight_amount,freight_cost,payment_term_days)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10::date,CURRENT_DATE),$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
         RETURNING sale_year, id, sale_number, customer_name, status, payment_method, payment_status, sale_date,
          due_date, subtotal, discount_amount, total, amount_paid, quote_id`,
        [request.company.company_id, counter.rows[0].last_number, customer.id, quoteId, customer.name,
          customer.tax_identifier, customer.phone, body.paymentMethod, paymentStatus, saleDate,
          dueDate, moneyText(subtotalCents), moneyText(saleDiscountCents), moneyText(totalCents),
          moneyText(amountPaid), notes || (quote?.notes ?? null), request.auth.subject, saleYear,extra.businessActivity,extra.vehicle,extra.plate,extra.driver,extra.destination,moneyText(extra.freightAmount),moneyText(extra.freightCost),paymentTerm],
      );
      const sale = saleResult.rows[0];
      let financialEntryId=null,financialPaymentId=null,freightEntryId=null;
      if (totalCents > 0n) {
        const receivable = await client.query(
          `INSERT INTO public.financial_entries (company_id, entry_type, title, amount, competence_date,
             due_date, settled_at, status, payment_method, customer_id, sale_id, source_type, source_id,
             notes, created_by_subject,business_activity)
           VALUES ($1, 'income', $2, $3, COALESCE($4::date, CURRENT_DATE), $5::date,
             CASE WHEN $6 THEN COALESCE($4::date, CURRENT_DATE) END,
             CASE WHEN $6 THEN 'settled' ELSE 'pending' END, $7, $8, $9, 'sale', $9, $10, $11, $12)
           RETURNING id`,
          [request.company.company_id, `Nota ${sale.sale_number}/${saleYear}`,
            moneyText(totalCents), saleDate, dueDate, amountPaid === totalCents,
            body.paymentMethod, customer.id, sale.id, notes || (quote?.notes ?? null), request.auth.subject,extra.businessActivity],
        );
        financialEntryId=receivable.rows[0].id;
        if (amountPaid > 0n) {
          const initialPayment=await client.query(
            `INSERT INTO public.financial_payments (company_id, entry_id, amount, payment_method, paid_at, created_by_subject)
             VALUES ($1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE), $6) RETURNING id`,
            [request.company.company_id, receivable.rows[0].id, moneyText(amountPaid), body.paymentMethod, saleDate, request.auth.subject],
          );financialPaymentId=initialPayment.rows[0].id;
        }
      }
      if (extra.freightCost > 0n) {
        const freightEntry=await client.query(`INSERT INTO public.financial_entries(company_id,entry_type,title,amount,competence_date,due_date,status,sale_id,source_type,source_id,notes,created_by_subject,business_activity)
          VALUES($1,'expense',$2,$3,$4::date,$4::date,'pending',$5,'freight',$5,$6,$7,$8) RETURNING id`,
          [request.company.company_id,`Frete da nota ${sale.sale_number}/${saleYear}`,moneyText(extra.freightCost),saleDate,sale.id,extra.driver || null,request.auth.subject,extra.businessActivity]);freightEntryId=freightEntry.rows[0].id;
      }
      if (amountPaid > 0n) {
        await client.query(
          `INSERT INTO public.sale_payments (company_id, sale_id, payment_method, amount, received_date, created_by_subject)
           VALUES ($1,$2,$3,$4,COALESCE($5::date,CURRENT_DATE),$6)`,
          [request.company.company_id, sale.id, body.paymentMethod, moneyText(amountPaid), body.saleDate || null, request.auth.subject],
        );
      }
      for (const [index, item] of calculated.entries()) {
        const quantity = item.quantity;
        const unitPrice = item.unit_price;
        const lineTotal = item.line_total;
        await client.query(
          `INSERT INTO public.sale_items (company_id, sale_id, position, catalog_item_id, item_type,
            name, description, unit, quantity, unit_price, line_total)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [request.company.company_id, sale.id, index + 1, item.catalog_item_id ?? item.id ?? null,
            item.item_type, item.name, item.description, item.unit, quantity, unitPrice, lineTotal],
        );
        const itemId = item.catalog_item_id ?? item.id ?? null;
        if (trackedStock.has(itemId) && item.item_type === 'product') {
          await client.query(
            `INSERT INTO public.stock_movements (company_id, catalog_item_id, direction, quantity, reason, source_type, source_id, created_by_subject)
             VALUES ($1,$2,'out',$3,$4,'sale',$5,$6)`,
            [request.company.company_id, itemId, quantity, `Nota ${sale.sale_number}/${saleYear}`, sale.id, request.auth.subject],
          );
        }
      }
      await client.query(
        `INSERT INTO public.audit_logs (company_id, actor_subject, action, entity_type, entity_id, summary)
         VALUES ($1,$2,'created','sale',$3,$4::jsonb)`,
        [request.company.company_id, request.auth.subject, sale.id,
          JSON.stringify({ saleNumber: sale.sale_number, customerName: sale.customer_name, total: sale.total })],
      );
      await client.query('COMMIT');
      return response.status(201).json({ sale,financialEntryId,financialPaymentId,freightEntryId });
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* connection may already be closed */ }
      return saleError(error, response, 'registrar');
    } finally { client.release(); }
  });

  router.get('/:id', async (request, response) => {
    try {
      const result = await pool.query(
        `SELECT s.*, q.quote_number FROM public.sales s
         LEFT JOIN public.quotes q ON q.company_id = s.company_id AND q.id = s.quote_id
         WHERE s.id = $1 AND s.company_id = $2`,
        [request.params.id, request.company.company_id],
      );
      if (!result.rowCount) return response.status(404).json({ error: { code: 'SALE_NOT_FOUND', message: 'Venda não encontrada.' } });
      const items = await pool.query(
        `SELECT id, position, catalog_item_id, item_type, name, description, unit, quantity,
                unit_price, line_total FROM public.sale_items
         WHERE company_id = $1 AND sale_id = $2 ORDER BY position`,
        [request.company.company_id, request.params.id],
      );
      const payments = await pool.query(
        `SELECT id, payment_method, amount, received_date, created_at
         FROM public.sale_payments WHERE company_id = $1 AND sale_id = $2
         ORDER BY received_date DESC, created_at DESC`,
        [request.company.company_id, request.params.id],
      );
      return response.json({ sale: { ...result.rows[0], items: items.rows, payments: payments.rows } });
    } catch (error) { return saleError(error, response, 'consultar'); }
  });

  router.post('/:id/payments', async (request, response) => {
    const paymentMethod = request.body?.paymentMethod;
    const amount = decimalUnits(request.body?.amount, 2, { allowZero: false });
    const receivedDate = request.body?.receivedDate || null;
    if (!paymentMethods.has(paymentMethod)) return response.status(400).json({ error: { code: 'INVALID_PAYMENT_METHOD', message: 'Selecione uma forma de pagamento válida.' } });
    if (amount === null) return response.status(400).json({ error: { code: 'INVALID_PAYMENT_AMOUNT', message: 'Informe um valor recebido válido.' } });
    if (receivedDate && !realDate(receivedDate)) return response.status(400).json({ error: { code: 'INVALID_PAYMENT_DATE', message: 'Informe uma data de recebimento válida.' } });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const saleResult = await client.query(
        `SELECT total, amount_paid FROM public.sales
         WHERE id = $1 AND company_id = $2 AND status = 'completed' FOR UPDATE`,
        [request.params.id, request.company.company_id],
      );
      if (!saleResult.rowCount) {
        await client.query('ROLLBACK');
        return response.status(404).json({ error: { code: 'SALE_NOT_RECEIVABLE', message: 'Venda não encontrada ou cancelada.' } });
      }
      const sale = saleResult.rows[0];
      const totalCents = decimalUnits(sale.total, 2);
      const paidCents = decimalUnits(sale.amount_paid, 2);
      if (paidCents + amount > totalCents) {
        await client.query('ROLLBACK');
        return response.status(400).json({ error: { code: 'PAYMENT_EXCEEDS_BALANCE', message: 'O recebimento não pode superar o saldo em aberto.' } });
      }
      const newPaid = paidCents + amount;
      const paymentStatus = newPaid === totalCents ? 'paid' : 'partial';
      await client.query(
        `INSERT INTO public.sale_payments (company_id, sale_id, payment_method, amount, received_date, created_by_subject)
         VALUES ($1,$2,$3,$4,COALESCE($5::date,CURRENT_DATE),$6)`,
        [request.company.company_id, request.params.id, paymentMethod, moneyText(amount), receivedDate, request.auth.subject],
      );
      const updated = await client.query(
        `UPDATE public.sales SET amount_paid = $3, payment_status = $4, updated_at = now()
         WHERE id = $1 AND company_id = $2
         RETURNING id, sale_number, total, amount_paid, payment_status`,
        [request.params.id, request.company.company_id, moneyText(newPaid), paymentStatus],
      );
      const financialEntry = await client.query(
        `SELECT id FROM public.financial_entries
         WHERE company_id = $1 AND source_type = 'sale' AND source_id = $2 AND status <> 'cancelled'
         FOR UPDATE`, [request.company.company_id, request.params.id],
      );
      let financialPaymentId=null;
      if (financialEntry.rowCount) {
        const paymentResult=await client.query(
          `INSERT INTO public.financial_payments (company_id, entry_id, amount, payment_method, paid_at, created_by_subject)
           VALUES ($1,$2,$3,$4,COALESCE($5::date,CURRENT_DATE),$6) RETURNING id`,
          [request.company.company_id, financialEntry.rows[0].id, moneyText(amount), paymentMethod, receivedDate, request.auth.subject],
        );
        financialPaymentId=paymentResult.rows[0].id;
        const settled = newPaid === totalCents;
        await client.query(
          `UPDATE public.financial_entries SET status = CASE WHEN $3 THEN 'settled' ELSE 'pending' END,
             settled_at = CASE WHEN $3 THEN COALESCE($4::date,CURRENT_DATE) ELSE NULL END,
             payment_method = $5, updated_at = now() WHERE company_id = $1 AND id = $2`,
          [request.company.company_id, financialEntry.rows[0].id, settled, receivedDate, paymentMethod],
        );
      }
      await client.query(
        `INSERT INTO public.audit_logs (company_id, actor_subject, action, entity_type, entity_id, summary)
         VALUES ($1,$2,'payment_recorded','sale',$3,$4::jsonb)`,
        [request.company.company_id, request.auth.subject, request.params.id,
          JSON.stringify({ amount: moneyText(amount), paymentMethod })],
      );
      await client.query('COMMIT');
      return response.status(201).json({ sale: updated.rows[0],financialPaymentId });
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* connection may already be closed */ }
      return saleError(error, response, 'registrar recebimento');
    } finally { client.release(); }
  });

  router.post('/:id/cancel', async (request, response) => {
    if (request.company.role !== 'owner') return response.status(403).json({ error: { code: 'OWNER_REQUIRED', message: 'Somente o responsável da empresa pode cancelar uma venda.' } });
    const reason = typeof request.body?.reason === 'string' ? request.body.reason.trim() : '';
    if (reason.length < 3 || reason.length > 500) return response.status(400).json({ error: { code: 'INVALID_CANCELLATION_REASON', message: 'Informe o motivo do cancelamento (de 3 a 500 caracteres).' } });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM public.sales WHERE company_id=$1 AND id=$2 FOR UPDATE',[request.company.company_id,request.params.id]);
      const paidFreight=await client.query(`SELECT f.id FROM public.financial_entries f WHERE f.company_id=$1 AND f.source_type='freight' AND f.source_id=$2 AND EXISTS(SELECT 1 FROM public.financial_payments p WHERE p.company_id=f.company_id AND p.entry_id=f.id) FOR UPDATE`,[request.company.company_id,request.params.id]);
      if(paidFreight.rowCount) { await client.query('ROLLBACK'); return response.status(409).json({error:{message:'Esta venda possui frete já pago. Regularize o pagamento no financeiro antes de cancelar.'}}); }
      const result = await client.query(
        `UPDATE public.sales SET status = 'cancelled', cancelled_at = now(), cancellation_reason = $3,
           cancelled_by_subject = $4, updated_at = now()
         WHERE id = $1 AND company_id = $2 AND status = 'completed'
         RETURNING id, sale_number, sale_year, status, cancelled_at, cancellation_reason`,
        [request.params.id, request.company.company_id, reason, request.auth.subject],
      );
      if (!result.rowCount) {
        await client.query('ROLLBACK');
        return response.status(409).json({ error: { code: 'SALE_NOT_CANCELLABLE', message: 'A venda não existe ou já foi cancelada.' } });
      }
      const stockOut = await client.query(
        `SELECT catalog_item_id, quantity FROM public.stock_movements
         WHERE company_id = $1 AND source_type = 'sale' AND source_id = $2 AND direction = 'out'`,
        [request.company.company_id, request.params.id],
      );
      for (const movement of stockOut.rows) {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [request.company.company_id, movement.catalog_item_id]);
        await client.query(
          `INSERT INTO public.stock_movements (company_id, catalog_item_id, direction, quantity, reason, source_type, source_id, created_by_subject)
           VALUES ($1,$2,'in',$3,$4,'reversal',$5,$6)`,
          [request.company.company_id, movement.catalog_item_id, movement.quantity,
            `Estorno da nota ${result.rows[0].sale_number}/${result.rows[0].sale_year}`, request.params.id, request.auth.subject],
        );
      }
      await client.query(
        `UPDATE public.financial_entries SET status = 'cancelled', settled_at = NULL, updated_at = now()
         WHERE company_id = $1 AND source_type IN ('sale','freight') AND source_id = $2 AND status <> 'cancelled'`,
        [request.company.company_id, request.params.id],
      );
      await client.query(
        `INSERT INTO public.audit_logs (company_id, actor_subject, action, entity_type, entity_id, summary)
         VALUES ($1,$2,'cancelled','sale',$3,$4::jsonb)`,
        [request.company.company_id, request.auth.subject, request.params.id, JSON.stringify({ reason })],
      );
      await client.query('COMMIT');
      return response.json({ sale: result.rows[0] });
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* connection may already be closed */ }
      return saleError(error, response, 'cancelar');
    } finally { client.release(); }
  });

  return router;
}
