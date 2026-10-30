// Local-only production-mode PWA harness. Auth is simulated; SQL/routes are real.
import {PGlite} from '@electric-sql/pglite';
import {createRequire} from 'node:module';
import {readFile,readdir,mkdir} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequestPool} from '../apps/api/src/lib/request-pool.js';
import {createCustomersRouter} from '../apps/api/src/routes/customers.js';
import {createCatalogRouter} from '../apps/api/src/routes/catalog.js';
import {createSuppliersRouter} from '../apps/api/src/routes/suppliers.js';
import {createSalesRouter} from '../apps/api/src/routes/sales.js';
import {createQuotesRouter} from '../apps/api/src/routes/quotes.js';
import {createOperationsRouter} from '../apps/api/src/routes/operations.js';
import {createCompaniesRouter} from '../apps/api/src/routes/companies.js';
import {createCompletionRouter} from '../apps/api/src/routes/completion.js';
import {createOfflineRouter} from '../apps/api/src/routes/offline.js';
const apiRequire=createRequire(new URL('../apps/api/package.json',import.meta.url));
const webRequire=createRequire(new URL('../apps/web/package.json',import.meta.url));
const express=apiRequire('express');
const {build}=await import(pathToFileURL(webRequire.resolve('vite')));
const base='http://127.0.0.1:5298';
const out=fileURLToPath(new URL('../tmp/offline-20261030/dist',import.meta.url));
const outputs={v1:out,v2:out+'-v2'};
let release='v1',manifestFailure=false,navigationFailure=false;
process.env.VITE_API_URL=base;
for(const[version,directory]of Object.entries(outputs)){
await mkdir(directory,{recursive:true});
await build({root:fileURLToPath(new URL('../apps/web/',import.meta.url)),configFile:fileURLToPath(new URL('../apps/web/vite.config.js',import.meta.url)),build:{outDir:directory,emptyOutDir:false},plugins:[{
  name:'isolated-auth-and-observability',enforce:'pre',
  transform(code,id){const path=id.replaceAll('\\','/');
    if(path.endsWith('/src/authClient.js'))return `
      async function session(){const r=await fetch('/neon-auth/get-session');if(!r.ok)throw new TypeError('Failed to fetch');return r.json();}
      export async function getAuthAccessToken(){const s=await session();if(!s.data?.session)throw new Error('Sua sessão expirou.');return s.data.session.token;}
      export const authClient={getSession:session,signOut:async()=>{await fetch('/qa/logout',{method:'POST'});return{};},token:async()=>({data:{token:await getAuthAccessToken()}})};`;
    if(path.endsWith('/src/main.jsx'))return code+`\nimport * as qaApi from './apiClient.js';import * as qaStore from './offlineStore.js';import {ensureOfflineShell as qaShell} from './offlineShell.js';import {createSalePdf as qaPdf} from './salePdf.js';globalThis.__qa={api:qaApi,store:qaStore,shell:qaShell,pdf:qaPdf,build:${JSON.stringify(version)}};`;
  },
}]});
}
const db=new PGlite();
for(const file of (await readdir(new URL('../apps/api/src/db/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL('../apps/api/src/db/migrations/'+file,import.meta.url),'utf8'));
let lease=Promise.resolve();async function acquire(){let release;const next=new Promise(r=>release=r),prior=lease;lease=prior.then(()=>next);await prior;return release;}
const query=async(sql,params=[])=>{const r=await db.query(sql,params);return{...r,rowCount:r.rows.length||r.affectedRows||0};};
const raw={query:async(...args)=>{const release=await acquire();try{return await query(...args);}finally{release();}},connect:async()=>{const release=await acquire();return{query,release};}};
const pool=createRequestPool(raw),fixtures={};
for(const subject of ['a','b']){
  const company=(await db.query('INSERT INTO companies(name) VALUES($1) RETURNING id',['Empresa fictícia '+subject])).rows[0].id;
  await db.query("INSERT INTO company_memberships(company_id,auth_issuer,auth_subject,role,email) VALUES($1,'qa-local',$2,'owner',$3)",[company,subject,subject+'@example.invalid']);
  const customer=(await db.query('INSERT INTO customers(company_id,name) VALUES($1,$2) RETURNING id',[company,'Cliente fictício '+subject])).rows[0].id;
  const product=(await db.query("INSERT INTO catalog_items(company_id,item_type,name,unit,sale_price) VALUES($1,'product','Produto fictício','kg',10) RETURNING id",[company])).rows[0].id;
  await db.query("INSERT INTO stock_movements(company_id,catalog_item_id,direction,quantity,reason,created_by_subject) VALUES($1,$2,'in',100,'Estoque fictício',$3)",[company,product,subject]);
  fixtures[subject]={company,customer,product};
}
const token=subject=>'e30.'+Buffer.from(JSON.stringify({iss:'qa-local',sub:subject})).toString('base64url')+'.qa';
const app=express();app.use(express.json({limit:'4mb'}));
let mode=null;const requests=[];
app.get('/neon-auth/get-session',(req,res)=>{res.setHeader('Cache-Control','no-store');const subject=/qa-user=([ab])/.exec(req.headers.cookie||'')?.[1];return res.json(subject?{data:{session:{token:token(subject)},user:{email:subject+'@example.invalid',name:'Teste '+subject}}}:{data:{session:null,user:null}});});
app.post('/qa/logout',(req,res)=>{res.setHeader('Set-Cookie','qa-user=; Path=/; Max-Age=0');res.json({});});
app.post('/qa/control',(req,res)=>{if(req.body.kind==='release'){if(!outputs[req.body.version])return res.sendStatus(400);release=req.body.version;}else if(req.body.kind==='manifest-failure')manifestFailure=!!req.body.enabled;else if(req.body.kind==='navigation-failure')navigationFailure=!!req.body.enabled;else mode=req.body;res.json({});});
app.get('/qa/evidence',async(req,res)=>res.json({fixtures,requests,counts:(await pool.query('SELECT company_id,COUNT(*)::int AS count FROM sales GROUP BY company_id')).rows}));
app.use('/api',(req,res,next)=>{
  requests.push({method:req.method,path:req.path,authorization:req.get('authorization'),key:req.get('x-idempotency-key'),company:req.get('x-company-context')});
  if(mode&&req.method===(mode.method||'POST')&&req.path===mode.path){const current=mode;mode=null;
    if(current.kind==='503')return res.status(503).json({error:{message:'Falha transitória fictícia'}});
    if(current.kind==='reject')return res.status(409).json({error:{message:'Conflito fictício'}});
    if(current.kind==='lost')res.end=function(){res.destroy();return res;};
    if(current.kind==='delay')return setTimeout(next,1200);
  }
  next();
});
const auth=(req,res,next)=>{try{const payload=JSON.parse(Buffer.from((req.get('authorization')||'').split('.')[1]||'','base64url').toString());if(!['a','b'].includes(payload.sub)||payload.iss!=='qa-local')throw Error();req.auth={issuer:'qa-local',subject:payload.sub};next();}catch{res.status(401).json({error:{message:'Sessão fictícia inválida'}});}};
const deps={pool,requireAuth:auth,requireDatabase:()=>((req,res,next)=>next())};
app.get('/api/health',(req,res)=>res.json({database:'configured',status:'ok'}));
app.get('/api/session',auth,(req,res)=>res.json({user:req.auth}));
for(const[path,factory]of [['customers',createCustomersRouter],['catalog',createCatalogRouter],['suppliers',createSuppliersRouter],['sales',createSalesRouter],['quotes',createQuotesRouter],['operations',createOperationsRouter],['company',createCompaniesRouter],['completion',createCompletionRouter],['offline',createOfflineRouter]])app.use('/api/'+path,factory(deps));
app.get('/offline-assets.json',(req,res)=>manifestFailure?res.sendStatus(503):res.sendFile(outputs[release]+'/offline-assets.json',{headers:{'Cache-Control':'no-store'}}));
app.get('/',(req,res,next)=>navigationFailure?res.sendStatus(503):next());
const staticReleases=Object.fromEntries(Object.entries(outputs).map(([version,directory])=>[version,express.static(directory,{setHeaders(res,path){if(path.endsWith('service-worker.js')||path.endsWith('index.html'))res.setHeader('Cache-Control','no-store');}})]));
app.use((req,res,next)=>staticReleases[release](req,res,next));
app.get('*',(req,res)=>res.sendFile(outputs[release]+'/index.html'));
const server=app.listen(5298,'127.0.0.1',()=>console.log('QA_PRODUCTION_READY '+base));
process.on('SIGINT',()=>server.close(async()=>{await db.close();process.exit(0);}));
