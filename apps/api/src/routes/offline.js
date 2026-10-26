import {operationLookups} from '../lib/lookups.js';
import {Router} from 'express';
import {requireCompanyMembership} from '../middleware/neon-auth.js';

export function createOfflineRouter({pool,requireAuth,requireDatabase}){
  const router=Router();router.use(requireAuth,requireDatabase(pool),requireCompanyMembership(pool));
  router.get('/snapshot',async(req,res)=>{
    const client=await pool.connect(),company=req.company.company_id;
    const can=area=>req.company.role==='owner'||req.company.permissions?.[area]!==false;
    async function rows(sql,params=[company]){const result=await client.query(sql,params);if(result.rows.length>20000)throw new Error('O volume excedeu o limite de preparação offline. Selecione um conjunto menor antes de continuar.');return result.rows;}
    try{
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const profile=(await rows('SELECT id,name,tax_identifier,phone,email,document_settings FROM public.companies WHERE id=$1'))[0];
      const data={version:1,preparedAt:new Date().toISOString(),company:{...profile,role:req.company.role,permissions:req.company.permissions},access:Object.fromEntries(['commercial','finance','operations','reports','audit'].map(a=>[a,can(a)]))};
      const group=(rows,key)=>{const result=new Map();for(const row of rows){if(!result.has(row[key]))result.set(row[key],[]);result.get(row[key]).push(row);}return result;};
      const table=async(name,allowed)=>allowed?rows(`SELECT * FROM public.${name} WHERE company_id=$1 LIMIT 20001`):[];
      data.lookups=await operationLookups(client,company,data.access);
      data.customers=await table('customers',can('commercial'));
      data.catalog=await table('catalog_items',can('commercial'));
      data.suppliers=await table('suppliers',can('commercial'));
      data.sales=await table('sales',can('commercial'));
      const saleItems=await table('sale_items',can('commercial')),salePayments=await table('sale_payments',can('commercial'));
      const itemsBySale=group(saleItems,'sale_id'),paymentsBySale=group(salePayments,'sale_id');
      for(const sale of data.sales){sale.items=(itemsBySale.get(sale.id)||[]).sort((a,b)=>a.position-b.position);sale.payments=paymentsBySale.get(sale.id)||[];}
      data.quotes=await table('quotes',can('commercial'));const quoteItems=await table('quote_items',can('commercial'));
      const itemsByQuote=group(quoteItems,'quote_id');for(const quote of data.quotes)quote.items=(itemsByQuote.get(quote.id)||[]).sort((a,b)=>a.position-b.position);
      data.transportProfiles=await table('transport_profiles',can('commercial'));
      data.entries=can('finance')||can('commercial')?await rows('SELECT e.*,c.name AS customer_name,s.name AS supplier_name FROM public.financial_entries e LEFT JOIN public.customers c ON c.company_id=e.company_id AND c.id=e.customer_id LEFT JOIN public.suppliers s ON s.company_id=e.company_id AND s.id=e.supplier_id WHERE e.company_id=$1 LIMIT 20001'):[];
      if(!can('finance'))data.entries=data.entries.filter(e=>e.source_type==='sale');
      data.financialPayments=await table('financial_payments',can('finance')||can('commercial'));
      if(!can('finance')){const ids=new Set(data.entries.map(e=>e.id));data.financialPayments=data.financialPayments.filter(p=>ids.has(p.entry_id));}
      const paymentsByEntry=group(data.financialPayments,'entry_id');for(const entry of data.entries){const paid=(paymentsByEntry.get(entry.id)||[]).reduce((sum,p)=>{const[w,f='']=String(p.amount).split('.');return sum+BigInt(w)*100n+BigInt((f+'00').slice(0,2));},0n);entry.amount_paid=`${paid/100n}.${String(paid%100n).padStart(2,'0')}`;}
      data.receipts=await table('receipts',can('finance'));
      data.purchases=await table('purchases',can('finance'));
      data.stock=can('operations')?await rows(`SELECT c.id,c.code,c.name,c.unit,c.minimum_stock,COUNT(m.id)::int AS movements,COALESCE(SUM(CASE WHEN m.direction='in' THEN m.quantity WHEN m.direction='out' THEN -m.quantity ELSE 0 END),0)::numeric(12,3)::text AS stock FROM public.catalog_items c LEFT JOIN public.stock_movements m ON m.company_id=c.company_id AND m.catalog_item_id=c.id WHERE c.company_id=$1 AND c.item_type='product' GROUP BY c.id LIMIT 20001`):[];
      // A sales clerk also needs a stock snapshot to validate a provisional sale.
      if(!can('operations')&&can('commercial'))data.stock=await rows(`SELECT c.id,c.code,c.name,c.unit,c.minimum_stock,COUNT(m.id)::int AS movements,COALESCE(SUM(CASE WHEN m.direction='in' THEN m.quantity ELSE -m.quantity END),0)::numeric(12,3)::text AS stock FROM public.catalog_items c LEFT JOIN public.stock_movements m ON m.company_id=c.company_id AND m.catalog_item_id=c.id WHERE c.company_id=$1 AND c.item_type='product' GROUP BY c.id LIMIT 20001`);
      data.movements=can('operations')?await rows('SELECT m.*,c.name AS item_name,c.unit FROM public.stock_movements m JOIN public.catalog_items c ON c.company_id=m.company_id AND c.id=m.catalog_item_id WHERE m.company_id=$1 ORDER BY m.created_at DESC LIMIT 100'):[];
      data.appointments=await table('appointments',can('operations'));
      data.orders=await table('service_orders',can('operations'));const orderItems=await table('service_order_items',can('operations'));
      const itemsByOrder=group(orderItems,'order_id');for(const order of data.orders)order.items=itemsByOrder.get(order.id)||[];
      data.attachments=can('operations')?await rows('SELECT id,service_order_id,file_name,mime_type,byte_size,caption,created_at FROM public.service_order_attachments WHERE company_id=$1 LIMIT 20001'):[];
      data.activity=can('audit')?await rows('SELECT * FROM public.audit_logs WHERE company_id=$1 ORDER BY created_at DESC LIMIT 50'):[];
      await client.query('COMMIT');res.set('Cache-Control','no-store');return res.json({snapshot:data});
    }catch(error){await client.query('ROLLBACK').catch(()=>{});console.error('Falha ao preparar offline:',error.message);return res.status(503).json({error:{code:'OFFLINE_PREPARATION_FAILED',message:'Não foi possível preparar os dados offline. Nenhum dado local anterior foi substituído.'}});}
    finally{client.release();}
  });return router;
}
