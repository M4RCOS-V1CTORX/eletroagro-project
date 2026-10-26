import {createRequestPool} from '../apps/api/src/lib/request-pool.js';
// Isolated PostgreSQL in WASM. No DATABASE_URL, credentials or production writes.
import {PGlite} from '@electric-sql/pglite';
import {createRequire} from 'node:module';
import {readFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createSalesRouter} from '../apps/api/src/routes/sales.js';
import {createOperationsRouter} from '../apps/api/src/routes/operations.js';
import {createCustomersRouter} from '../apps/api/src/routes/customers.js';
import {createCatalogRouter} from '../apps/api/src/routes/catalog.js';
import {createSuppliersRouter} from '../apps/api/src/routes/suppliers.js';
import {createQuotesRouter} from '../apps/api/src/routes/quotes.js';
import {createCompaniesRouter} from '../apps/api/src/routes/companies.js';
import {createCompletionRouter} from '../apps/api/src/routes/completion.js';
import {createOfflineRouter} from '../apps/api/src/routes/offline.js';
import {requireCompanyMembership,idempotencyGuard} from '../apps/api/src/middleware/neon-auth.js';
const require=createRequire(new URL('../apps/api/package.json',import.meta.url));const express=require('express');
const db=new PGlite();let server;
let lease=Promise.resolve();async function acquire(){let unlock;const next=new Promise(resolve=>unlock=resolve),prior=lease;lease=prior.then(()=>next);await prior;return unlock;}
const query=async(sql,params=[])=>{const r=await db.query(sql,params);return {...r,rowCount:r.rows.length||r.affectedRows||0};};
const rawPool={query:async(...args)=>{const unlock=await acquire();try{return await query(...args);}finally{unlock();}},connect:async()=>{const unlock=await acquire();let released=false;return{query,release(){if(!released){released=true;unlock();}}};}};
const pool=createRequestPool(rawPool);
try{
  const files=(await readdir(new URL('../apps/api/src/db/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort();
  for(const file of files.filter(f=>!f.startsWith('010')))await db.exec(await readFile(new URL(`../apps/api/src/db/migrations/${file}`,import.meta.url),'utf8'));
  const company=(await db.query("INSERT INTO public.companies(name) VALUES('Empresa de teste isolado') RETURNING id")).rows[0].id;
  await db.query("INSERT INTO public.company_memberships(company_id,auth_issuer,auth_subject,role,email) VALUES($1,'test','owner','owner','teste@example.invalid')",[company]);
  const customer=(await db.query("INSERT INTO public.customers(company_id,name) VALUES($1,'Cliente de teste isolado') RETURNING id",[company])).rows[0].id;
  const old=(await db.query("INSERT INTO public.sales(company_id,sale_number,customer_id,customer_name,payment_method,payment_status,sale_date,subtotal,discount_amount,total,amount_paid,created_by_subject) VALUES($1,25,$2,'Cliente antigo','pix','pending','2026-10-13',100,0,100,0,'owner') RETURNING id",[company,customer])).rows[0].id;
  await db.exec(await readFile(new URL('../apps/api/src/db/migrations/010_farm_commercial.sql',import.meta.url),'utf8'));
  const preserved=(await db.query('SELECT sale_number,sale_year,total FROM public.sales WHERE id=$1',[old])).rows[0];assert.equal(Number(preserved.sale_number),25);assert.equal(preserved.sale_year,2026);assert.equal(preserved.total,'100.00');
  console.log('✓ Dez migrações aplicadas; números e valores antigos preservados.');
  await db.query('UPDATE public.customers SET payment_term_days=8 WHERE id=$1',[customer]);
  const auth=(req,res,next)=>{req.auth={issuer:'test',subject:req.get('x-test-user')||'owner'};next();};
  const deps={pool,requireAuth:auth,requireDatabase:()=>((req,res,next)=>next())};
  const qaPort=Number(process.env.QA_PORT||5188);
  const app=express();app.use(express.json({limit:'4mb'}));app.get('/api/session',auth,(req,res)=>res.json({user:req.auth}));app.get('/api/health',(req,res)=>res.json({database:'configured'}));app.use('/api/sales',createSalesRouter(deps));app.use('/api/operations',createOperationsRouter(deps));app.use('/api/customers',createCustomersRouter(deps));app.use('/api/catalog',createCatalogRouter(deps));app.use('/api/quotes',createQuotesRouter(deps));app.use('/api/company',createCompaniesRouter(deps));app.use('/api/completion',createCompletionRouter(deps));app.use('/api/offline',createOfflineRouter(deps));
  app.post('/api/test/atomic',auth,requireCompanyMembership(pool),idempotencyGuard(pool),async(req,res)=>{await pool.query("INSERT INTO public.financial_entries(company_id,entry_type,title,amount,status,created_by_subject) VALUES($1,'expense','Falha controlada de integridade',1,'pending','owner')",[req.company.company_id]);return req.body.fail?res.status(500).json({error:{message:'Falha controlada'}}):res.status(201).json({saved:true});});
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  async function call(path,body,expected=200,headers={}){const response=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});const result=await response.json();assert.equal(response.status,expected,JSON.stringify(result));return result;}
  const draft={customerId:customer,saleDate:'2026-12-28',paymentMethod:'pix',amountPaid:'1000',discountAmount:'0',businessActivity:'farm',vehicle:'Caminhão',plate:'abc1d23',driver:'Motorista teste',destination:'Feira de Santana',freightAmount:'3500',freightCost:'3000',items:[{name:'Banana de teste',itemType:'product',unit:'kg',quantity:'1000',unitPrice:'5.838'}]};
  // Invalid precision is rejected before it reaches the database.
  await call('/api/sales',draft,400);draft.items[0].unitPrice='5.83';draft.items[0].quantity='1000';
  const created=(await call('/api/sales',draft,201)).sale;assert.equal(Number(created.sale_number),26);assert.equal(created.sale_year,2026);assert.equal(created.total,'9330.00');
  let detail=(await call(`/api/sales/${created.id}`)).sale;assert.equal(String(detail.due_date).slice(0,10),'2027-01-05');assert.equal(detail.plate,'ABC1D23');
  const entries=(await db.query('SELECT * FROM public.financial_entries WHERE company_id=$1 AND source_id=$2 ORDER BY entry_type',[company,created.id])).rows;
  assert.equal(entries.length,2);const expense=entries.find(e=>e.entry_type==='expense'),income=entries.find(e=>e.entry_type==='income');assert.equal(expense.amount,'3000.00');assert.equal(income.amount,'9330.00');assert(entries.every(e=>e.business_activity==='farm'));
  const next=(await call('/api/sales',{...draft,saleDate:'2027-01-01',freightCost:'0',amountPaid:'0'},201)).sale;assert.equal(Number(next.sale_number),1);assert.equal(next.sale_year,2027);
  const next2=(await call('/api/sales',{...draft,saleDate:'2027-01-02',freightCost:'0',amountPaid:'0'},201)).sale;assert.equal(Number(next2.sale_number),2);
  console.log('✓ Frete separado, custo a pagar, prazo automático e reinício anual validados nas rotas reais.');
  await call(`/api/operations/finance/${income.id}/payments`,{amount:'500',paymentMethod:'pix',paidAt:'2026-12-29'},201);
  detail=(await call(`/api/sales/${created.id}`)).sale;assert.equal(detail.amount_paid,'1500.00');assert.equal(detail.payments.length,2);
  await call(`/api/sales/${created.id}/payments`,{amount:'300',paymentMethod:'cash',receivedDate:'2026-12-30'},201);
  const paid=(await db.query('SELECT SUM(amount)::text AS paid FROM public.financial_payments WHERE entry_id=$1',[income.id])).rows[0].paid;assert.equal(paid,'1800.00');
  const statement=await call(`/api/sales/customer-statement/${customer}`);assert.equal(statement.summary.paid,'1800.00');assert.equal(statement.sales.length,4);
  await call(`/api/sales/${created.id}/payments`,{amount:'10000',paymentMethod:'pix'},400);
  await call(`/api/operations/finance/${expense.id}/payments`,{amount:'3000',paymentMethod:'pix'},201);
  await call(`/api/sales/${created.id}/cancel`,{reason:'Teste de cancelamento com frete pago'},409);
  console.log('✓ Recebimentos nas duas telas mantêm saldos iguais; frete pago impede cancelamento inconsistente.');
  const profile=await call('/api/sales/transport-profiles',{vehicle:'Caminhão',plate:'abc1d23',driver:'Motorista teste'},201);assert.equal(profile.profile.plate,'ABC1D23');assert.equal((await call('/api/sales/transport-profiles')).profiles.length,1);
  const finance=await call('/api/operations/finance?activity=farm');assert.equal(finance.entries.length,4);assert.equal((await call('/api/operations/finance?activity=electrical')).entries.length,0);
  await call('/api/operations/finance',{entryType:'expense',title:'Despesa elétrica',amount:'50',businessActivity:'electrical'},201);
  assert.equal((await call('/api/operations/finance?activity=electrical')).entries.length,1);
  const product=(await db.query("INSERT INTO public.catalog_items(company_id,item_type,name,unit) VALUES($1,'product','Banana para compra','kg') RETURNING id",[company])).rows[0].id;
  await call('/api/operations/purchases',{businessActivity:'farm',purchaseDate:'2026-10-26',items:[{catalogItemId:product,quantity:'10',unitCost:'1.20'}]},201);
  assert.equal((await call('/api/operations/purchases?activity=farm')).purchases.length,1);assert.equal((await call('/api/operations/purchases?activity=electrical')).purchases.length,0);
  console.log('✓ Atividades, transportes e compras filtradas com valores reais do banco isolado.');
  const key=randomUUID();const once=await call('/api/sales',{...draft,freightCost:'0'},201,{'X-Idempotency-Key':key});const twice=await call('/api/sales',{...draft,freightCost:'0'},201,{'X-Idempotency-Key':key});assert.equal(once.sale.id,twice.sale.id);
  await call(`/api/sales/${next.id}/cancel`,{reason:'Cancelamento de teste'},200);const cancelled=(await db.query('SELECT status FROM public.financial_entries WHERE source_id=$1',[next.id])).rows[0];assert.equal(cancelled.status,'cancelled');
  const otherCompany=(await db.query("INSERT INTO public.companies(name) VALUES('Outra empresa isolada') RETURNING id")).rows[0].id;await db.query("INSERT INTO public.company_memberships(company_id,auth_issuer,auth_subject,role) VALUES($1,'test','other','owner')",[otherCompany]);
  await call(`/api/sales/${created.id}`,null,404,{'x-test-user':'other'});
  await call(`/api/sales/customer-statement/${customer}`,null,404,{'x-test-user':'other'});
  console.log('✓ Reenvio idempotente, cancelamento e isolamento entre empresas validados.');
  const quote=(await db.query("INSERT INTO public.quotes(company_id,quote_number,customer_id,customer_name,status,subtotal,discount_amount,total,created_by_subject) VALUES($1,1,$2,'Cliente de teste isolado','approved',100,10,90,'owner') RETURNING id",[company,customer])).rows[0].id;
  await db.query("INSERT INTO public.quote_items(company_id,quote_id,position,item_type,name,unit,quantity,unit_price,line_total) VALUES($1,$2,1,'service','Serviço de teste','un',1,100,100)",[company,quote]);
  const converted=(await call('/api/sales',{quoteId:quote,paymentMethod:'pix',saleDate:'2027-03-01',businessActivity:'electrical',freightAmount:'20',freightCost:'15'},201)).sale;assert.equal(converted.total,'110.00');assert.equal(converted.discount_amount,'10.00');
  await call('/api/sales',{quoteId:quote,paymentMethod:'pix'},409);
  await call('/api/sales',{...draft,freightAmount:'0',freightCost:'0',amountPaid:'0',items:[{catalogItemId:product,quantity:'11',unitPrice:'2'}]},409);
  const stocked=(await call('/api/sales',{...draft,freightAmount:'0',freightCost:'0',amountPaid:'0',items:[{catalogItemId:product,quantity:'2.5',unitPrice:'2'}]},201)).sale;
  const stock=(await db.query("SELECT SUM(CASE WHEN direction='in' THEN quantity ELSE -quantity END)::text AS balance FROM public.stock_movements WHERE company_id=$1 AND catalog_item_id=$2",[company,product])).rows[0].balance;assert.equal(stock,'7.500');
  await call(`/api/sales/${stocked.id}/cancel`,{reason:'Devolução de teste'},200);
  const restored=(await db.query("SELECT SUM(CASE WHEN direction='in' THEN quantity ELSE -quantity END)::text AS balance FROM public.stock_movements WHERE company_id=$1 AND catalog_item_id=$2",[company,product])).rows[0].balance;assert.equal(restored,'10.000');
  console.log('✓ Conversão de orçamento mantém desconto e adiciona frete; estoque fracionado e estorno preservados.');
  const dashboard=await call('/api/operations/dashboard?from=2026-10-01&to=2026-10-26');
  const summary=await call('/api/sales/summary?from=2026-10-01&to=2026-10-26&activity=all');assert.equal(summary.summary.sales_count,1);
  const ledger=(await db.query(`SELECT COALESCE(SUM(GREATEST(f.amount-COALESCE(p.paid,0),0)) FILTER(WHERE f.entry_type='income' AND f.status='pending'),0)::text AS receivable,
    COALESCE(SUM(GREATEST(f.amount-COALESCE(p.paid,0),0)) FILTER(WHERE f.entry_type='expense' AND f.status='pending'),0)::text AS payable
    FROM public.financial_entries f LEFT JOIN LATERAL(SELECT SUM(amount) AS paid FROM public.financial_payments WHERE company_id=f.company_id AND entry_id=f.id)p ON true WHERE f.company_id=$1`,[company])).rows[0];
  assert.equal(dashboard.finance.receivable,ledger.receivable);assert.equal(dashboard.finance.payable,ledger.payable);
  const legacy=(await db.query("INSERT INTO public.sales(company_id,sale_number,customer_id,customer_name,payment_method,payment_status,sale_date,subtotal,total,amount_paid,created_by_subject) VALUES($1,999,$2,'Cliente anterior','pix','pending','2027-04-01',10,10,0,'owner') RETURNING sale_year,sale_number",[company,customer])).rows[0];assert.equal(legacy.sale_year,2027);assert.notEqual(Number(legacy.sale_number),999);
  console.log('✓ Painel concilia saldos pendentes; API anterior continua inserindo vendas após a migração.');
  const prepared=await call('/api/offline/snapshot');assert.equal(prepared.snapshot.company.id,company);assert(prepared.snapshot.sales.some(s=>s.id===created.id));assert(prepared.snapshot.stock.length);
  const restricted=(await db.query("INSERT INTO public.company_memberships(company_id,auth_issuer,auth_subject,role,permissions) VALUES($1,'test','restricted','member','{\"commercial\":false,\"finance\":false,\"operations\":false,\"audit\":false,\"reports\":false}'::jsonb) RETURNING id",[company])).rows[0];
  const restrictedDashboard=await call('/api/operations/dashboard',null,200,{'x-test-user':'restricted'});assert.equal(restrictedDashboard.finance,null);assert.equal(restrictedDashboard.sales,null);assert.equal(restrictedDashboard.activity.length,0);
  const restrictedSnapshot=await call('/api/offline/snapshot',null,200,{'x-test-user':'restricted'});assert.equal(restrictedSnapshot.snapshot.entries.length,0);assert.equal(restrictedSnapshot.snapshot.sales.length,0);assert.equal(restrictedSnapshot.snapshot.customers.length,0);
  await call('/api/sales',draft,409,{'X-Company-Context':otherCompany});
  console.log('✓ Preparação offline, isolamento por área e contexto empresarial verificados.');
  const failedKey=randomUUID();await call('/api/test/atomic',{fail:true},500,{'X-Idempotency-Key':failedKey});assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM public.financial_entries WHERE title='Falha controlada de integridade'")).rows[0].n,0);assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM public.idempotency_keys WHERE idempotency_key=$1',[failedKey])).rows[0].n,0);
  await call('/api/test/atomic',{fail:false},201,{'X-Idempotency-Key':failedKey});await call('/api/test/atomic',{fail:false},201,{'X-Idempotency-Key':failedKey});assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM public.financial_entries WHERE title='Falha controlada de integridade'")).rows[0].n,1);
  const parallelKey=randomUUID(),parallel=await Promise.all([call('/api/sales',{...draft,freightCost:'0'},201,{'X-Idempotency-Key':parallelKey}),call('/api/sales',{...draft,freightCost:'0'},201,{'X-Idempotency-Key':parallelKey})]);assert.equal(parallel[0].sale.id,parallel[1].sale.id);
  await call('/api/operations/finance',{entryType:'expense',title:'Parcela inválida',amount:'0.01',scheduleMode:'installments',scheduleCount:2},400);
  console.log('✓ Falha após escrita reverte dados e chave; reenvios simultâneos criam uma única venda.');
  app.use('/api/suppliers',createSuppliersRouter(deps));
  if(process.argv.includes('--serve')){
    const webRequire=createRequire(new URL('../apps/web/package.json',import.meta.url));
    const {createServer}=await import(pathToFileURL(webRequire.resolve('vite')));
    const {default:react}=await import(pathToFileURL(webRequire.resolve('@vitejs/plugin-react')));
    const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../apps/web/',import.meta.url)),plugins:[{
      name:'isolated-qa',enforce:'pre',
      configureServer(server){server.middlewares.use(async(req,res,next)=>{if(req.url==='/offline-assets.json'){res.setHeader('Content-Type','application/json');return res.end('[]');}if(req.url!=='/qa')return next();res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/qa','<html><head></head><body><div id="root"></div><script type="module" src="/qa-entry.jsx"></script></body></html>'));});},
      resolveId(id){if(id==='/qa-entry.jsx')return id;},
      load(id){if(id==='/qa-entry.jsx')return `import React from 'react';import{createRoot}from'react-dom/client';import Sales from '/src/SalesPage.jsx';import Customers from '/src/CustomersPage.jsx';import{OverviewPage,FinancePage,StockPage}from'/src/OperationsPages.jsx';import{useDialogAccessibility}from'/src/useDialogAccessibility.js';import'/src/styles.css';function QA(){useDialogAccessibility();const[page,setPage]=React.useState('sales');return <div style={{maxWidth:1400,margin:'auto',padding:16}}><nav>{['overview','sales','customers','finance','stock'].map(p=><button key={p} onClick={()=>setPage(p)}>{p}</button>)}</nav>{page==='overview'?<OverviewPage onNavigate={setPage}/>:page==='sales'?<Sales/>:page==='customers'?<Customers/>:page==='finance'?<FinancePage/>:<StockPage/>}</div>}createRoot(document.getElementById('root')).render(<QA/>);`;},
      transform(code,id){const path=id.replaceAll('\\','/');if(process.argv.includes('--offline-ui')){if(path.endsWith('/src/apiUrl.js'))return `export const apiUrl='';`;if(path.endsWith('/src/authClient.js'))return `const token='e30.'+btoa(JSON.stringify({iss:'test',sub:'owner'}))+'.test';export const getAuthAccessToken=async()=>token;export const authClient={getSession:async()=>({data:{session:{token},user:{email:'qa@example.invalid',name:'Teste isolado'}}}),signOut:async()=>({}),token:async()=>({data:{token}})};`;return;}if(path.endsWith('/src/apiClient.js'))return `export const getApiContext=()=>null;export async function apiRequest(path,options={}){const response=await fetch(path,{...options,headers:{'Content-Type':'application/json',...options.headers}});const body=response.status===204?{}:await response.json();if(!response.ok)throw new Error(body.error?.message||'Falha no teste');return body;}`;}
    },react()],server:{host:'127.0.0.1',port:qaPort,strictPort:true,proxy:{'/api':base}}});
    await vite.listen();console.log(`QA_UI_READY http://127.0.0.1:${qaPort}/qa`);
    await new Promise(resolve=>process.once('SIGINT',resolve));await vite.close();
  }
}finally{if(server)await new Promise(resolve=>server.close(resolve));await db.close();}
