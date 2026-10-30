import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createOfflineQueue,queueScope} from '../apps/web/src/offlineQueue.js';

// Use the actual API queue callbacks with in-memory storage and simulated awaits.
const source=readFileSync(new URL('../apps/web/src/apiClient.js',import.meta.url),'utf8');
const start=source.indexOf('createOfflineQueue({');
const end=source.indexOf('\n});',start);
assert(start>=0&&end>start,'API queue configuration must be present');
const initializer=source.slice(start,end+4);
const account=subject=>({apiUrl:'test-api',issuer:'test-issuer',subject,companyId:'company'});

function setup(stage,change=()=>null){
  const original=account('a');
  const row={id:'original-key',scope:queueScope(original),companyId:original.companyId,path:'/api/customers',method:'POST',body:'{}',headers:{},status:'pending'};
  let rows=[structuredClone(row)];
  const calls={tokens:0,outbound:0,sends:0,confirmed:0};
  const sandbox={
    currentContext:original,queueScope,createOfflineQueue,
    offlineStorage:{read:async()=>structuredClone(rows),put:async value=>{rows=[value];},remove:async()=>{throw new Error('Unexpected direct removal');}},
    getAuthAccessToken:async()=>{calls.tokens++;await transition('token');return 'token-a';},
    assertAccount:token=>{assert.equal(token,'token-a');assert.equal(sandbox.currentContext,original);},
    outbound:async(context,value)=>{calls.outbound++;assert.equal(context,original);assert.equal(value.id,row.id);await transition('outbound');return{path:row.path,body:row.body};},
    send:async(path,options,token)=>{
      calls.sends++;assert.equal(path,row.path);assert.equal(token,'token-a');
      assert.equal(options.headers['x-idempotency-key'],row.id);
      await transition('response');
      return{ok:true,status:201,json:async()=>{await transition('json');return{customer:{id:'server-id'}};}};
    },
    acknowledge:async(context,value)=>{calls.confirmed++;assert.equal(context,original);assert.equal(value.scope,row.scope);rows=[];},
    announceQueue:async()=>{},
  };
  async function transition(point){if(point===stage)sandbox.currentContext=change(original);}
  const queue=runInNewContext(initializer,sandbox);
  return{queue,calls,row,getRows:()=>rows,sandbox,original};
}

test('logout durante renovação do token preserva a operação e impede envio',async()=>{
  const env=setup('token');await env.queue.flush();
  assert.deepEqual(env.calls,{tokens:1,outbound:0,sends:0,confirmed:0});
  assert.deepEqual(env.getRows(),[env.row]);
});

test('troca de conta durante leitura local impede envio com dados antigos',async()=>{
  const env=setup('outbound',()=>account('b'));await env.queue.flush();
  assert.equal(env.calls.sends,0);assert.equal(env.calls.confirmed,0);
  assert.deepEqual(env.getRows(),[env.row]);
});

test('resposta recebida após logout não confirma nem remove operação',async()=>{
  const env=setup('response');await env.queue.flush();
  assert.equal(env.calls.sends,1);assert.equal(env.calls.confirmed,0);
  assert.deepEqual(env.getRows(),[env.row]);
});

test('troca de conta durante leitura da resposta preserva confirmação para a conta original',async()=>{
  const env=setup('json',()=>account('b'));await env.queue.flush();
  assert.equal(env.calls.sends,1);assert.equal(env.calls.confirmed,0);
  assert.deepEqual(env.getRows(),[env.row]);
  env.sandbox.currentContext=env.original;
  const result=await env.queue.flush();
  // The simulated identity change repeats, so the operation is still preserved.
  assert.equal(result.sent,0);assert.deepEqual(env.getRows(),[env.row]);
});

test('nova sessão da mesma conta durante leitura interrompe a rodada antiga',async()=>{
  const env=setup('outbound',original=>({...original}));await env.queue.flush();
  assert.equal(env.calls.sends,0);assert.deepEqual(env.getRows(),[env.row]);
});

test('sessão estável envia e confirma normalmente com a chave original',async()=>{
  const env=setup();const result=await env.queue.flush();
  assert.equal(result.sent,1);assert.equal(result.remaining,0);
  assert.deepEqual(env.calls,{tokens:1,outbound:1,sends:1,confirmed:1});
  assert.deepEqual(env.getRows(),[]);
});
