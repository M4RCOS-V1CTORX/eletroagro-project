import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {canQueue} from '../apps/web/src/offlineQueue.js';
const source=readFileSync(new URL('../apps/web/src/apiClient.js',import.meta.url),'utf8');
const contextCode=source.slice(source.indexOf('export function setApiContext('),source.indexOf('function assertSameContext(')).replaceAll('export function','function');
const requestCode=source.slice(source.indexOf('async function executeRequest('),source.indexOf('\nexport async function flushOfflineQueue'));
function create(){let resolveSend;const pending=new Promise(resolve=>resolveSend=resolve);const env={currentContext:null,apiUrl:'test',Headers,crypto,canQueue,navigator:{onLine:true},resolveKnownReferences:async(c,path,options)=>({path,options}),pendingFor:async()=>[],getAuthAccessToken:async()=> 'token',assertAccount:()=>{},send:()=>pending,localRead:async()=>({}),snapshotRecord:async()=>null,markOfflineDirty:async()=>{},refreshAfterWrite:()=>{},notifyOffline:()=>{}};const api=runInNewContext(`${contextCode}\n${requestCode}\n({setApiContext,syncApiContext,executeRequest})`,env);return{...api,env,resolveSend};}
const identity={issuer:'issuer',subject:'subject',companyId:'company'};
const response={status:200,ok:true,json:async()=>({value:'painel'})};
test('reconciliação da mesma sessão não interrompe a consulta do painel',async()=>{const e=create();e.setApiContext(identity);const original=e.env.currentContext;const pending=e.executeRequest('/api/operations/dashboard');e.syncApiContext({...identity});assert.equal(e.env.currentContext,original);e.resolveSend(response);assert.equal((await pending).value,'painel');});
test('troca de empresa e nova sessão explícita continuam invalidando consultas antigas',async()=>{for(const change of [e=>e.syncApiContext({...identity,companyId:'outra'}),e=>e.setApiContext({...identity}),e=>e.syncApiContext(null)]){const e=create();e.setApiContext(identity);const pending=e.executeRequest('/api/operations/dashboard');change(e);e.resolveSend(response);await assert.rejects(pending,error=>error.code==='SESSION_CONTEXT_CHANGED');}});

test('validação assíncrona cancelada não altera o contexto de sessão',async()=>{
  const app=readFileSync(new URL('../apps/web/src/App.jsx',import.meta.url),'utf8');
  const start=app.indexOf('async function verifyApiSession('),end=app.indexOf('\nexport default function App()',start);assert(start>=0&&end>start);
  let resolveCompany,contextChanges=0;const pending=new Promise(resolve=>resolveCompany=resolve);
  const env={apiUrl:'',getAuthAccessToken:async()=> 'token',setApiContext:()=>contextChanges++,fetch:async url=>url==='/api/session'?{ok:true,json:async()=>({user:{issuer:'i',subject:'s'}})}:pending};
  const verify=runInNewContext(`(${app.slice(start,end)})`,env);
  const promise=verify({});resolveCompany({ok:true,status:200,json:async()=>({company:{id:'company'}})});
  const result=await promise;assert.equal(result.company.id,'company');assert.equal(contextChanges,0);
});
