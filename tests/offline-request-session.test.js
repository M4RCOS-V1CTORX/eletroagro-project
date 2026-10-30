import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {canQueue} from '../apps/web/src/offlineQueue.js';
const source=readFileSync(new URL('../apps/web/src/apiClient.js',import.meta.url),'utf8');
const start=source.indexOf('async function executeRequest('),end=source.indexOf('\nexport async function flushOfflineQueue',start);
assert(start>=0&&end>start);
function setup({tokenError,networkError,status=200,changeAt}={}){
  const context={subject:'a',companyId:'company-a'};let saves=0,reads=0,sends=0;
  const sandbox={currentContext:context,Headers,crypto,canQueue,navigator:{onLine:true},
    resolveKnownReferences:async(c,path,options)=>{if(changeAt==='references')sandbox.currentContext={subject:'b'};return{path,options};},
    pendingFor:async()=>[],getAuthAccessToken:async()=>{if(tokenError)throw tokenError;return'token';},assertAccount:()=>{},
    send:async()=>{sends++;if(changeAt==='send')sandbox.currentContext={subject:'b'};if(networkError)throw networkError;return{status,ok:status<400,json:async()=>{if(changeAt==='json')sandbox.currentContext={subject:'b'};return{value:'server-a',error:{message:'Recusado'}};}};},
    enqueue:async(path,options,c)=>{assert.equal(c,context);saves++;return{queued:true};},
    localRead:async c=>{assert.equal(c,context);reads++;return{offline:true};},
    snapshotRecord:async()=>({}),markOfflineDirty:async()=>{},refreshAfterWrite:()=>{},notifyOffline:()=>{},
  };
  return{request:runInNewContext(`(${source.slice(start,end)})`,sandbox),saves:()=>saves,reads:()=>reads,sends:()=>sends};
}
test('troca durante resolução local impede envio',async()=>{
  const env=setup({changeAt:'references'});await assert.rejects(env.request('/api/customers'),e=>e.code==='SESSION_CONTEXT_CHANGED');assert.equal(env.sends(),0);
});
for(const changeAt of ['send','json'])test(`resposta antiga não retorna à nova sessão: ${changeAt}`,async()=>{
  const env=setup({changeAt});await assert.rejects(env.request('/api/customers'),e=>e.code==='SESSION_CONTEXT_CHANGED');
});
test('escrita com resposta perdida após troca fica apenas na conta original',async()=>{
  const env=setup({changeAt:'send',networkError:new TypeError('Failed to fetch')});
  await assert.rejects(env.request('/api/customers',{method:'POST',body:'{}'}),e=>e.code==='SESSION_CONTEXT_CHANGED');assert.equal(env.saves(),1);
});
test('falha de rede ao obter token usa dados locais',async()=>{
  const env=setup({tokenError:new TypeError('Failed to fetch')});assert.equal((await env.request('/api/customers')).offline,true);assert.equal(env.reads(),1);
});
test('erro de autenticação não é convertido em escrita local',async()=>{
  const error=new Error('Sua sessão expirou');const env=setup({tokenError:error});await assert.rejects(env.request('/api/customers',{method:'POST'}),e=>e===error);assert.equal(env.saves(),0);
});
test('HTTP 503 permite leitura local e preserva escrita com chave gerada',async()=>{
  const env=setup({status:503});assert.equal((await env.request('/api/customers')).offline,true);
  assert.equal((await env.request('/api/customers',{method:'POST',body:'{}'})).queued,true);assert.equal(env.saves(),1);
});
