import {Router} from 'express';
import {activities} from '../lib/commercial.js';
import {canAction} from '../../../../shared/access-policy.js';

export const reportModules={
  sales:{title:'Vendas',area:'commercial',color:'#176da3'},
  expenses:{title:'Despesas',area:'finance',color:'#a57b24'},
  payables:{title:'Contas a pagar',area:'finance',color:'#b16f32'},
  receivables:{title:'Contas a receber',area:'finance',color:'#287f65'},
  purchases:{title:'Compras',area:'finance',color:'#355a80'},
  cashflow:{title:'Pagamentos e recebimentos',area:'finance',color:'#386a73'},
  stock:{title:'Posição de estoque',area:'operations',color:'#3d796d'},
  quotes:{title:'Orçamentos',area:'commercial',color:'#577f47'},
};
export function createCategoryReportsRouter({pool,validDate}){
  const router=Router();
  router.get('/',async(req,res,next)=>{
    const module=req.query.module,definition=Object.hasOwn(reportModules,module||'')?reportModules[module]:null;
    const from=req.query.from,to=req.query.to,activity=req.query.activity||'all',category=req.query.category||'all';
    if(!definition||!validDate(from)||!validDate(to)||from>to||!['all',...activities].includes(activity)||typeof category!=='string'||category.length>80)return res.status(400).json({error:{code:'INVALID_REPORT_FILTER',message:'Confira o relatório, a atividade, a categoria e o período.'}});
    if(req.company.role!=='owner'&&req.company.permissions?.[definition.area]===false)return res.status(403).json({error:{code:'REPORT_AREA_FORBIDDEN',message:'Seu perfil não permite consultar esta categoria de relatório.'}});
    const sourceModule=module==='cashflow'?'finance':module;
    if(!canAction(req.company,sourceModule,req.query.export==='1'?'export':'view'))return res.status(403).json({error:{code:'REPORT_MODULE_FORBIDDEN',message:'Seu perfil não permite acessar os dados deste relatório.'}});
    if(module==='stock'&&!canAction(req.company,'stock','costs'))return res.status(403).json({error:{message:'Este relatório inclui custos de estoque. Seu perfil não permite consultá-los.'}});
    const financial=['expenses','payables','receivables','cashflow'].includes(module);
    if(!financial&&category!=='all'||module==='stock'&&activity!=='all')return res.status(400).json({error:{code:'REPORT_FILTER_NOT_APPLICABLE',message:'O filtro não se aplica a este relatório. Estoque é consolidado; categorias financeiras se aplicam somente a contas e pagamentos.'}});
    const period=(column)=>`${column} BETWEEN par.from_date AND par.to_date`;
    const activityFilter=(alias)=>`(par.activity='all' OR ${alias}.business_activity=par.activity)`;
    const categoryFilter=(alias)=>`(par.category='all' OR COALESCE(${alias}.expense_category,'Sem categoria')=par.category)`;
    const payments=`LEFT JOIN LATERAL(SELECT SUM(amount) AS paid,MAX(paid_at) AS last_paid_at FROM public.financial_payments WHERE company_id=f.company_id AND entry_id=f.id) pay ON true`;
    let query;
    if(['expenses','payables','receivables'].includes(module)){
      const type=module==='receivables'?'income':'expense';
      query=`SELECT f.id,f.title AS description,f.expense_category AS category,f.business_activity,f.entry_type,f.source_type,f.status,f.competence_date AS date,f.due_date,pay.last_paid_at,
        f.amount,COALESCE(pay.paid,0)::numeric AS paid,GREATEST(f.amount-COALESCE(pay.paid,0),0)::numeric AS balance,
        COALESCE(c.name,s.name,'Sem vínculo') AS party,f.payment_method,
        (f.status='pending' AND f.due_date<(now() AT TIME ZONE 'America/Bahia')::date) AS overdue
        FROM public.financial_entries f CROSS JOIN parameters par ${payments}
        LEFT JOIN public.customers c ON c.company_id=f.company_id AND c.id=f.customer_id LEFT JOIN public.suppliers s ON s.company_id=f.company_id AND s.id=f.supplier_id
        WHERE f.company_id=par.company AND f.entry_type='${type}' AND ${period('COALESCE(f.due_date,f.competence_date)')} AND ${activityFilter('f')} AND ${categoryFilter('f')}`;
    }else if(module==='cashflow'){
      query=`SELECT fp.id,f.title AS description,f.expense_category AS category,f.business_activity,f.entry_type,f.source_type,'settled'::text AS status,fp.paid_at AS date,fp.paid_at AS last_paid_at,NULL::date AS due_date,fp.amount,fp.amount AS paid,0::numeric AS balance,fp.payment_method,false AS overdue,
        COALESCE(c.name,s.name,'Sem vínculo') AS party FROM public.financial_payments fp JOIN public.financial_entries f ON f.company_id=fp.company_id AND f.id=fp.entry_id CROSS JOIN parameters par
        LEFT JOIN public.customers c ON c.company_id=f.company_id AND c.id=f.customer_id LEFT JOIN public.suppliers s ON s.company_id=f.company_id AND s.id=f.supplier_id
        WHERE fp.company_id=par.company AND ${period('fp.paid_at')} AND ${activityFilter('f')} AND ${categoryFilter('f')}`;
    }else if(module==='sales'){
      query=`SELECT s.id,'Nota Nº '||s.sale_number||'/'||s.sale_year AS description,NULL::text AS category,s.business_activity,'income'::text AS entry_type,'sale'::text AS source_type,s.status,s.sale_date AS date,s.due_date,NULL::date AS last_paid_at,s.total AS amount,s.amount_paid AS paid,GREATEST(s.total-s.amount_paid,0) AS balance,s.customer_name AS party,s.payment_method,(s.status='completed' AND s.total>s.amount_paid AND s.due_date<(now() AT TIME ZONE 'America/Bahia')::date) AS overdue FROM public.sales s CROSS JOIN parameters par WHERE s.company_id=par.company AND ${period('s.sale_date')} AND ${activityFilter('s')}`;
    }else if(module==='purchases'){
      query=`SELECT pu.id,'Compra Nº '||pu.purchase_number AS description,NULL::text AS category,pu.business_activity,'expense'::text AS entry_type,'purchase'::text AS source_type,CASE WHEN pu.total<=COALESCE(pay.paid,0) THEN 'settled' ELSE 'pending' END AS status,pu.purchase_date AS date,f.due_date,pay.last_paid_at,pu.total AS amount,COALESCE(pay.paid,0)::numeric AS paid,GREATEST(pu.total-COALESCE(pay.paid,0),0) AS balance,COALESCE(s.name,'Sem fornecedor') AS party,f.payment_method,false AS overdue FROM public.purchases pu CROSS JOIN parameters par LEFT JOIN public.suppliers s ON s.company_id=pu.company_id AND s.id=pu.supplier_id LEFT JOIN public.financial_entries f ON f.company_id=pu.company_id AND f.source_type='purchase' AND f.source_id=pu.id AND f.entry_type='expense' ${payments} WHERE pu.company_id=par.company AND ${period('pu.purchase_date')} AND ${activityFilter('pu')}`;
    }else if(module==='quotes'){
      query=`SELECT q.id,'Orçamento Nº '||q.quote_number AS description,NULL::text AS category,'unassigned'::text AS business_activity,'income'::text AS entry_type,'quote'::text AS source_type,q.status,q.issued_at AS date,q.valid_until AS due_date,NULL::date AS last_paid_at,q.total AS amount,0::numeric AS paid,q.total AS balance,q.customer_name AS party,NULL::text AS payment_method,false AS overdue FROM public.quotes q CROSS JOIN parameters par WHERE q.company_id=par.company AND q.archived_at IS NULL AND ${period('q.issued_at')} AND par.activity='all'`;
      if(activity!=='all')return res.status(400).json({error:{code:'REPORT_FILTER_NOT_APPLICABLE',message:'Orçamentos não possuem atividade cadastrada. Use Todas as atividades.'}});
    }else{
      query=`SELECT c.id,c.name AS description,c.category,c.unit,c.code,c.minimum_stock,c.cost_price,
        COALESCE(SUM(CASE WHEN m.direction='in' THEN m.quantity ELSE -m.quantity END),0)::numeric AS quantity,
        COALESCE(SUM(CASE WHEN m.direction='in' THEN m.quantity ELSE -m.quantity END),0)*c.cost_price AS amount,
        0::numeric AS paid,0::numeric AS balance,'active'::text AS status,'stock'::text AS entry_type,
        par.to_date AS date,NULL::date AS due_date,NULL::date AS last_paid_at,'unassigned'::text AS business_activity,NULL::text AS party,NULL::text AS payment_method,false AS overdue
        FROM public.catalog_items c CROSS JOIN parameters par LEFT JOIN public.stock_movements m ON m.company_id=c.company_id AND m.catalog_item_id=c.id AND (m.created_at AT TIME ZONE 'America/Bahia')::date<=par.to_date
        WHERE c.company_id=par.company AND c.item_type='product' AND c.archived_at IS NULL GROUP BY c.id,par.to_date`;
    }
    const cte=`WITH parameters AS(SELECT $1::uuid AS company,$2::date AS from_date,$3::date AS to_date,$4::text AS activity,$5::text AS category),report_rows AS(${query})`;
    const client=await pool.connect();
    try{
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const rows=await client.query(`${cte} SELECT * FROM report_rows ORDER BY date,description,id LIMIT 20001`,[req.company.company_id,from,to,activity,category]);
      if(rows.rows.length>20000){await client.query('ROLLBACK');return res.status(413).json({error:{code:'REPORT_TOO_LARGE',message:'O relatório excede 20 mil registros. Reduza o período ou aplique mais filtros.'}});}
      const summary=await client.query(`${cte} SELECT COUNT(*)::int AS count,
        COALESCE(SUM(amount) FILTER(WHERE status<>'cancelled'),0)::text AS total,
        COALESCE(SUM(paid) FILTER(WHERE status<>'cancelled'),0)::text AS paid,
        COALESCE(SUM(balance) FILTER(WHERE status IN ('pending','completed')),0)::text AS pending,
        COALESCE(SUM(balance) FILTER(WHERE overdue),0)::text AS overdue,
        COALESCE(SUM(amount) FILTER(WHERE entry_type='income' AND status<>'cancelled'),0)::text AS income,
        COALESCE(SUM(amount) FILTER(WHERE entry_type='expense' AND status<>'cancelled'),0)::text AS expense FROM report_rows`,[req.company.company_id,from,to,activity,category]);
      await client.query('COMMIT');return res.json({module,...definition,period:{from:module==='stock'?null:from,to},activity,category,basis:module==='stock'?'position':module==='cashflow'?'payment':'document',generatedAt:new Date().toISOString(),summary:summary.rows[0],rows:rows.rows});
    }catch(error){await client.query('ROLLBACK').catch(()=>{});next(error);}finally{client.release();}
  });return router;
}
