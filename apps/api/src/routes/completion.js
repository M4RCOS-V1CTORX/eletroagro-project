import { Router } from 'express';
import { requireCompanyMembership } from '../middleware/neon-auth.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const defaultDocumentSettings = { accentColor: '#176da3', footerText: 'Obrigado pela preferência.', showSignature: true };

function validDate(value) {
  if (typeof value !== 'string' || !datePattern.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function fail(response, error, message) {
  console.error(message, error.message);
  return response.status(500).json({ error: { code: 'COMPLETION_FAILED', message } });
}

async function audit(db, request, action, entityType, entityId, summary = {}) {
  await db.query(
    `INSERT INTO public.audit_logs(company_id,actor_subject,action,entity_type,entity_id,summary)
     VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
    [request.company.company_id, request.auth.subject, action, entityType, entityId || null, JSON.stringify(summary)],
  );
}

export function createCompletionRouter({ pool, requireAuth, requireDatabase }) {
  const router = Router();
  router.use(requireAuth, requireDatabase(pool), requireCompanyMembership(pool));
  router.use((request, response, next) => {
    if (request.company.role === 'owner') return next();
    const area = request.path.startsWith('/reports') ? 'reports'
      : request.path.startsWith('/payments') || request.path.startsWith('/receipts') ? 'finance'
        : request.path.startsWith('/service-orders') ? 'operations' : null;
    if (!area || request.company.permissions?.[area] !== false) return next();
    return response.status(403).json({ error: { code: 'AREA_FORBIDDEN', message: 'Seu acesso não permite usar esta área.' } });
  });

  router.get('/reports', async (request, response) => {
    if (request.company.role !== 'owner' && request.company.permissions?.reports === false) {
      return response.status(403).json({ error: { code: 'REPORTS_FORBIDDEN', message: 'Seu acesso não permite consultar relatórios.' } });
    }
    const from = validDate(request.query.from) ? request.query.from : new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
    const to = validDate(request.query.to) ? request.query.to : new Date().toISOString().slice(0, 10);
    if (from > to) return response.status(400).json({ error: { code: 'INVALID_PERIOD', message: 'A data inicial deve ser anterior à data final.' } });
    const companyId = request.company.company_id;
    try {
      const [summary, monthly, quoteStatuses, orderStatuses, lowStock, topCustomers, activity] = await Promise.all([
        pool.query(`SELECT
          COALESCE((SELECT SUM(total) FROM public.sales WHERE company_id=$1 AND status='completed' AND sale_date BETWEEN $2 AND $3),0)::text AS sales,
          COALESCE((SELECT SUM(p.amount) FROM public.financial_payments p JOIN public.financial_entries f ON f.company_id=p.company_id AND f.id=p.entry_id WHERE p.company_id=$1 AND f.entry_type='income' AND p.paid_at BETWEEN $2 AND $3),0)::text AS income,
          COALESCE((SELECT SUM(p.amount) FROM public.financial_payments p JOIN public.financial_entries f ON f.company_id=p.company_id AND f.id=p.entry_id WHERE p.company_id=$1 AND f.entry_type='expense' AND p.paid_at BETWEEN $2 AND $3),0)::text AS expense,
          (SELECT COUNT(*)::int FROM public.quotes WHERE company_id=$1 AND archived_at IS NULL AND issued_at BETWEEN $2 AND $3) AS quotes,
          (SELECT COUNT(*)::int FROM public.quotes WHERE company_id=$1 AND archived_at IS NULL AND status='approved' AND issued_at BETWEEN $2 AND $3) AS approved_quotes,
          (SELECT COUNT(*)::int FROM public.service_orders WHERE company_id=$1 AND status='completed' AND completed_at::date BETWEEN $2 AND $3) AS completed_orders`, [companyId, from, to]),
        pool.query(`WITH months AS (SELECT generate_series(date_trunc('month',$2::date),date_trunc('month',$3::date),'1 month')::date AS month)
          SELECT to_char(m.month,'YYYY-MM') AS month,
          COALESCE((SELECT SUM(total) FROM public.sales s WHERE s.company_id=$1 AND s.status='completed' AND date_trunc('month',s.sale_date)=m.month),0)::text AS sales,
          COALESCE((SELECT SUM(p.amount) FROM public.financial_payments p JOIN public.financial_entries f ON f.company_id=p.company_id AND f.id=p.entry_id WHERE p.company_id=$1 AND f.entry_type='income' AND date_trunc('month',p.paid_at)=m.month),0)::text AS income,
          COALESCE((SELECT SUM(p.amount) FROM public.financial_payments p JOIN public.financial_entries f ON f.company_id=p.company_id AND f.id=p.entry_id WHERE p.company_id=$1 AND f.entry_type='expense' AND date_trunc('month',p.paid_at)=m.month),0)::text AS expense
          FROM months m ORDER BY m.month`, [companyId, from, to]),
        pool.query(`SELECT status,COUNT(*)::int AS count,COALESCE(SUM(total),0)::text AS total FROM public.quotes WHERE company_id=$1 AND archived_at IS NULL AND issued_at BETWEEN $2 AND $3 GROUP BY status ORDER BY status`, [companyId, from, to]),
        pool.query(`SELECT status,COUNT(*)::int AS count FROM public.service_orders WHERE company_id=$1 GROUP BY status ORDER BY status`, [companyId]),
        pool.query(`SELECT c.id,c.name,c.code,c.minimum_stock,COALESCE(SUM(CASE WHEN m.direction='in' THEN m.quantity WHEN m.direction='out' THEN -m.quantity ELSE 0 END),0)::text AS stock
          FROM public.catalog_items c LEFT JOIN public.stock_movements m ON m.company_id=c.company_id AND m.catalog_item_id=c.id
          WHERE c.company_id=$1 AND c.item_type='product' AND c.archived_at IS NULL AND c.is_active
          GROUP BY c.id HAVING COALESCE(SUM(CASE WHEN m.direction='in' THEN m.quantity WHEN m.direction='out' THEN -m.quantity ELSE 0 END),0)<=c.minimum_stock
          ORDER BY COALESCE(SUM(CASE WHEN m.direction='in' THEN m.quantity WHEN m.direction='out' THEN -m.quantity ELSE 0 END),0),c.name LIMIT 20`, [companyId]),
        pool.query(`SELECT customer_name,COUNT(*)::int AS sales_count,SUM(total)::text AS total FROM public.sales WHERE company_id=$1 AND status='completed' AND sale_date BETWEEN $2 AND $3 GROUP BY customer_name ORDER BY SUM(total) DESC LIMIT 10`, [companyId, from, to]),
        pool.query(`SELECT COALESCE(m.display_name,m.email,l.actor_subject) AS actor,COUNT(*)::int AS actions FROM public.audit_logs l LEFT JOIN public.company_memberships m ON m.company_id=l.company_id AND m.auth_subject=l.actor_subject WHERE l.company_id=$1 AND l.created_at::date BETWEEN $2 AND $3 GROUP BY COALESCE(m.display_name,m.email,l.actor_subject) ORDER BY COUNT(*) DESC LIMIT 10`, [companyId, from, to]),
      ]);
      return response.json({ period: { from, to }, summary: summary.rows[0], monthly: monthly.rows, quoteStatuses: quoteStatuses.rows, orderStatuses: orderStatuses.rows, lowStock: lowStock.rows, topCustomers: topCustomers.rows, activity: activity.rows });
    } catch (error) { return fail(response, error, 'Não foi possível gerar os relatórios.'); }
  });

  router.get('/payments', async (request, response) => {
    try {
      const result = await pool.query(`SELECT p.id,p.entry_id,p.amount,p.payment_method,p.paid_at,p.created_at,f.entry_type,f.title,
        COALESCE(c.name,s.name) AS related_name,r.id AS receipt_id,r.receipt_number
        FROM public.financial_payments p JOIN public.financial_entries f ON f.company_id=p.company_id AND f.id=p.entry_id
        LEFT JOIN public.customers c ON c.company_id=f.company_id AND c.id=f.customer_id
        LEFT JOIN public.suppliers s ON s.company_id=f.company_id AND s.id=f.supplier_id
        LEFT JOIN public.receipts r ON r.company_id=p.company_id AND r.payment_id=p.id
        WHERE p.company_id=$1 ORDER BY p.paid_at DESC,p.created_at DESC LIMIT 300`, [request.company.company_id]);
      return response.json({ payments: result.rows });
    } catch (error) { return fail(response, error, 'Não foi possível consultar os pagamentos.'); }
  });

  router.post('/receipts', async (request, response) => {
    if (!uuidPattern.test(request.body?.paymentId || '')) return response.status(400).json({ error: { code: 'INVALID_PAYMENT', message: 'Selecione um pagamento válido.' } });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const payment = await client.query(`SELECT p.*,f.title,f.entry_type,c.name AS customer_name,s.name AS supplier_name,co.name AS company_name
        FROM public.financial_payments p JOIN public.financial_entries f ON f.company_id=p.company_id AND f.id=p.entry_id
        JOIN public.companies co ON co.id=p.company_id
        LEFT JOIN public.customers c ON c.company_id=f.company_id AND c.id=f.customer_id
        LEFT JOIN public.suppliers s ON s.company_id=f.company_id AND s.id=f.supplier_id
        WHERE p.company_id=$1 AND p.id=$2 FOR UPDATE`, [request.company.company_id, request.body.paymentId]);
      if (!payment.rowCount) { await client.query('ROLLBACK'); return response.status(404).json({ error: { code: 'PAYMENT_NOT_FOUND', message: 'Pagamento não encontrado.' } }); }
      const item = payment.rows[0];
      const payerName = String(request.body.payerName || (item.entry_type === 'income' ? item.customer_name : item.company_name) || 'Não informado').trim().slice(0, 200);
      const payeeName = String(request.body.payeeName || (item.entry_type === 'income' ? item.company_name : item.supplier_name) || 'Não informado').trim().slice(0, 200);
      const description = String(request.body.description || item.title).trim().slice(0, 500);
      if (payerName.length < 2 || payeeName.length < 2 || description.length < 2) { await client.query('ROLLBACK'); return response.status(400).json({ error: { code: 'INVALID_RECEIPT', message: 'Confira pagador, recebedor e descrição.' } }); }
      const counter = await client.query(`INSERT INTO public.document_counters(company_id,document_type,last_number) VALUES($1,'receipt',1) ON CONFLICT(company_id,document_type) DO UPDATE SET last_number=public.document_counters.last_number+1 RETURNING last_number`, [request.company.company_id]);
      const result = await client.query(`INSERT INTO public.receipts(company_id,receipt_number,financial_entry_id,payment_id,payer_name,payee_name,description,amount,paid_at,payment_method,signature_required,created_by_subject)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(company_id,payment_id) DO UPDATE SET payer_name=EXCLUDED.payer_name,payee_name=EXCLUDED.payee_name,description=EXCLUDED.description,signature_required=EXCLUDED.signature_required RETURNING *`, [request.company.company_id, counter.rows[0].last_number, item.entry_id, item.id, payerName, payeeName, description, item.amount, item.paid_at, item.payment_method, request.body.signatureRequired !== false, request.auth.subject]);
      await audit(client, request, 'receipt_created', 'receipt', result.rows[0].id, { receiptNumber: result.rows[0].receipt_number, amount: item.amount });
      await client.query('COMMIT');
      return response.status(201).json({ receipt: result.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      return fail(response, error, 'Não foi possível gerar o recibo.');
    } finally { client.release(); }
  });

  router.get('/receipts/:id', async (request, response) => {
    if (!uuidPattern.test(request.params.id)) return response.status(400).json({ error: { code: 'INVALID_RECEIPT', message: 'Recibo inválido.' } });
    try {
      const result = await pool.query(`SELECT r.*,c.name AS company_name,c.tax_identifier,c.phone,c.email,c.document_settings
        FROM public.receipts r JOIN public.companies c ON c.id=r.company_id WHERE r.company_id=$1 AND r.id=$2`, [request.company.company_id, request.params.id]);
      if (!result.rowCount) return response.status(404).json({ error: { code: 'RECEIPT_NOT_FOUND', message: 'Recibo não encontrado.' } });
      return response.json({ receipt: result.rows[0] });
    } catch (error) { return fail(response, error, 'Não foi possível abrir o recibo.'); }
  });

  router.get('/service-orders/:id/attachments', async (request, response) => {
    if (!uuidPattern.test(request.params.id)) return response.status(400).json({ error: { code: 'INVALID_ORDER', message: 'Ordem de serviço inválida.' } });
    try {
      const result = await pool.query(`SELECT id,file_name,mime_type,byte_size,content_data,caption,created_at FROM public.service_order_attachments WHERE company_id=$1 AND service_order_id=$2 ORDER BY created_at DESC`, [request.company.company_id, request.params.id]);
      return response.json({ attachments: result.rows });
    } catch (error) { return fail(response, error, 'Não foi possível carregar os anexos.'); }
  });

  router.post('/service-orders/:id/attachments', async (request, response) => {
    const body = request.body || {};
    const byteSize = Number(body.byteSize);
    if (!uuidPattern.test(request.params.id) || !allowedMimeTypes.has(body.mimeType) || !Number.isInteger(byteSize) || byteSize < 1 || byteSize > 2097152 || typeof body.contentData !== 'string' || body.contentData.length > 3000000) {
      return response.status(400).json({ error: { code: 'INVALID_ATTACHMENT', message: 'Envie JPG, PNG, WebP ou PDF de até 2 MB.' } });
    }
    try {
      const result = await pool.query(`INSERT INTO public.service_order_attachments(company_id,service_order_id,file_name,mime_type,byte_size,content_data,caption,created_by_subject)
        SELECT $1,$2,$3,$4,$5,$6,$7,$8 WHERE EXISTS(SELECT 1 FROM public.service_orders WHERE company_id=$1 AND id=$2) RETURNING id,file_name,mime_type,byte_size,content_data,caption,created_at`, [request.company.company_id, request.params.id, String(body.fileName || 'anexo').trim().slice(0, 240), body.mimeType, byteSize, body.contentData, String(body.caption || '').trim().slice(0, 500) || null, request.auth.subject]);
      if (!result.rowCount) return response.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'Ordem de serviço não encontrada.' } });
      await audit(pool, request, 'attachment_added', 'service_order', request.params.id, { fileName: result.rows[0].file_name });
      return response.status(201).json({ attachment: result.rows[0] });
    } catch (error) { return fail(response, error, 'Não foi possível salvar o anexo.'); }
  });

  router.delete('/service-orders/:orderId/attachments/:id', async (request, response) => {
    if (!uuidPattern.test(request.params.orderId) || !uuidPattern.test(request.params.id)) return response.status(400).json({ error: { code: 'INVALID_ATTACHMENT', message: 'Anexo inválido.' } });
    try {
      const result = await pool.query('DELETE FROM public.service_order_attachments WHERE company_id=$1 AND service_order_id=$2 AND id=$3 RETURNING file_name', [request.company.company_id, request.params.orderId, request.params.id]);
      if (!result.rowCount) return response.status(404).json({ error: { code: 'ATTACHMENT_NOT_FOUND', message: 'Anexo não encontrado.' } });
      await audit(pool, request, 'attachment_removed', 'service_order', request.params.orderId, { fileName: result.rows[0].file_name });
      return response.status(204).end();
    } catch (error) { return fail(response, error, 'Não foi possível remover o anexo.'); }
  });

  router.get('/notifications', async (request, response) => {
    try {
      const [preferences, reminders] = await Promise.all([
        pool.query(`SELECT browser_notifications,reminder_minutes FROM public.notification_preferences WHERE company_id=$1 AND membership_id=$2`, [request.company.company_id, request.company.membership_id]),
        pool.query(`SELECT id,title,starts_at,address FROM public.appointments WHERE company_id=$1 AND status='scheduled' AND starts_at BETWEEN now() AND now()+interval '7 days' ORDER BY starts_at LIMIT 50`, [request.company.company_id]),
      ]);
      return response.json({ preferences: preferences.rows[0] || { browser_notifications: false, reminder_minutes: 60 }, reminders: reminders.rows });
    } catch (error) { return fail(response, error, 'Não foi possível carregar os lembretes.'); }
  });

  router.put('/notifications/preferences', async (request, response) => {
    const minutes = Number(request.body?.reminderMinutes);
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 10080) return response.status(400).json({ error: { code: 'INVALID_REMINDER', message: 'Escolha um aviso entre 5 minutos e 7 dias.' } });
    try {
      const result = await pool.query(`INSERT INTO public.notification_preferences(company_id,membership_id,browser_notifications,reminder_minutes) VALUES($1,$2,$3,$4)
        ON CONFLICT(company_id,membership_id) DO UPDATE SET browser_notifications=EXCLUDED.browser_notifications,reminder_minutes=EXCLUDED.reminder_minutes,updated_at=now() RETURNING browser_notifications,reminder_minutes`, [request.company.company_id, request.company.membership_id, Boolean(request.body.browserNotifications), minutes]);
      return response.json({ preferences: result.rows[0] });
    } catch (error) { return fail(response, error, 'Não foi possível salvar as preferências de aviso.'); }
  });

  router.get('/document-settings', async (request, response) => {
    try {
      const result = await pool.query('SELECT document_settings FROM public.companies WHERE id=$1', [request.company.company_id]);
      return response.json({ settings: { ...defaultDocumentSettings, ...(result.rows[0]?.document_settings || {}) } });
    } catch (error) { return fail(response, error, 'Não foi possível carregar as preferências dos documentos.'); }
  });

  router.put('/document-settings', async (request, response) => {
    if (request.company.role !== 'owner') return response.status(403).json({ error: { code: 'OWNER_REQUIRED', message: 'Somente o responsável pode personalizar documentos.' } });
    const accentColor = /^#[0-9a-f]{6}$/i.test(request.body?.accentColor || '') ? request.body.accentColor : defaultDocumentSettings.accentColor;
    const settings = { accentColor, footerText: String(request.body?.footerText || '').trim().slice(0, 300), showSignature: request.body?.showSignature !== false };
    try {
      await pool.query('UPDATE public.companies SET document_settings=$2::jsonb,updated_at=now() WHERE id=$1', [request.company.company_id, JSON.stringify(settings)]);
      await audit(pool, request, 'document_settings_updated', 'company', request.company.company_id, settings);
      return response.json({ settings });
    } catch (error) { return fail(response, error, 'Não foi possível personalizar os documentos.'); }
  });

  return router;
}
