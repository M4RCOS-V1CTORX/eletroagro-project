import {canAction} from '../../../../shared/access-policy.js';
import {createAgendaRouter} from './agenda.js';
import {operationLookups} from '../lib/lookups.js';
import {createExpensesRouter} from './expenses.js';
import { Router } from 'express';
import { activities,purchaseActivities } from '../lib/commercial.js';
import { randomUUID } from 'node:crypto';
import { idempotencyGuard, requireCompanyMembership } from '../middleware/neon-auth.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const paymentMethods = new Set(['pix', 'cash', 'card_debit', 'card_credit', 'transfer', 'boleto', 'other']);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
function validDate(value) { if (typeof value !== 'string' || !datePattern.test(value)) return false; const [year,month,day]=value.split('-').map(Number); const d=new Date(Date.UTC(year,month-1,day)); return d.getUTCFullYear()===year&&d.getUTCMonth()===month-1&&d.getUTCDate()===day; }
function money(value) {
  const text = String(value ?? '');
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
}
function moneyText(cents) { return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`; }
function quantity(value) {
  const text = String(value ?? '');
  if (!/^\d{1,9}(?:\.\d{1,3})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const n = BigInt(whole) * 1000n + BigInt((fraction + '000').slice(0, 3));
  return n > 0n && n <= 999_999_999_999n ? n : null;
}
function quantityText(millis) { return `${millis / 1000n}.${String(millis % 1000n).padStart(3, '0')}`.replace(/\.000$/, '').replace(/(\.\d*?)0+$/, '$1'); }
function shiftedDate(value, step, frequency = 'month') {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (frequency === 'week') date.setUTCDate(date.getUTCDate() + step * 7);
  else {
    const targetDay = date.getUTCDate();
    date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + step);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(targetDay, lastDay));
  }
  return date.toISOString().slice(0, 10);
}
export const operationsTestHelpers = { validDate, money, moneyText, quantity, quantityText, shiftedDate };
function fail(res, error, action) {
  console.error(`Falha ao ${action}:`, error.message);
  return res.status(500).json({ error: { code: 'OPERATION_FAILED', message: `Não foi possível ${action}.` } });
}
async function audit(db, companyId, actor, action, type, id, summary = {}) {
  await db.query(`INSERT INTO public.audit_logs (company_id, actor_subject, action, entity_type, entity_id, summary)
    VALUES ($1,$2,$3,$4,$5,$6::jsonb)`, [companyId, actor, action, type, id || null, JSON.stringify(summary)]);
}

export function createOperationsRouter({ pool, requireAuth, requireDatabase }) {
  const router = Router();
  router.use(requireAuth, requireDatabase(pool), requireCompanyMembership(pool));
  router.use((req, res, next) => {
    if (req.company.role === 'owner' || req.path === '/dashboard' || req.path==='/lookups'&&(req.company.permissions?.operations!==false||req.company.permissions?.finance!==false)) return next();
    const area = req.path.startsWith('/finance') || req.path.startsWith('/purchases') ? 'finance' : req.path.startsWith('/audit') ? 'audit' : 'operations';
    if (req.company.permissions?.[area] !== false) return next();
    return res.status(403).json({ error: { code: 'AREA_FORBIDDEN', message: 'Seu acesso não permite usar esta área.' } });
  });
  router.use(idempotencyGuard(pool));
  const companyId = (req) => req.company.company_id;
  const actor = (req) => req.auth.subject;
  router.use('/finance/expenses',createExpensesRouter({pool,validDate,money,moneyText}));
  router.use('/finance/accounts',createExpensesRouter({pool,validDate,money,moneyText,fixedType:'all'}));

  router.get('/lookups',async(req,res)=>{try{const access=Object.fromEntries(['commercial','operations','finance'].map(area=>[area,req.company.role==='owner'||req.company.permissions?.[area]!==false]));return res.json(await operationLookups(pool,companyId(req),access));}catch(error){return fail(res,error,'carregar as opções da operação');}});
  router.get('/dashboard', async (req, res) => {
    const access=Object.fromEntries(['commercial','finance','operations','audit'].map(area=>[area,req.company.role==='owner'||req.company.permissions?.[area]!==false]));
    const areaQuery=(module,...args)=>canAction(req.company,module)?pool.query(...args):Promise.resolve({rows:[]});
    const from = validDate(req.query.from) ? req.query.from : null;
    const to = validDate(req.query.to) ? req.query.to : null;
    try {
      const [quotes, sales, orders, finance, stock, upcoming, activity] = await Promise.all([
        areaQuery('quotes',`SELECT COUNT(*) FILTER (WHERE status IN ('draft','sent'))::int AS open,
          COUNT(*) FILTER (WHERE status='approved')::int AS approved,
          (SELECT COUNT(*)::int FROM public.quotes expired_quote WHERE expired_quote.company_id=$1 AND expired_quote.archived_at IS NULL AND expired_quote.status='sent' AND expired_quote.valid_until<CURRENT_DATE) AS expired
          FROM public.quotes WHERE company_id=$1 AND archived_at IS NULL AND ($2::date IS NULL OR issued_at::date >= $2) AND ($3::date IS NULL OR issued_at::date <= $3)`, [companyId(req), from, to]),
        areaQuery('sales',`SELECT COUNT(*)::int AS count, COALESCE(SUM(total),0)::text AS total,
          COALESCE(SUM(amount_paid),0)::text AS received, COALESCE(SUM(total-amount_paid),0)::text AS outstanding
          FROM public.sales WHERE company_id=$1 AND status='completed' AND ($2::date IS NULL OR sale_date >= $2) AND ($3::date IS NULL OR sale_date <= $3)`, [companyId(req), from, to]),
        areaQuery('orders',`SELECT COUNT(*) FILTER (WHERE status IN ('open','scheduled','in_progress','waiting_material'))::int AS active,
          COUNT(*) FILTER (WHERE due_date < CURRENT_DATE AND status NOT IN ('completed','cancelled'))::int AS overdue
          FROM public.service_orders WHERE company_id=$1`, [companyId(req)]),
        areaQuery('finance',`SELECT COALESCE(SUM(p.paid_in_period) FILTER (WHERE f.entry_type='income'),0)::text AS income,
          COALESCE(SUM(p.paid_in_period) FILTER (WHERE f.entry_type='expense'),0)::text AS expense,
          COALESCE(SUM(GREATEST(f.amount-COALESCE(p.paid,0),0)) FILTER(WHERE f.entry_type='income' AND f.status='pending'),0)::text AS receivable,
          COALESCE(SUM(GREATEST(f.amount-COALESCE(p.paid,0),0)) FILTER(WHERE f.entry_type='expense' AND f.status='pending'),0)::text AS payable,
          COUNT(*) FILTER(WHERE f.status='pending' AND f.due_date<CURRENT_DATE)::int AS overdue
          FROM public.financial_entries f LEFT JOIN LATERAL (
            SELECT SUM(amount) AS paid,SUM(amount) FILTER(WHERE ($2::date IS NULL OR paid_at >= $2) AND ($3::date IS NULL OR paid_at <= $3)) AS paid_in_period
            FROM public.financial_payments WHERE company_id=f.company_id AND entry_id=f.id
          ) p ON true WHERE f.company_id=$1`, [companyId(req), from, to]),
        areaQuery('stock',`SELECT COUNT(*)::int AS low_count FROM (
          SELECT c.id FROM public.catalog_items c LEFT JOIN public.stock_movements m ON m.company_id=c.company_id AND m.catalog_item_id=c.id
          WHERE c.company_id=$1 AND c.item_type='product' AND c.is_active AND c.archived_at IS NULL AND c.minimum_stock>0
          GROUP BY c.id,c.minimum_stock HAVING COALESCE(SUM(CASE WHEN m.direction='in' THEN m.quantity ELSE -m.quantity END),0)<=c.minimum_stock
        ) low_stock`,[companyId(req)]),
        areaQuery('agenda',`SELECT id,title,starts_at,address FROM public.appointments WHERE company_id=$1 AND status='scheduled' AND starts_at >= now() ORDER BY starts_at LIMIT 5`, [companyId(req)]),
        areaQuery('audit',`SELECT id, action, entity_type, entity_id, summary, created_at FROM public.audit_logs WHERE company_id=$1 ORDER BY created_at DESC LIMIT 6`, [companyId(req)]),
      ]);
      return res.json({ access, quotes: quotes.rows[0] || null, sales: sales.rows[0] || null, orders: orders.rows[0] || null, finance: finance.rows[0] || null, stock: stock.rows[0] || null, upcoming: upcoming.rows, activity: activity.rows });
    } catch (error) { return fail(res, error, 'carregar o painel'); }
  });

  router.get('/finance', async (req, res) => {
    const activity=activities.has(req.query.activity)?req.query.activity:'all';
    const type = ['income','expense','all'].includes(req.query.type) ? req.query.type : 'all';
    const status = ['pending','settled','cancelled','all'].includes(req.query.status) ? req.query.status : 'all';
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0,100) : '';
    const from = validDate(req.query.from) ? req.query.from : null;
    const to = validDate(req.query.to) ? req.query.to : null;
    try {
      const result = await pool.query(`SELECT f.*, COALESCE(p.paid,0)::text AS amount_paid,
        GREATEST(f.amount-COALESCE(p.paid,0),0)::text AS balance,
        (f.status='pending' AND f.due_date < CURRENT_DATE) AS overdue,
        c.name AS customer_name, s.name AS supplier_name
        FROM public.financial_entries f
        LEFT JOIN LATERAL (SELECT SUM(amount) AS paid FROM public.financial_payments WHERE company_id=f.company_id AND entry_id=f.id) p ON true
        LEFT JOIN public.customers c ON c.company_id=f.company_id AND c.id=f.customer_id
        LEFT JOIN public.suppliers s ON s.company_id=f.company_id AND s.id=f.supplier_id
        WHERE f.company_id=$1 AND ($7='all' OR f.business_activity=$7) AND ($2='all' OR f.entry_type=$2) AND ($3='all' OR f.status=$3)
          AND ($4='' OR f.title ILIKE '%'||$4||'%' OR c.name ILIKE '%'||$4||'%' OR s.name ILIKE '%'||$4||'%')
          AND ($5::date IS NULL OR COALESCE(f.due_date,f.competence_date) >= $5)
          AND ($6::date IS NULL OR COALESCE(f.due_date,f.competence_date) <= $6)
        ORDER BY (f.status='pending' AND f.due_date < CURRENT_DATE) DESC, COALESCE(f.due_date,f.competence_date), f.created_at DESC LIMIT 200`, [companyId(req),type,status,q,from,to,activity]);
      const summary = await pool.query(`SELECT
        COALESCE(SUM(p.paid_in_period) FILTER (WHERE f.entry_type='income'),0)::text AS income,
        COALESCE(SUM(p.paid_in_period) FILTER (WHERE f.entry_type='expense'),0)::text AS expense,
        COALESCE(SUM(GREATEST(f.amount-COALESCE(p.paid,0),0)) FILTER (WHERE f.entry_type='income' AND f.status='pending' AND ($2::date IS NULL OR COALESCE(f.due_date,f.competence_date) >= $2) AND ($3::date IS NULL OR COALESCE(f.due_date,f.competence_date) <= $3)),0)::text AS receivable,
        COALESCE(SUM(GREATEST(f.amount-COALESCE(p.paid,0),0)) FILTER (WHERE f.entry_type='expense' AND f.status='pending' AND ($2::date IS NULL OR COALESCE(f.due_date,f.competence_date) >= $2) AND ($3::date IS NULL OR COALESCE(f.due_date,f.competence_date) <= $3)),0)::text AS payable,
        COUNT(*) FILTER (WHERE f.status='pending' AND f.due_date < CURRENT_DATE AND ($2::date IS NULL OR COALESCE(f.due_date,f.competence_date) >= $2) AND ($3::date IS NULL OR COALESCE(f.due_date,f.competence_date) <= $3))::int AS overdue_count
        FROM public.financial_entries f LEFT JOIN LATERAL (
          SELECT SUM(amount) AS paid, SUM(amount) FILTER (WHERE ($2::date IS NULL OR paid_at >= $2) AND ($3::date IS NULL OR paid_at <= $3)) AS paid_in_period
          FROM public.financial_payments WHERE company_id=f.company_id AND entry_id=f.id
        ) p ON true
        WHERE f.company_id=$1 AND ($4='all' OR f.business_activity=$4)`, [companyId(req),from,to,activity]);
      return res.json({ entries: result.rows, summary: summary.rows[0] });
    } catch (error) { return fail(res,error,'consultar o financeiro'); }
  });

  router.post('/finance', async (req,res) => {
    const body=req.body||{}; if(!activities.has(body.businessActivity??'unassigned'))return res.status(400).json({error:{message:'Selecione uma atividade válida.'}}); const type=body.entryType; const title=typeof body.title==='string'?body.title.trim():'';
    const amount=money(body.amount); const status=body.status==='settled'?'settled':'pending';
    body.expenseCategory??=body.category;
    const expenseCategory=body.expenseCategory==null||body.expenseCategory===''?null:typeof body.expenseCategory==='string'?body.expenseCategory.trim().replace(/\s+/g,' '):false;
    if(expenseCategory===false||expenseCategory!==null&&(expenseCategory.length<2||expenseCategory.length>80))return res.status(400).json({error:{code:'INVALID_EXPENSE_CATEGORY',message:'Informe uma categoria de 2 a 80 caracteres.'}});
    if(!['income','expense'].includes(type)||title.length<2||title.length>180||amount===null||amount<=0n) return res.status(400).json({error:{code:'INVALID_FINANCIAL_ENTRY',message:'Confira o tipo, a descrição e o valor do lançamento.'}});
    if(body.dueDate&&!validDate(body.dueDate)||body.competenceDate&&!validDate(body.competenceDate)) return res.status(400).json({error:{code:'INVALID_FINANCIAL_DATE',message:'Confira as datas informadas.'}});
    if(status==='settled'&&!paymentMethods.has(body.paymentMethod)) return res.status(400).json({error:{code:'INVALID_PAYMENT_METHOD',message:'Selecione uma forma de pagamento válida.'}});
    const scheduleMode=['single','installments','recurring'].includes(body.scheduleMode)?body.scheduleMode:'single';
    const requestedCount=scheduleMode==='single'?1:Number(body.scheduleCount);
    if(!Number.isInteger(requestedCount)||requestedCount<1||requestedCount>120||status==='settled'&&requestedCount>1)return res.status(400).json({error:{code:'INVALID_FINANCIAL_SCHEDULE',message:'Use de 1 a 120 parcelas/recorrências e deixe lançamentos múltiplos como pendentes.'}});
    const frequency=body.scheduleFrequency==='week'?'week':'month';
    if(scheduleMode==='installments'&&amount<BigInt(requestedCount))return res.status(400).json({error:{code:'INSTALLMENT_TOO_SMALL',message:'O valor deve permitir ao menos um centavo por parcela.'}});
    const recurrenceGroup=requestedCount>1?randomUUID():null;
    const withExpenseCategory=expenseCategory!==null;
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      const entries=[];let financialPaymentId=null;
      for(let index=0;index<requestedCount;index+=1){
        const entryAmount=scheduleMode==='installments'?(amount/BigInt(requestedCount)+(index<Number(amount%BigInt(requestedCount))?1n:0n)):amount;
        const entryTitle=requestedCount>1?`${title} · ${index+1}/${requestedCount}`:title;
        const competenceDate=shiftedDate(body.competenceDate||new Date().toISOString().slice(0,10),index,frequency);
        const dueDate=body.dueDate?shiftedDate(body.dueDate,index,frequency):null;
        const result=await client.query(`INSERT INTO public.financial_entries(company_id,entry_type,title,amount,competence_date,due_date,settled_at,status,payment_method,customer_id,supplier_id,notes,created_by_subject,recurrence_group,installment_number,installment_count,business_activity${withExpenseCategory?',expense_category':''})
          VALUES($1,$2,$3,$4,$5::date,$6::date,CASE WHEN $7='settled' THEN COALESCE($8::date,CURRENT_DATE) END,$7,$9,$10,$11,$12,$13,$14,$15,$16,$17${withExpenseCategory?',$18':''}) RETURNING *`,[companyId(req),type,entryTitle,moneyText(entryAmount),competenceDate,dueDate,status,body.settledAt||null,status==='settled'?body.paymentMethod:null,type==='income'&&uuidPattern.test(body.customerId||'')?body.customerId:null,type==='expense'&&uuidPattern.test(body.supplierId||'')?body.supplierId:null,typeof body.notes==='string'?body.notes.trim().slice(0,3000):null,actor(req),recurrenceGroup,requestedCount>1?index+1:null,requestedCount>1?requestedCount:null,body.businessActivity??'unassigned',...(withExpenseCategory?[expenseCategory]:[])]);
        entries.push(result.rows[0]);
        if(status==='settled') {const initialPayment=await client.query(`INSERT INTO public.financial_payments(company_id,entry_id,amount,payment_method,paid_at,created_by_subject) VALUES($1,$2,$3,$4,COALESCE($5::date,CURRENT_DATE),$6) RETURNING id`,[companyId(req),result.rows[0].id,moneyText(entryAmount),body.paymentMethod,body.settledAt||null,actor(req)]);financialPaymentId=initialPayment.rows[0].id;}
      }
      await audit(client,companyId(req),actor(req),'created', 'financial_entry',entries[0].id,{entryType:type,title,amount:moneyText(amount),scheduleMode,count:requestedCount});
      await client.query('COMMIT'); return res.status(201).json({entry:entries[0],entries,financialPaymentId});
    } catch(error) { await client.query('ROLLBACK').catch(()=>{}); if(error.code==='42703'&&/expense_category/.test(error.message))return res.status(503).json({error:{code:'EXPENSE_MIGRATION_REQUIRED',message:'A atualização de categorias precisa ser aplicada ao banco. Seus dados foram preservados.'}}); if(error.code==='23503')return res.status(400).json({error:{code:'INVALID_RELATED_RECORD',message:'Cliente ou fornecedor não encontrado.'}}); return fail(res,error,'registrar o lançamento'); }
    finally {client.release();}
  });

  router.post('/finance/:id/payments', async (req,res) => {
    if(!uuidPattern.test(req.params.id))return res.status(400).json({error:{code:'INVALID_ID',message:'Lançamento inválido.'}});
    const amount=money(req.body?.amount); const method=req.body?.paymentMethod; const paidAt=req.body?.paidAt||null;
    if(amount===null||amount<=0n||!paymentMethods.has(method)||paidAt&&!validDate(paidAt))return res.status(400).json({error:{code:'INVALID_PAYMENT',message:'Confira o valor, a forma e a data do pagamento.'}});
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      const linked=await client.query('SELECT sale_id FROM public.financial_entries WHERE company_id=$1 AND id=$2',[companyId(req),req.params.id]);
      if(linked.rows[0]?.sale_id) await client.query('SELECT id FROM public.sales WHERE company_id=$1 AND id=$2 FOR UPDATE',[companyId(req),linked.rows[0].sale_id]);
      const entry=await client.query(`SELECT * FROM public.financial_entries WHERE company_id=$1 AND id=$2 AND status='pending' FOR UPDATE`,[companyId(req),req.params.id]);
      if(!entry.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:{code:'ENTRY_NOT_OPEN',message:'Lançamento não encontrado ou já encerrado.'}});}
      const existing=await client.query('SELECT COALESCE(SUM(amount),0)::numeric(12,2)::text AS paid FROM public.financial_payments WHERE company_id=$1 AND entry_id=$2',[companyId(req),req.params.id]);
      const paid=money(existing.rows[0].paid)||0n; const total=money(entry.rows[0].amount);
      if(paid+amount>total){await client.query('ROLLBACK');return res.status(400).json({error:{code:'PAYMENT_EXCEEDS_BALANCE',message:'O valor supera o saldo em aberto.'}});}
      const paymentResult=await client.query(`INSERT INTO public.financial_payments(company_id,entry_id,amount,payment_method,paid_at,created_by_subject) VALUES($1,$2,$3,$4,COALESCE($5::date,CURRENT_DATE),$6) RETURNING id`,[companyId(req),req.params.id,moneyText(amount),method,paidAt,actor(req)]);
      if(entry.rows[0].source_type==='sale' && entry.rows[0].entry_type==='income') {
        const sale=await client.query(`SELECT id,total,amount_paid,status FROM public.sales WHERE company_id=$1 AND id=$2`,[companyId(req),entry.rows[0].sale_id]);
        if(!sale.rowCount || sale.rows[0].status!=='completed' || money(sale.rows[0].amount_paid)+amount>money(sale.rows[0].total)) {
          await client.query('ROLLBACK'); return res.status(409).json({error:{message:'O saldo da venda mudou. Atualize a tela antes de receber.'}});
        }
        await client.query(`INSERT INTO public.sale_payments(company_id,sale_id,payment_method,amount,received_date,created_by_subject) VALUES($1,$2,$3,$4,COALESCE($5::date,CURRENT_DATE),$6)`,[companyId(req),sale.rows[0].id,method,moneyText(amount),paidAt,actor(req)]);
        await client.query(`UPDATE public.sales SET amount_paid=amount_paid+$3::numeric,payment_status=CASE WHEN amount_paid+$3::numeric=total THEN 'paid' ELSE 'partial' END,updated_at=now() WHERE company_id=$1 AND id=$2`,[companyId(req),sale.rows[0].id,moneyText(amount)]);
      }
      const settled=paid+amount===total;
      await client.query(`UPDATE public.financial_entries SET status=CASE WHEN $3 THEN 'settled' ELSE 'pending' END, settled_at=CASE WHEN $3 THEN COALESCE($4::date,CURRENT_DATE) ELSE NULL END, payment_method=$5, updated_at=now() WHERE company_id=$1 AND id=$2`,[companyId(req),req.params.id,settled,paidAt,method]);
      await audit(client,companyId(req),actor(req),'payment_recorded','financial_entry',req.params.id,{amount:moneyText(amount),paymentMethod:method});
      await client.query('COMMIT'); return res.status(201).json({paid:moneyText(paid+amount),balance:moneyText(total-paid-amount),settled,paymentId:paymentResult.rows[0].id});
    }catch(error){await client.query('ROLLBACK').catch(()=>{});return fail(res,error,'registrar o pagamento');}finally{client.release();}
  });

  router.get('/service-orders', async(req,res)=>{
    const status=req.query.status||'all'; const q=typeof req.query.q==='string'?req.query.q.trim().slice(0,100):'';
    try{const result=await pool.query(`SELECT so.id,so.order_number,so.customer_name,so.title,so.status,so.priority,so.scheduled_at,so.due_date,so.responsible_name,so.estimated_total,q.quote_number,s.sale_number,s.sale_year,(so.due_date<CURRENT_DATE AND so.status NOT IN ('completed','cancelled')) AS overdue FROM public.service_orders so LEFT JOIN public.quotes q ON q.company_id=so.company_id AND q.id=so.quote_id LEFT JOIN public.sales s ON s.company_id=so.company_id AND s.id=so.sale_id WHERE so.company_id=$1 AND ($2='all' OR so.status=$2) AND ($3='' OR so.customer_name ILIKE '%'||$3||'%' OR so.title ILIKE '%'||$3||'%' OR so.order_number::text ILIKE '%'||$3||'%') ORDER BY (so.due_date<CURRENT_DATE AND so.status NOT IN ('completed','cancelled')) DESC,COALESCE(so.scheduled_at::date,so.due_date,CURRENT_DATE),so.order_number DESC LIMIT 200`,[companyId(req),status,q]);return res.json({orders:result.rows});}catch(error){return fail(res,error,'consultar as ordens de serviço');}
  });

  router.get('/service-order-sources',async(req,res)=>{try{const [quotes,sales]=await Promise.all([pool.query(`SELECT q.id,q.quote_number,q.customer_id,q.customer_name,q.total FROM public.quotes q WHERE q.company_id=$1 AND q.status='approved' AND q.archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.service_orders so WHERE so.company_id=q.company_id AND so.quote_id=q.id) ORDER BY q.approved_at DESC NULLS LAST LIMIT 100`,[companyId(req)]),pool.query(`SELECT s.id,s.sale_number,s.sale_year,s.sale_date,s.customer_id,s.customer_name,s.total FROM public.sales s WHERE s.company_id=$1 AND s.status='completed' AND NOT EXISTS(SELECT 1 FROM public.service_orders so WHERE so.company_id=s.company_id AND so.sale_id=s.id) ORDER BY s.sale_date DESC,s.sale_number DESC LIMIT 100`,[companyId(req)])]);return res.json({quotes:quotes.rows,sales:sales.rows});}catch(error){return fail(res,error,'listar documentos disponíveis para ordem de serviço');}});

  router.post('/service-orders',async(req,res)=>{
    const b=req.body||{};const quoteId=typeof b.quoteId==='string'&&uuidPattern.test(b.quoteId)?b.quoteId:null;const saleId=typeof b.saleId==='string'&&uuidPattern.test(b.saleId)?b.saleId:null;
    if(b.quoteId&&!quoteId||b.saleId&&!saleId||quoteId&&saleId||b.dueDate&&!validDate(b.dueDate)||b.scheduledAt&&Number.isNaN(Date.parse(b.scheduledAt)))return res.status(400).json({error:{code:'INVALID_SERVICE_ORDER',message:'Confira o orçamento ou venda de origem e as datas informadas.'}});
    const client=await pool.connect();try{await client.query('BEGIN');let customerId=typeof b.customerId==='string'&&uuidPattern.test(b.customerId)?b.customerId:null;let customerName='';let source=null;
      if(quoteId){const r=await client.query(`SELECT customer_id,customer_name,total,notes,terms,quote_number FROM public.quotes WHERE company_id=$1 AND id=$2 AND status='approved' AND archived_at IS NULL`,[companyId(req),quoteId]);if(!r.rowCount){await client.query('ROLLBACK');return res.status(400).json({error:{code:'QUOTE_UNAVAILABLE',message:'Selecione um orçamento aprovado e ativo.'}});}source=r.rows[0];customerId=source.customer_id;customerName=source.customer_name;}
      else if(saleId){const r=await client.query(`SELECT customer_id,customer_name,total,notes,sale_number FROM public.sales WHERE company_id=$1 AND id=$2 AND status='completed'`,[companyId(req),saleId]);if(!r.rowCount){await client.query('ROLLBACK');return res.status(400).json({error:{code:'SALE_UNAVAILABLE',message:'Selecione uma venda concluída.'}});}source=r.rows[0];customerId=source.customer_id;customerName=source.customer_name;}
      else if(customerId){const r=await client.query('SELECT id,name FROM public.customers WHERE company_id=$1 AND id=$2 AND archived_at IS NULL',[companyId(req),customerId]);if(r.rowCount)customerName=r.rows[0].name;}
      if(!customerId||!customerName){await client.query('ROLLBACK');return res.status(400).json({error:{code:'CUSTOMER_UNAVAILABLE',message:'Selecione um cliente disponível.'}});}
      const title=typeof b.title==='string'&&b.title.trim().length>=2?b.title.trim().slice(0,180):source?`Serviço ${quoteId?'do orçamento':'da venda'} #${String(quoteId?source.quote_number:source.sale_number).padStart(4,'0')}`:'';
      const total=money(b.estimatedTotal||source?.total||'0');if(title.length<2||total===null){await client.query('ROLLBACK');return res.status(400).json({error:{code:'INVALID_SERVICE_ORDER',message:'Informe uma descrição e um valor válido para o serviço.'}});}
      const counter=await client.query(`INSERT INTO public.document_counters(company_id,document_type,last_number) VALUES($1,'service_order',1) ON CONFLICT(company_id,document_type) DO UPDATE SET last_number=public.document_counters.last_number+1 RETURNING last_number`,[companyId(req)]);
      const result=await client.query(`INSERT INTO public.service_orders(company_id,order_number,customer_id,quote_id,sale_id,customer_name,title,description,service_address,status,priority,due_date,scheduled_at,responsible_name,estimated_total,notes,created_by_subject) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'open',$10,$11::date,$12::timestamptz,$13,$14,$15,$16) RETURNING *`,[companyId(req),counter.rows[0].last_number,customerId,quoteId,saleId,customerName,title,String(b.description||source?.terms||'').slice(0,5000),String(b.serviceAddress||'').slice(0,500),['low','normal','high','urgent'].includes(b.priority)?b.priority:'normal',b.dueDate||null,b.scheduledAt||null,String(b.responsibleName||'').slice(0,120),moneyText(total),String(b.notes||source?.notes||'').slice(0,3000),actor(req)]);
      await audit(client,companyId(req),actor(req),'created','service_order',result.rows[0].id,{orderNumber:result.rows[0].order_number,title});await client.query('COMMIT');return res.status(201).json({order:result.rows[0]});
    }catch(error){await client.query('ROLLBACK').catch(()=>{});if(error.code==='23505')return res.status(409).json({error:{code:'SERVICE_ORDER_ALREADY_EXISTS',message:'Já existe uma ordem de serviço para esse orçamento ou venda.'}});return fail(res,error,'criar a ordem de serviço');}finally{client.release();}
  });

  router.get('/service-orders/:id',async(req,res)=>{if(!uuidPattern.test(req.params.id))return res.status(400).json({error:{code:'INVALID_ORDER_ID',message:'Ordem de serviço inválida.'}});try{const result=await pool.query(`SELECT so.*,q.quote_number,s.sale_number,s.sale_year FROM public.service_orders so LEFT JOIN public.quotes q ON q.company_id=so.company_id AND q.id=so.quote_id LEFT JOIN public.sales s ON s.company_id=so.company_id AND s.id=so.sale_id WHERE so.company_id=$1 AND so.id=$2`,[companyId(req),req.params.id]);if(!result.rowCount)return res.status(404).json({error:{code:'ORDER_NOT_FOUND',message:'Ordem de serviço não encontrada.'}});const [items,activity]=await Promise.all([pool.query('SELECT id,name,unit,quantity FROM public.service_order_items WHERE company_id=$1 AND order_id=$2 ORDER BY created_at',[companyId(req),req.params.id]),pool.query(`SELECT action,summary,created_at FROM public.audit_logs WHERE company_id=$1 AND entity_type='service_order' AND entity_id=$2 ORDER BY created_at DESC LIMIT 20`,[companyId(req),req.params.id])]);return res.json({order:{...result.rows[0],items:items.rows,activity:activity.rows}});}catch(error){return fail(res,error,'consultar os detalhes da ordem');}});

  router.post('/service-orders/:id/materials',async(req,res)=>{if(!uuidPattern.test(req.params.id)||!uuidPattern.test(req.body?.catalogItemId||''))return res.status(400).json({error:{code:'INVALID_ORDER_MATERIAL',message:'Selecione uma ordem e um produto válidos.'}});const qty=quantity(req.body?.quantity);if(qty===null)return res.status(400).json({error:{code:'INVALID_MATERIAL_QUANTITY',message:'Informe uma quantidade válida.'}});const client=await pool.connect();try{await client.query('BEGIN');const order=await client.query(`SELECT id,order_number,status FROM public.service_orders WHERE company_id=$1 AND id=$2 FOR UPDATE`,[companyId(req),req.params.id]);if(!order.rowCount||['completed','cancelled'].includes(order.rows[0].status)){await client.query('ROLLBACK');return res.status(409).json({error:{code:'ORDER_NOT_ACTIVE',message:'A ordem precisa estar ativa para registrar materiais.'}});}await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[companyId(req),req.body.catalogItemId]);const item=await client.query(`SELECT id,name,unit FROM public.catalog_items WHERE company_id=$1 AND id=$2 AND item_type='product' AND is_active AND archived_at IS NULL`,[companyId(req),req.body.catalogItemId]);if(!item.rowCount){await client.query('ROLLBACK');return res.status(400).json({error:{code:'PRODUCT_UNAVAILABLE',message:'Produto não encontrado ou inativo.'}});}const balance=await client.query(`SELECT COALESCE(SUM(CASE WHEN direction='in' THEN quantity ELSE -quantity END),0)::numeric(12,3)::text AS stock FROM public.stock_movements WHERE company_id=$1 AND catalog_item_id=$2`,[companyId(req),req.body.catalogItemId]);if((quantity(balance.rows[0].stock)||0n)<qty){await client.query('ROLLBACK');return res.status(409).json({error:{code:'INSUFFICIENT_STOCK',message:'O estoque disponível não cobre o material informado.'}});}const detail=String(req.body?.notes||'').trim().slice(0,180);const itemLabel=detail?`${item.rows[0].name} · ${detail}`:item.rows[0].name;const line=await client.query(`INSERT INTO public.service_order_items(company_id,order_id,catalog_item_id,name,unit,quantity) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[companyId(req),req.params.id,item.rows[0].id,itemLabel,item.rows[0].unit,quantityText(qty)]);await client.query(`INSERT INTO public.stock_movements(company_id,catalog_item_id,direction,quantity,reason,source_type,source_id,created_by_subject) VALUES($1,$2,'out',$3,$4,'service_order',$5,$6)`,[companyId(req),item.rows[0].id,quantityText(qty),`Material da OS #${String(order.rows[0].order_number).padStart(4,'0')}`,req.params.id,actor(req)]);await audit(client,companyId(req),actor(req),'material_used','service_order',req.params.id,{item:item.rows[0].name,quantity:quantityText(qty)});await client.query('COMMIT');return res.status(201).json({item:line.rows[0]});}catch(error){await client.query('ROLLBACK').catch(()=>{});return fail(res,error,'registrar o material usado');}finally{client.release();}});

  router.patch('/service-orders/:id/status',async(req,res)=>{
    const allowed=new Set(['open','scheduled','in_progress','waiting_material','completed','cancelled']);if(!uuidPattern.test(req.params.id)||!allowed.has(req.body?.status))return res.status(400).json({error:{code:'INVALID_ORDER_STATUS',message:'Selecione uma situação válida.'}});
    try{const result=await pool.query(`UPDATE public.service_orders SET status=$3,completed_at=CASE WHEN $3='completed' THEN now() WHEN status='completed' THEN NULL ELSE completed_at END,updated_at=now() WHERE company_id=$1 AND id=$2 RETURNING id,order_number,status,completed_at`,[companyId(req),req.params.id,req.body.status]);if(!result.rowCount)return res.status(404).json({error:{code:'ORDER_NOT_FOUND',message:'Ordem de serviço não encontrada.'}});await audit(pool,companyId(req),actor(req),'status_changed','service_order',req.params.id,{status:req.body.status});return res.json({order:result.rows[0]});}catch(error){return fail(res,error,'atualizar a ordem de serviço');}
  });

  router.use('/appointments',createAgendaRouter({pool}));
  router.get('/appointments',async(req,res)=>{const from=validDate(req.query.from)?req.query.from:null;const to=validDate(req.query.to)?req.query.to:null;try{const result=await pool.query(`SELECT a.*,c.name AS customer_name,so.order_number FROM public.appointments a LEFT JOIN public.customers c ON c.company_id=a.company_id AND c.id=a.customer_id LEFT JOIN public.service_orders so ON so.company_id=a.company_id AND so.id=a.service_order_id WHERE a.company_id=$1 AND a.deleted_at IS NULL AND ($2::date IS NULL OR (a.starts_at AT TIME ZONE 'America/Bahia')::date >= $2) AND ($3::date IS NULL OR (a.starts_at AT TIME ZONE 'America/Bahia')::date <= $3) ORDER BY a.starts_at LIMIT 300`,[companyId(req),from,to]);return res.json({appointments:result.rows});}catch(error){return fail(res,error,'consultar a agenda');}});

  router.post('/appointments',async(req,res)=>{const b=req.body||{};const title=typeof b.title==='string'?b.title.trim():'';if(title.length<2||title.length>180||!b.startsAt||Number.isNaN(Date.parse(b.startsAt))||b.endsAt&&(Number.isNaN(Date.parse(b.endsAt))||Date.parse(b.endsAt)<=Date.parse(b.startsAt)))return res.status(400).json({error:{code:'INVALID_APPOINTMENT',message:'Informe título e horários válidos.'}});try{const result=await pool.query(`INSERT INTO public.appointments(company_id,customer_id,service_order_id,title,starts_at,ends_at,address,notes,created_by_subject) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[companyId(req),uuidPattern.test(b.customerId||'')?b.customerId:null,uuidPattern.test(b.serviceOrderId||'')?b.serviceOrderId:null,title,b.startsAt,b.endsAt||null,String(b.address||'').slice(0,500),String(b.notes||'').slice(0,3000),actor(req)]);await audit(pool,companyId(req),actor(req),'created','appointment',result.rows[0].id,{title});return res.status(201).json({appointment:result.rows[0]});}catch(error){return fail(res,error,'agendar o compromisso');}});

  router.patch('/appointments/:id/status',async(req,res)=>{if(!uuidPattern.test(req.params.id)||!['scheduled','completed','cancelled'].includes(req.body?.status))return res.status(400).json({error:{code:'INVALID_APPOINTMENT_STATUS',message:'Situação inválida.'}});try{const result=await pool.query('UPDATE public.appointments SET status=$3,updated_at=now() WHERE company_id=$1 AND id=$2 RETURNING *',[companyId(req),req.params.id,req.body.status]);if(!result.rowCount)return res.status(404).json({error:{code:'APPOINTMENT_NOT_FOUND',message:'Compromisso não encontrado.'}});await audit(pool,companyId(req),actor(req),'status_changed','appointment',req.params.id,{status:req.body.status});return res.json({appointment:result.rows[0]});}catch(error){return fail(res,error,'atualizar o compromisso');}});

  router.get('/stock',async(req,res)=>{const q=typeof req.query.q==='string'?req.query.q.trim().slice(0,100):'';try{const result=await pool.query(`SELECT c.id,c.code,c.name,c.unit,c.minimum_stock,COALESCE(SUM(CASE WHEN m.direction='in' THEN m.quantity WHEN m.direction='out' THEN -m.quantity ELSE m.quantity-COALESCE((SELECT SUM(CASE WHEN m2.direction='in' THEN m2.quantity WHEN m2.direction='out' THEN -m2.quantity ELSE m2.quantity END) FROM public.stock_movements m2 WHERE m2.company_id=m.company_id AND m2.catalog_item_id=m.catalog_item_id AND m2.created_at<m.created_at),0) END),0)::numeric(12,3)::text AS stock FROM public.catalog_items c LEFT JOIN public.stock_movements m ON m.company_id=c.company_id AND m.catalog_item_id=c.id WHERE c.company_id=$1 AND c.item_type='product' AND c.is_active AND c.archived_at IS NULL AND ($2='' OR c.name ILIKE '%'||$2||'%' OR COALESCE(c.code,'') ILIKE '%'||$2||'%') GROUP BY c.id ORDER BY c.name LIMIT 250`,[companyId(req),q]);const movements=await pool.query(`SELECT m.id,m.direction,m.quantity,m.reason,m.unit_cost,m.created_at,c.name AS item_name,c.unit FROM public.stock_movements m JOIN public.catalog_items c ON c.company_id=m.company_id AND c.id=m.catalog_item_id WHERE m.company_id=$1 ORDER BY m.created_at DESC LIMIT 30`,[companyId(req)]);return res.json({items:result.rows,movements:movements.rows});}catch(error){return fail(res,error,'consultar o estoque');}});

  router.post('/stock/movements',async(req,res)=>{const b=req.body||{};const qty=quantity(b.quantity);const direction=b.direction;const cost=b.unitCost===''||b.unitCost==null?null:money(b.unitCost);if(!uuidPattern.test(b.catalogItemId||'')||!['in','out'].includes(direction)||qty===null||!String(b.reason||'').trim()||cost===null&&b.unitCost!=null&&b.unitCost!=='')return res.status(400).json({error:{code:'INVALID_STOCK_MOVEMENT',message:'Confira item, quantidade, tipo e motivo da movimentação.'}});const client=await pool.connect();try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[companyId(req),b.catalogItemId]);const item=await client.query(`SELECT id FROM public.catalog_items WHERE company_id=$1 AND id=$2 AND item_type='product' AND is_active AND archived_at IS NULL`,[companyId(req),b.catalogItemId]);if(!item.rowCount){await client.query('ROLLBACK');return res.status(400).json({error:{code:'PRODUCT_UNAVAILABLE',message:'Produto não encontrado ou inativo.'}});}const balance=await client.query(`SELECT COALESCE(SUM(CASE WHEN direction='in' THEN quantity WHEN direction='out' THEN -quantity ELSE 0 END),0)::numeric(12,3)::text AS stock FROM public.stock_movements WHERE company_id=$1 AND catalog_item_id=$2`,[companyId(req),b.catalogItemId]);if(direction==='out'&&(quantity(balance.rows[0].stock)||0n)<qty){await client.query('ROLLBACK');return res.status(409).json({error:{code:'INSUFFICIENT_STOCK',message:'A saída supera o saldo disponível.'}});}const result=await client.query(`INSERT INTO public.stock_movements(company_id,catalog_item_id,direction,quantity,unit_cost,reason,created_by_subject) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[companyId(req),b.catalogItemId,direction,quantityText(qty),cost===null?null:moneyText(cost),String(b.reason).trim().slice(0,300),actor(req)]);await audit(client,companyId(req),actor(req),'stock_movement','catalog_item',b.catalogItemId,{direction,quantity:quantityText(qty),reason:String(b.reason).trim().slice(0,150)});await client.query('COMMIT');return res.status(201).json({movement:result.rows[0]});}catch(error){await client.query('ROLLBACK').catch(()=>{});return fail(res,error,'registrar a movimentação');}finally{client.release();}});

  router.get('/purchases',async(req,res)=>{
    const activity=activities.has(req.query.activity)?req.query.activity:'all';
    try { const result=await pool.query(`SELECT p.*,s.name AS supplier_name FROM public.purchases p LEFT JOIN public.suppliers s ON s.company_id=p.company_id AND s.id=p.supplier_id WHERE p.company_id=$1 AND ($2='all' OR p.business_activity=$2) ORDER BY p.purchase_date DESC,p.created_at DESC LIMIT 50`,[companyId(req),activity]);return res.json({purchases:result.rows}); }
    catch(error){return fail(res,error,'listar compras');}
  });
  router.post('/purchases',async(req,res)=>{
    if(!purchaseActivities.has(req.body?.businessActivity??'unassigned'))return res.status(400).json({error:{message:'Selecione uma atividade válida.'}});
    const b=req.body||{};const items=Array.isArray(b.items)?b.items:[];const supplierId=uuidPattern.test(b.supplierId||'')?b.supplierId:null;
    if(items.length<1||items.length>100||b.purchaseDate&&!validDate(b.purchaseDate)||b.dueDate&&!validDate(b.dueDate))return res.status(400).json({error:{code:'INVALID_PURCHASE',message:'Informe itens e datas válidos para a compra.'}});
    const parsed=[];let total=0n;
    for(const item of items){const qty=quantity(item?.quantity);const cost=money(item?.unitCost);if(!uuidPattern.test(item?.catalogItemId||'')||qty===null||cost===null){return res.status(400).json({error:{code:'INVALID_PURCHASE_ITEM',message:'Confira os produtos, quantidades e custos.'}});}const line=(cost*qty+500n)/1000n;total+=line;parsed.push({catalogItemId:item.catalogItemId,qty,cost,line});}
    const paid=money(b.amountPaid??'0');if(paid===null||paid>total||paid>0n&&!paymentMethods.has(b.paymentMethod))return res.status(400).json({error:{code:'INVALID_PURCHASE_PAYMENT',message:'Confira o valor e a forma de pagamento da compra.'}});
    const client=await pool.connect();try{await client.query('BEGIN');
      if(supplierId){const supplier=await client.query('SELECT id FROM public.suppliers WHERE company_id=$1 AND id=$2 AND is_active AND archived_at IS NULL',[companyId(req),supplierId]);if(!supplier.rowCount){await client.query('ROLLBACK');return res.status(400).json({error:{code:'SUPPLIER_UNAVAILABLE',message:'Fornecedor não encontrado ou inativo.'}});}}
      const ids=[...new Set(parsed.map((item)=>item.catalogItemId))].sort();for(const id of ids)await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[companyId(req),id]);
      const productResult=await client.query(`SELECT id FROM public.catalog_items WHERE company_id=$1 AND id=ANY($2::uuid[]) AND item_type='product' AND is_active AND archived_at IS NULL`,[companyId(req),ids]);if(productResult.rowCount!==ids.length){await client.query('ROLLBACK');return res.status(400).json({error:{code:'PRODUCT_UNAVAILABLE',message:'Um dos produtos não está mais disponível.'}});}
      const counter=await client.query(`INSERT INTO public.document_counters(company_id,document_type,last_number) VALUES($1,'purchase',1) ON CONFLICT(company_id,document_type) DO UPDATE SET last_number=public.document_counters.last_number+1 RETURNING last_number`,[companyId(req)]);
      const purchase=await client.query(`INSERT INTO public.purchases(company_id,supplier_id,purchase_number,purchase_date,total,notes,created_by_subject,business_activity) VALUES($1,$2,$3,COALESCE($4::date,CURRENT_DATE),$5,$6,$7,$8) RETURNING *`,[companyId(req),supplierId,counter.rows[0].last_number,b.purchaseDate||null,moneyText(total),String(b.notes||'').trim().slice(0,3000),actor(req),b.businessActivity??'unassigned']);
      for(const item of parsed){await client.query(`INSERT INTO public.purchase_items(company_id,purchase_id,catalog_item_id,quantity,unit_cost,line_total) VALUES($1,$2,$3,$4,$5,$6)`,[companyId(req),purchase.rows[0].id,item.catalogItemId,quantityText(item.qty),moneyText(item.cost),moneyText(item.line)]);await client.query(`INSERT INTO public.stock_movements(company_id,catalog_item_id,direction,quantity,unit_cost,reason,source_type,source_id,created_by_subject) VALUES($1,$2,'in',$3,$4,$5,'purchase',$6,$7)`,[companyId(req),item.catalogItemId,quantityText(item.qty),moneyText(item.cost),`Compra #${purchase.rows[0].purchase_number}`,purchase.rows[0].id,actor(req)]);}
      let financialEntryId=null,financialPaymentId=null;
      if(total>0n){const settled=paid===total;const entry=await client.query(`INSERT INTO public.financial_entries(company_id,entry_type,title,amount,competence_date,due_date,settled_at,status,payment_method,supplier_id,source_type,source_id,notes,created_by_subject,business_activity) VALUES($1,'expense',$2,$3,COALESCE($4::date,CURRENT_DATE),$5::date,CASE WHEN $6 THEN COALESCE($4::date,CURRENT_DATE) END,CASE WHEN $6 THEN 'settled' ELSE 'pending' END,$7,$8,'purchase',$9,$10,$11,$12) RETURNING id`,[companyId(req),`Compra #${String(purchase.rows[0].purchase_number).padStart(4,'0')}`,moneyText(total),b.purchaseDate||null,b.dueDate||null,settled,paid>0n?b.paymentMethod:null,supplierId,purchase.rows[0].id,String(b.notes||'').trim().slice(0,3000),actor(req),b.businessActivity??'unassigned']);financialEntryId=entry.rows[0].id;if(paid>0n){const initialPayment=await client.query(`INSERT INTO public.financial_payments(company_id,entry_id,amount,payment_method,paid_at,created_by_subject) VALUES($1,$2,$3,$4,COALESCE($5::date,CURRENT_DATE),$6) RETURNING id`,[companyId(req),entry.rows[0].id,moneyText(paid),b.paymentMethod,b.purchaseDate||null,actor(req)]);financialPaymentId=initialPayment.rows[0].id;}}
      await audit(client,companyId(req),actor(req),'created','purchase',purchase.rows[0].id,{purchaseNumber:purchase.rows[0].purchase_number,total:moneyText(total)});await client.query('COMMIT');return res.status(201).json({purchase:purchase.rows[0],financialEntryId,financialPaymentId});
    }catch(error){await client.query('ROLLBACK').catch(()=>{});return fail(res,error,'registrar a compra');}finally{client.release();}
  });

  router.get('/audit',async(req,res)=>{const q=req.query;const offset=Number(q.offset||0);if(!Number.isSafeInteger(offset)||offset<0||q.from&&!validDate(q.from)||q.to&&!validDate(q.to))return res.status(400).json({error:{message:'Filtros inválidos.'}});try{const result=await pool.query(`SELECT id,actor_subject,action,entity_type,entity_id,summary,created_at,COUNT(*) OVER()::int AS total_count FROM public.audit_logs WHERE company_id=$1 AND ($2='' OR action ILIKE '%'||$2||'%' OR actor_subject ILIKE '%'||$2||'%' OR summary::text ILIKE '%'||$2||'%') AND ($3::date IS NULL OR (created_at AT TIME ZONE 'America/Bahia')::date>=$3) AND ($4::date IS NULL OR (created_at AT TIME ZONE 'America/Bahia')::date<=$4) AND ($5='' OR entity_type=$5) AND ($6='' OR action=$6) ORDER BY created_at ${q.order==='asc'?'ASC':'DESC'},id LIMIT 50 OFFSET $7`,[companyId(req),String(q.q||'').slice(0,100),q.from||null,q.to||null,String(q.entity||''),String(q.action||''),offset]);return res.json({activity:result.rows,total:result.rows[0]?.total_count||0});}catch(error){return fail(res,error,'consultar o histórico');}});
  return router;
}
