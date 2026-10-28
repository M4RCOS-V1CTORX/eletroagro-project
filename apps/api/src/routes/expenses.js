import {activities as validActivities} from '../lib/commercial.js';
import { Router } from 'express';
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const methods = ['pix', 'cash', 'card_debit', 'card_credit', 'transfer', 'boleto', 'other'];
const activities = ['all',...validActivities];
const dateOnly = value => value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
export function createExpensesRouter({
  pool,
  validDate,
  money,
  moneyText,
  fixedType='expense'
}) {
  const router = Router();
  const reject = (res, status, message) => res.status(status).json({
    error: {
      code: 'EXPENSE_VALIDATION',
      message:fixedType==='all'?message.replace(/despesas/gi,'contas').replace(/despesa/gi,'conta'):message
    }
  });
  const selection = `SELECT f.*, s.name AS supplier_name, c.name AS customer_name, COALESCE(p.paid,0)::text AS amount_paid,
    GREATEST(f.amount-COALESCE(p.paid,0),0)::text AS balance, p.last_paid_at,
    (f.status='pending' AND f.due_date<CURRENT_DATE) AS overdue
    FROM public.financial_entries f
    LEFT JOIN public.customers c ON c.company_id=f.company_id AND c.id=f.customer_id
    LEFT JOIN public.suppliers s ON s.company_id=f.company_id AND s.id=f.supplier_id
    LEFT JOIN LATERAL (SELECT SUM(amount) AS paid, MAX(paid_at) AS last_paid_at FROM public.financial_payments WHERE company_id=f.company_id AND entry_id=f.id) p ON true`;
  router.get('/', async (req, res, next) => {
    const q = req.query,
      type=fixedType==='all'?(req.allowedAccountType||q.type||'all'):fixedType,
      activity = q.activity || 'all',
      category = q.category || 'all',
      status = q.status || 'all',
      method = q.paymentMethod || 'all';
    if (!['income','expense','all'].includes(type)||!activities.includes(activity) || typeof category !== 'string' || category.length > 80 || !['all', 'pending', 'settled', 'overdue', 'cancelled'].includes(status) || !['all', ...methods].includes(method) || q.from && !validDate(q.from) || q.to && !validDate(q.to) || q.from && q.to && q.from > q.to) return reject(res, 400, 'Confira os filtros e o período informado.');
    const limit = Number(q.limit || 25),
      offset = Number(q.offset || 0);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0) return reject(res, 400, 'Paginação inválida.');
    const sorts = {
      due_date: 'COALESCE(due_date,competence_date)',
      title: 'title',
      amount: 'amount',
      status: 'status',
      created_at: 'created_at'
    };
    const sort = Object.hasOwn(sorts, q.sort || 'due_date') ? sorts[q.sort || 'due_date'] : null;
    if (!sort || !['asc', 'desc'].includes(q.order || 'asc')) return reject(res, 400, 'Ordenação inválida.');
    const args = [req.company.company_id, String(q.q || '').trim().slice(0, 100), activity, category, status, method, q.from || null, q.to || null,type];
    const where = `WHERE f.company_id=$1 AND ($9='all' OR f.entry_type=$9)
      AND ($2='' OR f.title ILIKE '%'||$2||'%' OR s.name ILIKE '%'||$2||'%' OR c.name ILIKE '%'||$2||'%')
      AND ($3='all' OR f.business_activity=$3) AND ($4='all' OR COALESCE(to_jsonb(f)->>'expense_category','Sem categoria')=$4)
      AND ($5='all' OR ($5='overdue' AND f.status='pending' AND f.due_date<CURRENT_DATE) OR f.status=$5)
      AND ($6='all' OR EXISTS(SELECT 1 FROM public.financial_payments fp WHERE fp.company_id=f.company_id AND fp.entry_id=f.id AND fp.payment_method=$6))
      AND ($7::date IS NULL OR COALESCE(f.due_date,f.competence_date)>=$7)
      AND ($8::date IS NULL OR COALESCE(f.due_date,f.competence_date)<=$8)`;
    try {
      // Same snapshot for totals and page, including concurrent payments.
      const client = await pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const summary = await client.query(`WITH filtered AS (${selection} ${where}) SELECT COUNT(*)::int AS count,
          COALESCE(SUM(amount) FILTER(WHERE status<>'cancelled'),0)::text AS total,
          COALESCE(SUM(amount_paid::numeric) FILTER(WHERE status<>'cancelled'),0)::text AS paid,
          COALESCE(SUM(balance::numeric) FILTER(WHERE status='pending'),0)::text AS pending,
          COALESCE(SUM(balance::numeric) FILTER(WHERE overdue),0)::text AS overdue,
          COALESCE(SUM(balance::numeric) FILTER(WHERE status='pending' AND entry_type='expense'),0)::text AS payable,
          COALESCE(SUM(balance::numeric) FILTER(WHERE status='pending' AND entry_type='income'),0)::text AS receivable FROM filtered`, args);
        const rows = await client.query(`WITH filtered AS (${selection} ${where}) SELECT * FROM filtered ORDER BY ${sort} ${q.order === 'desc' ? 'DESC' : 'ASC'} NULLS LAST, id LIMIT $10 OFFSET $11`, [...args, limit, offset]);
        const categories = await client.query("SELECT DISTINCT COALESCE(to_jsonb(f)->>'expense_category','Sem categoria') AS name FROM public.financial_entries f WHERE company_id=$1 AND ($2='all' OR entry_type=$2) ORDER BY name", [req.company.company_id,type]);
        await client.query('COMMIT');
        return res.json({
          categories: categories.rows.map(row => row.name),
          entries: rows.rows,
          summary: summary.rows[0],
          pagination: {
            total: summary.rows[0].count,
            limit,
            offset
          }
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      next(error);
    }
  });
  router.get('/:id', async (req, res, next) => {
    if (!uuid.test(req.params.id)) return reject(res, 400, 'Despesa inválida.');
    try {
      const entry = await pool.query(`${selection} WHERE f.company_id=$1 AND f.id=$2 AND ($3='all' OR f.entry_type=$3)`, [req.company.company_id, req.params.id,fixedType]);
      if (!entry.rows.length) return reject(res, 404, 'Despesa não encontrada.');
      const payments = await pool.query('SELECT id,amount,payment_method,paid_at FROM public.financial_payments WHERE company_id=$1 AND entry_id=$2 ORDER BY paid_at DESC,created_at DESC', [req.company.company_id, req.params.id]);
      return res.json({
        entry: {
          ...entry.rows[0],
          payments: payments.rows
        }
      });
    } catch (error) {
      next(error);
    }
  });
  async function change(req, res, next, cancel, categoryOnly = false) {
    if (!uuid.test(req.params.id)) return reject(res, 400, 'Despesa inválida.');
    const b = req.body || {},
      stamp = Date.parse(b.expectedUpdatedAt);
    if (!Number.isFinite(stamp)) return reject(res, 400, 'Atualize os detalhes da despesa antes de continuar.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query("SELECT * FROM public.financial_entries WHERE company_id=$1 AND id=$2 AND ($3='all' OR entry_type=$3) FOR UPDATE", [req.company.company_id, req.params.id,fixedType]);
      const entry = result.rows[0];
      const abort = async (status, message) => {
        await client.query('ROLLBACK');
        return reject(res, status, message);
      };
      if (!entry) return await abort(404, 'Despesa não encontrada.');
      if (new Date(entry.updated_at).getTime() !== stamp) return await abort(409, 'Esta despesa foi alterada em outro aparelho. Atualize os dados antes de continuar.');
      if (categoryOnly) {
        const category = typeof b.expenseCategory === 'string' ? b.expenseCategory.trim().replace(/\s+/g, ' ') : '';
        if (category.length < 2 || category.length > 80) return await abort(400, 'Informe uma categoria de 2 a 80 caracteres.');
        const updated = await client.query("UPDATE public.financial_entries SET expense_category=$3,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE company_id=$1 AND id=$2 RETURNING *", [req.company.company_id, entry.id, category]);
        await client.query("INSERT INTO public.audit_logs(company_id,actor_subject,action,entity_type,entity_id,summary) VALUES($1,$2,'updated','financial_entry',$3,$4::jsonb)", [req.company.company_id, req.auth.subject, entry.id, JSON.stringify({
          title: entry.title,
          expenseCategory: category
        })]);
        await client.query('COMMIT');
        return res.json({
          entry: updated.rows[0]
        });
      }
      const payments = await client.query('SELECT id FROM public.financial_payments WHERE company_id=$1 AND entry_id=$2 LIMIT 1', [req.company.company_id, entry.id]);
      if (entry.source_type !== 'manual' || entry.sale_id || entry.source_id || entry.status !== 'pending' || payments.rows.length) return await abort(409, 'Somente despesas avulsas pendentes e sem pagamentos podem ser editadas ou canceladas. Compras e fretes são controlados na origem.');
      let updated;
      if (cancel) {
        if (b.confirmation !== entry.title) return await abort(400, 'Confirme a descrição exata da despesa para cancelar.');
        updated = await client.query("UPDATE public.financial_entries SET status='cancelled',updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE company_id=$1 AND id=$2 RETURNING *", [req.company.company_id, entry.id]);
      } else {
        const value = (key, fallback) => Object.hasOwn(b, key) ? b[key] : fallback;
        const expenseCategory = value('expenseCategory', entry.expense_category);
        const normalizedCategory = expenseCategory == null || expenseCategory === '' ? null : typeof expenseCategory === 'string' ? expenseCategory.trim().replace(/\s+/g, ' ') : false;
        if (normalizedCategory === false || normalizedCategory !== null && (normalizedCategory.length < 2 || normalizedCategory.length > 80)) return await abort(400, 'Informe uma categoria de 2 a 80 caracteres.');
        const title = value('title', entry.title),
          amount = money(value('amount', entry.amount)),
          competence = value('competenceDate', dateOnly(entry.competence_date)),
          due = value('dueDate', entry.due_date ? dateOnly(entry.due_date) : null) || null,
          activity = value('businessActivity', entry.business_activity),
          supplier = entry.entry_type==='expense'?(value('supplierId', entry.supplier_id) || null):null,
          customer = entry.entry_type==='income'?(value('customerId', entry.customer_id) || null):null,
          notes = value('notes', entry.notes || '');
        if (typeof title !== 'string' || title.trim().length < 2 || title.trim().length > 180 || amount === null || amount <= 0n || !validDate(competence) || due && !validDate(due) || !activities.slice(1).includes(activity) || supplier && !uuid.test(supplier) || customer && !uuid.test(customer) || typeof notes !== 'string' || notes.length > 3000) return await abort(400, 'Confira descrição, valor, datas, atividade e fornecedor.');
        if (supplier && !(await client.query('SELECT id FROM public.suppliers WHERE company_id=$1 AND id=$2 AND archived_at IS NULL', [req.company.company_id, supplier])).rows.length) return await abort(400, 'Fornecedor indisponível para esta empresa.');
        if(customer&&!(await client.query('SELECT id FROM public.customers WHERE company_id=$1 AND id=$2 AND archived_at IS NULL',[req.company.company_id,customer])).rows.length)return await abort(400,'Cliente indisponível para esta empresa.');
        updated = await client.query(`UPDATE public.financial_entries SET title=$3,amount=$4,competence_date=$5::date,due_date=$6::date,business_activity=$7,supplier_id=$8,notes=$9,expense_category=$10,customer_id=$11,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE company_id=$1 AND id=$2 RETURNING *`, [req.company.company_id, entry.id, title.trim(), moneyText(amount), competence, due, activity, supplier, notes.trim(), normalizedCategory,customer]);
      }
      await client.query("INSERT INTO public.audit_logs(company_id,actor_subject,action,entity_type,entity_id,summary) VALUES($1,$2,$3,'financial_entry',$4,$5::jsonb)", [req.company.company_id, req.auth.subject, cancel ? 'cancelled' : 'updated', entry.id, JSON.stringify({
        title: updated.rows[0].title
      })]);
      await client.query('COMMIT');
      return res.json({
        entry: updated.rows[0]
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error.code === '42703' && /expense_category/.test(error.message)) return reject(res, 503, 'A atualização de categorias precisa ser aplicada ao banco. Seus dados foram preservados.');
      next(error);
    } finally {
      client.release();
    }
  }
  router.patch('/:id/category', (req, res, next) => change(req, res, next, false, true).catch(next));
  router.patch('/:id', (req, res, next) => change(req, res, next, false).catch(next));
  router.post('/:id/cancel', (req, res, next) => change(req, res, next, true).catch(next));
  return router;
}
