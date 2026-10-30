import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../apps/web/public/service-worker.js',import.meta.url),'utf8');
function setup({status=200,missing=false}={}){
  const handlers={},items=new Map();let skipped=false;
  const cache={addAll:async paths=>{for(const path of paths)items.set(path,new Response('shell'));},put:async(path,value)=>items.set(path,value),match:async path=>missing&&path==='/asset.js'?undefined:items.get(path)?.clone()};
  runInNewContext(source,{Response,URL,Promise,caches:{open:async()=>cache,match:async()=>new Response('cached')},fetch:async()=>status===200?new Response('["/asset.js"]'):new Response('unavailable',{status}),self:{location:{origin:'http://localhost'},skipWaiting:async()=>{skipped=true;},addEventListener:(name,handler)=>handlers[name]=handler}});
  return{handlers,items,skipped:()=>skipped};
}
test('instalação só ativa com manifesto e recursos preparados',async()=>{
  const env=setup();let work;env.handlers.install({waitUntil:value=>work=value});await work;
  assert(env.skipped());assert(env.items.has('/offline-assets.json'));
  let result;env.handlers.message({data:{type:'VERIFY_OFFLINE_SHELL'},ports:[{postMessage:value=>result=value}],waitUntil:value=>work=value});await work;
  assert.equal(result.ready,true);
});
test('manifesto indisponível impede ativação incompleta',async()=>{
  const env=setup({status:503});let work;env.handlers.install({waitUntil:value=>work=value});await assert.rejects(work);
  assert.equal(env.skipped(),false);
});
test('verificação detecta recurso ausente sem declarar pronto',async()=>{
  const env=setup({missing:true});let work;env.handlers.install({waitUntil:value=>work=value});await work;
  let result;env.handlers.message({data:{type:'VERIFY_OFFLINE_SHELL'},ports:[{postMessage:value=>result=value}],waitUntil:value=>work=value});await work;
  assert.equal(result.ready,false);
});
test('navegação com HTTP 503 recupera shell guardado',async()=>{
  const env=setup({status:503});let work;
  env.handlers.fetch({request:{method:'GET',url:'http://localhost/',mode:'navigate'},respondWith:value=>work=value,waitUntil:()=>{}});
  assert.equal(await(await work).text(),'cached');
});
