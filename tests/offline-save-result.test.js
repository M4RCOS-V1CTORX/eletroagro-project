import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

// Exercise the actual enqueue function with isolated storage/UI/network callbacks.
// Loading this function alone avoids initializing authentication or browser storage.
const source=readFileSync(new URL('../apps/web/src/apiClient.js',import.meta.url),'utf8');
const start=source.indexOf('async function enqueue(');
const end=source.indexOf('\nasync function send(',start);
assert(start>=0&&end>start,'enqueue function must be present');
const enqueueSource=source.slice(start,end).trim();

function setup({writeError,statusError,online=false,syncError}={}){
  const saved={queued:true,offline:true,queueId:'persisted-operation'};
  const calls={writes:0,status:0,sync:0};
  const context={companyId:'test-company'};
  const enqueue=runInNewContext(`(${enqueueSource})`,{
    currentContext:context,navigator:{onLine:online},
    commitOffline:async(current,path,options)=>{
      calls.writes++;
      assert.equal(current,context);
      assert.equal(path,'/api/customers');
      assert.equal(options.method,'POST');
      if(writeError)throw writeError;
      return saved;
    },
    announceQueue:async()=>{calls.status++;if(statusError)throw statusError;},
    flushOfflineQueue:async()=>{calls.sync++;if(syncError)throw syncError;},
  });
  return{enqueue,saved,calls};
}

test('gravação concluída continua confirmada localmente se o indicador falhar',async()=>{
  const {enqueue,saved,calls}=setup({statusError:new Error('Falha ao reler a fila')});
  assert.equal(await enqueue('/api/customers',{method:'POST'}),saved);
  assert.deepEqual(calls,{writes:1,status:1,sync:0});
});

test('falha real de gravação é propagada sem anunciar sucesso nem sincronizar',async()=>{
  const error=new Error('Sem espaço para gravar');
  const {enqueue,calls}=setup({writeError:error,online:true});
  await assert.rejects(enqueue('/api/customers',{method:'POST'}),failure=>failure===error);
  assert.deepEqual(calls,{writes:1,status:0,sync:0});
});

test('falhas no indicador e no envio não desfazem a confirmação local',async()=>{
  const {enqueue,saved,calls}=setup({online:true,statusError:new Error('Indicador indisponível'),syncError:new Error('Rede indisponível')});
  assert.equal(await enqueue('/api/customers',{method:'POST'}),saved);
  assert.deepEqual(calls,{writes:1,status:1,sync:1});
});

test('salvamento normal mantém atualização do indicador e tentativa de envio',async()=>{
  const {enqueue,saved,calls}=setup({online:true});
  assert.equal(await enqueue('/api/customers',{method:'POST'}),saved);
  assert.deepEqual(calls,{writes:1,status:1,sync:1});
});
