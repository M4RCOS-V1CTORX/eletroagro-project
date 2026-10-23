import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { config } = require('dotenv');
const pg = require('pg');
config({ path: new URL('../apps/api/.env', import.meta.url) });
assert(process.env.DATABASE_URL, 'DATABASE_URL não configurada');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false, max: 1 });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const company = (await client.query(`INSERT INTO public.companies(name,document_settings) VALUES('Validação EletroAgro',$1::jsonb) RETURNING id`, [JSON.stringify({ accentColor: '#176da3', footerText: 'Teste', showSignature: true })])).rows[0];
  const membership = (await client.query(`INSERT INTO public.company_memberships(company_id,auth_issuer,auth_subject,role,email,permissions) VALUES($1,'test-issuer','test-subject','owner','qa@example.invalid',$2::jsonb) RETURNING id,permissions`, [company.id, JSON.stringify({ commercial: true, operations: true, finance: true, reports: true, audit: true })])).rows[0];
  assert.equal(membership.permissions.finance, true);
  const entry = (await client.query(`INSERT INTO public.financial_entries(company_id,entry_type,title,amount,competence_date,due_date,status,created_by_subject,recurrence_group,installment_number,installment_count) VALUES($1,'income','Parcela de validação',100,CURRENT_DATE,CURRENT_DATE,'pending','test-subject',gen_random_uuid(),1,2) RETURNING id`, [company.id])).rows[0];
  const payment = (await client.query(`INSERT INTO public.financial_payments(company_id,entry_id,amount,payment_method,paid_at,created_by_subject) VALUES($1,$2,50,'pix',CURRENT_DATE,'test-subject') RETURNING id`, [company.id, entry.id])).rows[0];
  const counter = (await client.query(`INSERT INTO public.document_counters(company_id,document_type,last_number) VALUES($1,'receipt',1) RETURNING last_number`, [company.id])).rows[0];
  const receipt = (await client.query(`INSERT INTO public.receipts(company_id,receipt_number,financial_entry_id,payment_id,payer_name,payee_name,description,amount,paid_at,payment_method,created_by_subject) VALUES($1,$2,$3,$4,'Cliente Teste','Validação EletroAgro','Recebimento de teste',50,CURRENT_DATE,'pix','test-subject') RETURNING id,receipt_number`, [company.id, counter.last_number, entry.id, payment.id])).rows[0];
  assert.equal(Number(receipt.receipt_number), 1);
  const order = (await client.query(`INSERT INTO public.service_orders(company_id,order_number,customer_name,title,estimated_total,created_by_subject) VALUES($1,1,'Cliente Teste','Serviço de validação',100,'test-subject') RETURNING id`, [company.id])).rows[0];
  const attachment = (await client.query(`INSERT INTO public.service_order_attachments(company_id,service_order_id,file_name,mime_type,byte_size,content_data,created_by_subject) VALUES($1,$2,'teste.png','image/png',8,'data:image/png;base64,dGVzdGU=','test-subject') RETURNING id`, [company.id, order.id])).rows[0];
  assert(attachment.id);
  const preferences = (await client.query(`INSERT INTO public.notification_preferences(company_id,membership_id,browser_notifications,reminder_minutes) VALUES($1,$2,true,60) RETURNING reminder_minutes`, [company.id, membership.id])).rows[0];
  assert.equal(preferences.reminder_minutes, 60);
  await client.query(`INSERT INTO public.idempotency_keys(company_id,idempotency_key,request_path,response_status,response_body) VALUES($1,gen_random_uuid(),'/api/test',201,'{"ok":true}'::jsonb)`, [company.id]);
  const aggregate = (await client.query(`SELECT COALESCE(SUM(amount),0)::text total FROM public.financial_entries WHERE company_id=$1`, [company.id])).rows[0];
  assert.equal(aggregate.total, '100.00');
  const from = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);
  const reportQueries = [
    [`SELECT
      COALESCE((SELECT SUM(total) FROM public.sales WHERE company_id=$1 AND status='completed' AND sale_date BETWEEN $2 AND $3),0)::text AS sales,
      COALESCE((SELECT SUM(p.amount) FROM public.financial_payments p JOIN public.financial_entries f ON f.company_id=p.company_id AND f.id=p.entry_id WHERE p.company_id=$1 AND f.entry_type='income' AND p.paid_at BETWEEN $2 AND $3),0)::text AS income,
      COALESCE((SELECT SUM(p.amount) FROM public.financial_payments p JOIN public.financial_entries f ON f.company_id=p.company_id AND f.id=p.entry_id WHERE p.company_id=$1 AND f.entry_type='expense' AND p.paid_at BETWEEN $2 AND $3),0)::text AS expense,
      (SELECT COUNT(*)::int FROM public.quotes WHERE company_id=$1 AND archived_at IS NULL AND issued_at BETWEEN $2 AND $3) AS quotes,
      (SELECT COUNT(*)::int FROM public.quotes WHERE company_id=$1 AND archived_at IS NULL AND status='approved' AND issued_at BETWEEN $2 AND $3) AS approved_quotes,
      (SELECT COUNT(*)::int FROM public.service_orders WHERE company_id=$1 AND status='completed' AND completed_at::date BETWEEN $2 AND $3) AS completed_orders`, [company.id, from, to]],
    [`WITH months AS (SELECT generate_series(date_trunc('month',$2::date),date_trunc('month',$3::date),'1 month')::date AS month)
      SELECT to_char(m.month,'YYYY-MM') AS month,
      COALESCE((SELECT SUM(total) FROM public.sales s WHERE s.company_id=$1 AND s.status='completed' AND date_trunc('month',s.sale_date)=m.month),0)::text AS sales,
      COALESCE((SELECT SUM(p.amount) FROM public.financial_payments p JOIN public.financial_entries f ON f.company_id=p.company_id AND f.id=p.entry_id WHERE p.company_id=$1 AND f.entry_type='income' AND date_trunc('month',p.paid_at)=m.month),0)::text AS income,
      COALESCE((SELECT SUM(p.amount) FROM public.financial_payments p JOIN public.financial_entries f ON f.company_id=p.company_id AND f.id=p.entry_id WHERE p.company_id=$1 AND f.entry_type='expense' AND date_trunc('month',p.paid_at)=m.month),0)::text AS expense
      FROM months m ORDER BY m.month`, [company.id, from, to]],
    [`SELECT status,COUNT(*)::int AS count,COALESCE(SUM(total),0)::text AS total FROM public.quotes WHERE company_id=$1 AND archived_at IS NULL AND issued_at BETWEEN $2 AND $3 GROUP BY status ORDER BY status`, [company.id, from, to]],
    [`SELECT status,COUNT(*)::int AS count FROM public.service_orders WHERE company_id=$1 GROUP BY status ORDER BY status`, [company.id]],
    [`SELECT c.id,c.name,c.code,c.minimum_stock,COALESCE(SUM(CASE WHEN m.direction='in' THEN m.quantity WHEN m.direction='out' THEN -m.quantity ELSE 0 END),0)::text AS stock
      FROM public.catalog_items c LEFT JOIN public.stock_movements m ON m.company_id=c.company_id AND m.catalog_item_id=c.id
      WHERE c.company_id=$1 AND c.item_type='product' AND c.archived_at IS NULL AND c.is_active
      GROUP BY c.id HAVING COALESCE(SUM(CASE WHEN m.direction='in' THEN m.quantity WHEN m.direction='out' THEN -m.quantity ELSE 0 END),0)<=c.minimum_stock
      ORDER BY COALESCE(SUM(CASE WHEN m.direction='in' THEN m.quantity WHEN m.direction='out' THEN -m.quantity ELSE 0 END),0),c.name LIMIT 20`, [company.id]],
    [`SELECT customer_name,COUNT(*)::int AS sales_count,SUM(total)::text AS total FROM public.sales WHERE company_id=$1 AND status='completed' AND sale_date BETWEEN $2 AND $3 GROUP BY customer_name ORDER BY SUM(total) DESC LIMIT 10`, [company.id, from, to]],
    [`SELECT COALESCE(m.display_name,m.email,l.actor_subject) AS actor,COUNT(*)::int AS actions FROM public.audit_logs l LEFT JOIN public.company_memberships m ON m.company_id=l.company_id AND m.auth_subject=l.actor_subject WHERE l.company_id=$1 AND l.created_at::date BETWEEN $2 AND $3 GROUP BY COALESCE(m.display_name,m.email,l.actor_subject) ORDER BY COUNT(*) DESC LIMIT 10`, [company.id, from, to]],
  ];
  for (const [sql, params] of reportQueries) await client.query(sql, params);
  await client.query('ROLLBACK');
  console.log('Integração PostgreSQL validada em transação revertida: permissões, parcelas, recibos, anexos, notificações, idempotência e relatórios.');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Falha na integração PostgreSQL:', error.message);
  process.exitCode = 1;
} finally { client.release(); await pool.end(); }
