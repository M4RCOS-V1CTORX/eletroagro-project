import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

// Execute the actual handler without mounting React or accessing real storage/auth.
const source=readFileSync(new URL('../apps/web/src/App.jsx',import.meta.url),'utf8');
const start=source.indexOf('async function handleSignOut()');
const end=source.indexOf('\n  if (authLoading)',start);
assert(start>=0&&end>start,'logout handler must be present');
const handlerSource=source.slice(start,end).trim();

function setup({online=true,localError,remote}={}){
  const events=[];
  const state={user:{subject:'account-a'},context:{subject:'account-a'},company:'Empresa A'};
  // Stored business data remain owned by the same identity after logout.
  const stored={pending:[{id:'pending-a',scope:'account-a'}],snapshot:{scope:'account-a'},files:['document-a']};
  const before=structuredClone(stored);
  const logout=runInNewContext(`(${handlerSource})`,{
    navigator:{onLine:online},
    forgetOfflineSession:async()=>{events.push('local-logout');if(localError)throw localError;},
    setApiContext:value=>{state.context=value;events.push('context');},
    setUser:value=>{state.user=value;events.push('user');},
    setCompanyName:value=>{state.company=value;},
    setAuthBusy:value=>{state.busy=value;},
    setPage:()=>{},setMobileMoreOpen:()=>{},setAuthError:()=>{},setAuthNotice:()=>{},
    authClient:{signOut:async()=>{
      events.push('remote-logout');
      assert.equal(state.user,null);
      assert.equal(state.context,null);
      assert.equal(state.company,'');
      return remote?.();
    }},
  });
  return{logout,state,events,stored,before};
}

test('logout limpa a interface antes de aguardar autenticação remota',async()=>{
  let finish;
  const waiting=new Promise(resolve=>{finish=resolve;});
  const env=setup({remote:()=>waiting});
  const result=env.logout();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(env.events,['local-logout','context','user','remote-logout']);
  assert.equal(env.state.user,null);
  assert.equal(env.state.context,null);
  assert.equal(env.state.busy,true);
  assert.deepEqual(env.stored,env.before);
  finish();await result;assert.equal(env.state.busy,false);
});

test('falha remota não restaura a conta nem remove lançamentos locais',async()=>{
  const env=setup({remote:()=>{throw new Error('Sem conexão');}});
  await env.logout();
  assert.equal(env.state.user,null);
  assert.equal(env.state.context,null);
  assert.deepEqual(env.stored,env.before);
});

test('logout offline limpa a interface sem chamar autenticação remota',async()=>{
  const env=setup({online:false});
  await env.logout();
  assert.deepEqual(env.events,['local-logout','context','user']);
  assert.equal(env.state.user,null);
  assert.deepEqual(env.stored,env.before);
});

test('falha ao registrar saída local mantém o erro e não inicia saída remota',async()=>{
  const error=new Error('Armazenamento indisponível');
  const env=setup({localError:error});
  await assert.rejects(env.logout(),failure=>failure===error);
  assert.deepEqual(env.events,['local-logout']);
  assert.equal(env.state.user.subject,'account-a');
  assert.equal(env.state.busy,false);
  assert.deepEqual(env.stored,env.before);
});
