import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createOfflineQueue,queueScope} from '../apps/web/src/offlineQueue.js';

// Run the actual connection effect with simulated window events and memory storage.
const source=readFileSync(new URL('../apps/web/src/App.jsx',import.meta.url),'utf8');
const marker=source.indexOf('const updateQueue =');
const start=source.lastIndexOf('useEffect(() => {',marker);
const end=source.indexOf('}, []);',marker);
assert(start>=0&&end>start,'connection effect must be present');
const effect=source.slice(start+'useEffect('.length,end+1);
const settle=()=>new Promise(resolve=>setImmediate(resolve));

function setup({online=true,status='pending',send}={}){
  let context={issuer:'issuer',subject:'a',companyId:'company'};
  const original={id:'stable-key',scope:queueScope(context),companyId:'company',path:'/api/customers',method:'POST',body:'{}',headers:{},status};
  let rows=[structuredClone(original)],sends=0,flushes=0;
  const queue=createOfflineQueue({context:()=>context,read:async()=>structuredClone(rows),put:async row=>{rows=[row];},remove:async()=>{rows=[];},send:async row=>{sends++;assert.equal(row.id,original.id);return send?send(sends):new Response('{}',{status:201});}});
  const listeners=new Map();
  const cleanup=runInNewContext(`(${effect})()`,{
    navigator:{onLine:online},
    window:{addEventListener:(name,handler)=>listeners.set(name,handler),removeEventListener:(name,handler)=>{assert.equal(listeners.get(name),handler);listeners.delete(name);}},
    flushOfflineQueue:async()=>{flushes++;return queue.flush();},
    offlineQueueCount:async()=>rows.length,
    setOnline:()=>{},setPendingSync:()=>{},setInstallPrompt:()=>{},
  });
  return{focus:()=>listeners.get('focus')(),cleanup,listeners,rows:()=>rows,original,sends:()=>sends,flushes:()=>flushes,logout:()=>{context=null;}};
}

test('voltar à janela retenta falha transitória com a mesma chave',async()=>{
  const env=setup({send:attempt=>{if(attempt===1)throw new TypeError('Rede indisponível');return new Response('{}',{status:201});}});
  env.focus();await settle();assert.deepEqual(env.rows(),[env.original]);
  env.focus();await settle();assert.equal(env.sends(),2);assert.deepEqual(env.rows(),[]);
});

test('não cria repetição automática após falha persistente',async()=>{
  const env=setup({send:()=>{throw new TypeError('Rede indisponível');}});
  env.focus();await settle();await settle();
  assert.equal(env.sends(),1);assert.equal(env.flushes(),1);assert.deepEqual(env.rows(),[env.original]);
});

test('eventos de foco concorrentes não duplicam envio',async()=>{
  let release;const waiting=new Promise(resolve=>{release=resolve;});
  const env=setup({send:()=>waiting});
  env.focus();env.focus();await settle();assert.equal(env.sends(),1);
  release(new Response('{}',{status:201}));await settle();assert.deepEqual(env.rows(),[]);
});

test('sem conexão não inicia tentativa',async()=>{
  const env=setup({online:false});env.focus();await settle();
  assert.equal(env.flushes(),0);assert.deepEqual(env.rows(),[env.original]);
});

test('operações recusadas não são reenviadas ao focar',async()=>{
  const env=setup({status:'failed'});env.focus();await settle();
  assert.equal(env.sends(),0);assert.deepEqual(env.rows(),[env.original]);
});

test('após logout não envia fila da identidade anterior',async()=>{
  const env=setup();env.logout();env.focus();await settle();
  assert.equal(env.sends(),0);assert.deepEqual(env.rows(),[env.original]);
});

test('desmontagem remove o listener de retentativa',()=>{
  const env=setup();assert(env.listeners.has('focus'));env.cleanup();assert.equal(env.listeners.size,0);
});
