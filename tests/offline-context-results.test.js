import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../apps/web/src/apiClient.js',import.meta.url),'utf8');
const helper=source.slice(source.indexOf('function assertSameContext('),source.indexOf('\nconst queue='));
function gate(){let resolve;return{promise:new Promise(r=>resolve=r),resolve:value=>resolve(value)};}
function wrappers(){
  const pending=gate(),sandbox={currentContext:{subject:'a'},queue:{list:()=>pending.promise},exportOfflineRecovery:()=>pending.promise};
  const lines=['listOfflineQueue','offlineRecovery'].map(name=>source.split('\n').find(line=>line.startsWith('export const '+name+'=' )).replace('export const','const')).join('\n');
  return{sandbox,pending,...runInNewContext(`${helper}\n${lines}\n({listOfflineQueue,offlineRecovery})`,sandbox)};
}
for(const name of ['listOfflineQueue','offlineRecovery']){
  test(`${name} não entrega dados depois de trocar a sessão`,async()=>{
    const env=wrappers(),result=env[name]();env.sandbox.currentContext={subject:'b'};env.pending.resolve({private:'account-a'});
    await assert.rejects(result,error=>error.code==='SESSION_CONTEXT_CHANGED');
  });
  test(`${name} mantém o resultado na sessão original`,async()=>{
    const env=wrappers(),result=env[name](),expected={private:'account-a'};env.pending.resolve(expected);assert.equal(await result,expected);
  });
}
test('rodada antiga não prepara dados nem emite atualização na nova sessão',async()=>{
  const pending=gate();let preparations=0,events=0;
  const sandbox={currentContext:{subject:'a'},navigator:{onLine:true},window:{indexedDB:{},dispatchEvent:()=>events++},Event,
    queue:{flush:()=>pending.promise,summary:async()=>({remaining:1,failed:0})},prepareOfflineState:async()=>preparations++};
  const start=source.indexOf('export async function flushOfflineQueue('),end=source.indexOf('\nfunction assertAccount(',start);
  const flush=runInNewContext(`(${source.slice(start,end).replace('export ','')})`,sandbox);
  const result=flush();sandbox.currentContext={subject:'b'};pending.resolve({sent:1,remaining:0});
  assert.equal((await result).sent,0);assert.equal(preparations,0);assert.equal(events,0);
});
