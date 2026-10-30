const {chromium}=require('C:/Users/USER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const base='http://127.0.0.1:5298',folder='tmp/offline-20261030',results=[];
let browser,admin;
const control=async data=>{const response=await admin.post(base+'/qa/control',{data});assert.equal(response.status(),200);};
const heading=async page=>{try{await page.getByRole('heading',{name:'Visão geral',exact:true}).waitFor({timeout:30000});}catch(error){console.error('HEADING_DIAGNOSTIC',await page.locator('body').innerText(),await page.context().cookies());await page.screenshot({path:folder+'/boundary-failure.png',fullPage:true});throw error;}};
async function ready(page){await heading(page);await page.waitForFunction(async()=>globalThis.__qa&&(await __qa.api.offlineStatus()).prepared,{},{timeout:30000});await page.evaluate(()=>__qa.api.prepareOfflineState());}
async function create(subject='a',mobile=false){
  const context=await browser.newContext(mobile?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{viewport:{width:1365,height:900}});
  await context.addCookies([{name:'qa-user',value:subject,url:base}]);
  await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort('blockedbyclient'));
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const close=context.close.bind(context);context.close=async()=>{await close();assert.deepEqual(errors,[],'Unhandled browser application error');};
  return{context,page,errors};
}
async function record(name,run){try{const details=await run();results.push({name,result:'PASS',details});console.log('PASS '+name);}catch(error){results.push({name,result:'FAIL',error:String(error),stack:error.stack});throw error;}finally{fs.writeFileSync(folder+'/browser-boundaries.json',JSON.stringify({browser:await browser.version(),results},null,2));}}
function gate(){let enter,release;return{entered:new Promise(r=>enter=r),waiting:new Promise(r=>release=r),enter:()=>enter(),release:()=>release()};}
async function completeRecordedLogout(page){await page.reload();await page.waitForFunction(async()=>globalThis.__qa&&!(await __qa.api.offlineLogoutPending()),{},{timeout:15000});await page.getByRole('heading',{name:'Crie sua conta',exact:true}).waitFor({timeout:15000});}
(async()=>{
  browser=await chromium.launch({channel:'msedge',headless:true});admin=await browser.newContext();admin=admin.request;
  try{
    await control({kind:'release',version:'v1'});
    await record('Preparação incompleta não declara dados prontos; recuperação sem apagar armazenamento',async()=>{
      await control({kind:'manifest-failure',enabled:true});const env=await create('b');
      try{
        await env.page.goto(base);await heading(env.page);
        const result=await env.page.evaluate(async()=>{let error;try{await __qa.api.prepareOfflineState();}catch(e){error=e.message;}return{error,status:await __qa.api.offlineStatus()};});
        assert.match(result.error,/arquivos.*não estão prontos/);assert.equal(result.status.prepared,false);
        await control({kind:'manifest-failure',enabled:false});
        await env.page.evaluate(async()=>{const reg=await navigator.serviceWorker.getRegistration();if(reg)await reg.update();await __qa.api.prepareOfflineState();});
        assert.equal(await env.page.evaluate(async()=>(await __qa.api.offlineStatus()).prepared),true);return{rejectedIncomplete:true,recovered:true};
      }finally{await control({kind:'manifest-failure',enabled:false});await env.context.close();}
    });
    await record('Atualização v1 para v2 preserva fila, snapshot e PDF; nova versão reabre offline',async()=>{
      const env=await create();const {page,context}=env;
      try{
        await page.goto(base);await ready(page);assert.equal(await page.evaluate(()=>__qa.build),'v1');
        await context.setOffline(true);
        const before=await page.evaluate(async()=>{await __qa.api.apiRequest('/api/customers',{method:'POST',body:JSON.stringify({name:'Pendência preservada entre versões'})});await __qa.store.saveDeviceFile(__qa.api.getApiContext(),{id:'upgrade-file',name:'Arquivo de teste',blob:new Blob(['isolated']),kind:'pdf'});return{recovery:JSON.stringify(await __qa.api.offlineRecovery()),keys:await caches.keys()};});
        await page.route('**/neon-auth/get-session',route=>route.abort('internetdisconnected'));
        await page.route('**/api/health',route=>route.abort('internetdisconnected'));
        await context.setOffline(false);await control({kind:'release',version:'v2'});
        await page.evaluate(async()=>{const reg=await navigator.serviceWorker.getRegistration();await reg.update();});
        await page.waitForFunction(async old=>(await caches.keys()).some(key=>key.startsWith('eletroagro-shell-')&&!old.includes(key)),before.keys,{timeout:30000});
        await page.reload();await heading(page);await page.waitForFunction(()=>__qa.build==='v2');
        const after=await page.evaluate(async()=>({recovery:JSON.stringify(await __qa.api.offlineRecovery()),files:(await __qa.store.deviceFiles(__qa.api.getApiContext())).length,keys:await caches.keys(),authCached:!!(await caches.match('/neon-auth/get-session'))}));
        assert.equal(after.recovery.replace(/"exportedAt":"[^"]+"/,'"exportedAt":"time"'),before.recovery.replace(/"exportedAt":"[^"]+"/,'"exportedAt":"time"'));
        assert.equal(after.files,1);assert.equal(after.authCached,false);
        let refusal;try{await page.evaluate(()=>__qa.api.prepareOfflineState());}catch(e){refusal=e.message;}assert.match(refusal,/lançamentos locais aguardando/);
        await context.setOffline(true);await page.reload();await heading(page);assert.equal(await page.evaluate(()=>__qa.build),'v2');
        assert.equal(await page.evaluate(async()=>(await __qa.api.listOfflineQueue()).length),1);
        await page.screenshot({path:folder+'/updated-offline.png',fullPage:true});
        await page.unroute('**/neon-auth/get-session');await page.unroute('**/api/health');await context.setOffline(false);
        await page.evaluate(()=>__qa.api.flushOfflineQueue());await page.waitForFunction(async()=>(await __qa.api.listOfflineQueue()).length===0);
        return{oldCaches:before.keys,newCaches:after.keys,pendingAndFilePreserved:true,synchronizedAfterUpgrade:true};
      }finally{await env.context.close();await control({kind:'release',version:'v1'});}
    });
    await record('Resposta de consulta atrasada não retorna dados à identidade nova',async()=>{
      const env=await create();const {page}=env;const held=gate();
      try{
        await page.goto(base);await ready(page);
        const original=await page.evaluate(()=>__qa.api.getApiContext());
        await page.route('**/api/customers?race=read',async route=>{const response=await route.fetch();held.enter();await held.waiting;await route.fulfill({response});});
        await page.evaluate(()=>{globalThis.__race=__qa.api.apiRequest('/api/customers?race=read').then(data=>({data}),error=>({error:error.code}));});
        await held.entered;await page.evaluate(()=>__qa.api.setApiContext({...__qa.api.getApiContext(),subject:'b'}));held.release();
        const result=await page.evaluate(()=>__race);assert.equal(result.error,'SESSION_CONTEXT_CHANGED');assert.equal(result.data,undefined);
        await page.evaluate(value=>__qa.api.setApiContext(value),original);return{oldResponseBlocked:true};
      }finally{held.release();await env.context.close();}
    });
    await record('Troca durante gravação do snapshot não entrega preparação à nova sessão',async()=>{
      const env=await create();try{await env.page.goto(base);await ready(env.page);
        const result=await env.page.evaluate(async()=>{
          const context=__qa.api.getApiContext(),put=IDBObjectStore.prototype.put;let switched=false,error,returned;
          IDBObjectStore.prototype.put=function(...args){const request=put.apply(this,args);if(this.name==='snapshots'&&!switched){switched=true;__qa.api.setApiContext({...context,subject:'b'});}return request;};
          try{returned=await __qa.api.prepareOfflineState();}catch(e){error=e.code;}finally{IDBObjectStore.prototype.put=put;}
          const other=await __qa.store.snapshotRecord(__qa.api.getApiContext());__qa.api.setApiContext(context);
          return{error,returned:!!returned,switched,otherSnapshot:!!other,originalSnapshot:!!(await __qa.store.snapshotRecord(__qa.api.getApiContext()))};
        });assert(result.switched);assert.equal(result.error,'SESSION_CONTEXT_CHANGED');assert.equal(result.returned,false);assert.equal(result.otherSnapshot,false);assert(result.originalSnapshot);return result;
      }finally{await env.context.close();}
    });
    await record('Exportação iniciada antes da troca não entrega recuperação de outra conta',async()=>{
      const env=await create();try{await env.page.goto(base);await ready(env.page);
        const result=await env.page.evaluate(async()=>{
          const context=__qa.api.getApiContext(),get=IDBObjectStore.prototype.get;let switched=false,error,returned;
          IDBObjectStore.prototype.get=function(...args){const request=get.apply(this,args);if(this.name==='snapshots'&&!switched){switched=true;__qa.api.setApiContext({...context,subject:'b'});}return request;};
          try{returned=await __qa.api.offlineRecovery();}catch(e){error=e.code;}finally{IDBObjectStore.prototype.get=get;__qa.api.setApiContext(context);}
          return{error,returned:!!returned,switched};
        });assert(result.switched);assert.equal(result.error,'SESSION_CONTEXT_CHANGED');assert.equal(result.returned,false);return result;
      }finally{await env.context.close();}
    });
    await record('Resposta de escrita perdida durante troca preserva fila somente na conta original',async()=>{
      const env=await create();const {page}=env;const held=gate();
      try{
        await page.goto(base);await ready(page);const original=await page.evaluate(()=>__qa.api.getApiContext());
        await page.route('**/api/customers',async route=>{if(route.request().method()!=='POST')return route.continue();held.enter();await held.waiting;await route.abort('failed');});
        await page.evaluate(()=>{globalThis.__race=__qa.api.apiRequest('/api/customers',{method:'POST',body:JSON.stringify({name:'Escrita interrompida durante troca'})}).then(data=>({data}),error=>({error:error.code}));});
        await held.entered;await page.evaluate(()=>__qa.api.setApiContext({...__qa.api.getApiContext(),subject:'b'}));held.release();
        assert.equal((await page.evaluate(()=>__race)).error,'SESSION_CONTEXT_CHANGED');
        const stored=await page.evaluate(async()=>({visible:await __qa.api.listOfflineQueue(),all:await __qa.store.offlineStorage.read()}));
        assert.equal(stored.visible.length,0);assert.equal(stored.all.length,1);assert(stored.all[0].scope.includes('"a"'));
        await page.unroute('**/api/customers');await page.evaluate(value=>__qa.api.setApiContext(value),original);await page.evaluate(()=>__qa.api.flushOfflineQueue());
        assert.equal(await page.evaluate(async()=>(await __qa.api.listOfflineQueue()).length),0);return{oldQueueOnly:true,recovered:true};
      }finally{held.release();await env.context.close();}
    });
    await record('Logout durante token pendente não envia lançamento nem restaura a sessão',async()=>{
      const env=await create();const {page,context}=env;const held=gate();
      try{
        await page.goto(base);await ready(page);await context.setOffline(true);
        const row=await page.evaluate(async()=>{await __qa.api.apiRequest('/api/customers',{method:'POST',body:JSON.stringify({name:'Fila durante token pendente'})});return(await __qa.api.listOfflineQueue())[0];});
        await page.route('**/neon-auth/get-session',async route=>{const response=await route.fetch();held.enter();await held.waiting;await route.fulfill({response});});
        await context.setOffline(false);await held.entered;await page.getByRole('button',{name:'Sair',exact:true}).click();await page.waitForFunction(()=>!__qa.api.getApiContext());held.release();await page.waitForTimeout(300);
        const evidence=await(await admin.get(base+'/qa/evidence')).json();assert.equal(evidence.requests.filter(r=>r.key===row.id).length,0);
        const saved=await page.evaluate(async()=>({rows:await __qa.store.offlineStorage.read(),session:await __qa.api.offlineSession()}));assert.equal(saved.rows[0].id,row.id);assert.equal(saved.session,null);
        return{notSent:true,queuePreserved:true};
      }finally{held.release();await env.context.close();}
    });
    await record('Logout remoto pendente esconde dados e impede novo login até terminar',async()=>{
      const env=await create();const held=gate();try{await env.page.goto(base);await ready(env.page);
        await env.page.route('**/qa/logout',async route=>{const response=await route.fetch();held.enter();await held.waiting;await route.fulfill({response});});
        await env.page.getByRole('button',{name:'Sair',exact:true}).click();await held.entered;
        await env.page.getByRole('heading',{name:'Crie sua conta',exact:true}).waitFor();
        assert.equal(await env.page.getByRole('heading',{name:'Visão geral',exact:true}).count(),0);
        assert.equal(await env.page.locator('.auth-submit').isDisabled(),true);
        held.release();await env.page.waitForFunction(()=>!document.querySelector('.auth-submit').disabled);return{dataHidden:true,newAuthenticationWaited:true};
      }finally{held.release();await env.context.close();}
    });
    await record('COMMIT antes do logout: fila preservada, conta B isolada e reenvio por A sem duplicar',async()=>{
      const env=await create();const {page,context}=env;const held=gate();
      try{
        await page.goto(base);await ready(page);await context.setOffline(true);
        const name='COMMIT durante logout '+Date.now();
        const row=await page.evaluate(async name=>{await __qa.api.apiRequest('/api/customers',{method:'POST',body:JSON.stringify({name})});return(await __qa.api.listOfflineQueue())[0];},name);
        await page.route('**/api/customers',async route=>{if(route.request().method()!=='POST')return route.continue();const response=await route.fetch();assert.equal(response.status(),201);held.enter();await held.waiting;await route.fulfill({response});});
        await context.setOffline(false);await held.entered;await page.getByRole('button',{name:'Sair',exact:true}).click();await page.waitForFunction(()=>!__qa.api.getApiContext());held.release();await page.waitForTimeout(300);await page.unroute('**/api/customers');
        assert.equal(await page.evaluate(async()=>(await __qa.store.offlineStorage.read())[0].id),row.id);
        await completeRecordedLogout(page);await context.addCookies([{name:'qa-user',value:'b',url:base}]);await page.reload();await ready(page);
        assert.equal(await page.evaluate(async()=>(await __qa.api.listOfflineQueue()).length),0);
        const seen=await page.evaluate(async name=>(await __qa.api.apiRequest('/api/customers?q='+encodeURIComponent(name))).customers.length,name);assert.equal(seen,0);
        await page.getByRole('button',{name:'Sair',exact:true}).click();await page.waitForFunction(()=>!__qa.api.getApiContext());await completeRecordedLogout(page);
        await context.addCookies([{name:'qa-user',value:'a',url:base}]);await page.reload();await heading(page);await page.waitForFunction(async()=>(await __qa.api.listOfflineQueue()).length===0);
        const count=await page.evaluate(async name=>(await __qa.api.apiRequest('/api/customers?q='+encodeURIComponent(name))).customers.length,name);assert.equal(count,1);
        const evidence=await(await admin.get(base+'/qa/evidence')).json();const attempts=evidence.requests.filter(r=>r.key===row.id);assert.equal(attempts.length,2);assert(attempts.every(r=>r.company===row.companyId));
        return{attempts:2,records:1,otherAccountSaw:0};
      }finally{held.release();await env.context.close();}
    });
    await record('Sessão expirada não confirma escrita nem converte recusa de auth em offline',async()=>{
      const env=await create();const {page,context}=env;
      try{await page.goto(base);await ready(page);await context.addCookies([{name:'qa-user',value:'expired',url:base}]);
        const result=await page.evaluate(async()=>{let error;try{await __qa.api.apiRequest('/api/customers',{method:'POST',body:JSON.stringify({name:'Não deve salvar sem sessão'})});}catch(e){error=e.message;}return{error,rows:await __qa.api.listOfflineQueue()};});
        assert.match(result.error,/sessão expirou/);assert.equal(result.rows.length,0);return{authErrorPreserved:true};
      }finally{await env.context.close();}
    });
    await record('Edições suportadas, pagamento, agenda e PDF real persistem offline e sincronizam',async()=>{
      const env=await create('b');const {page,context}=env;
      try{await page.goto(base);await ready(page);await context.setOffline(true);
        const local=await page.evaluate(async()=>{
          const {api,store}=__qa,ctx=api.getApiContext(),snapshot=(await store.snapshotRecord(ctx)).data;
          const request=(path,body,method='POST')=>api.apiRequest(path,{method,body:JSON.stringify(body)});
          const supplier=(await request('/api/suppliers',{name:'Fornecedor offline editável'})).supplier;await request('/api/suppliers/'+supplier.id,{name:'Fornecedor offline editado'},'PATCH');
          const item=(await request('/api/catalog',{name:'Serviço offline editável',itemType:'service',unit:'un',salePrice:'5',costPrice:'1'})).item;await request('/api/catalog/'+item.id,{name:'Serviço offline editado',itemType:'service',unit:'un',salePrice:'6',costPrice:'1'},'PATCH');
          const customer=snapshot.customers[0];await request('/api/customers/'+customer.id,{name:'Cliente fictício b editado offline',customerType:'individual'},'PATCH');
          const expense=(await request('/api/operations/finance',{entryType:'expense',title:'Despesa com pagamento offline',amount:'10'})).entry;await request('/api/operations/finance/'+expense.id+'/payments',{amount:'1',paymentMethod:'cash'});
          const appointment=(await request('/api/operations/appointments',{title:'Agenda editável offline',startsAt:new Date(Date.now()+3600000).toISOString()})).appointment;await request('/api/operations/appointments/'+appointment.id+'/status',{status:'completed'},'PATCH');
          const sale=(await request('/api/sales',{customerId:customer.id,paymentMethod:'cash',amountPaid:'1',items:[{catalogItemId:snapshot.catalog[0].id,quantity:'1',unitPrice:'5'}]})).sale;
          const pdf=await __qa.pdf(sale,snapshot.company);const signature=String.fromCharCode(...new Uint8Array(pdf.doc.output('arraybuffer')).slice(0,4));
          let unsupported;try{await request('/api/quotes',{customerId:customer.id});}catch(e){unsupported=e.message;}
          return{count:(await api.listOfflineQueue()).length,files:(await store.deviceFiles(ctx)).length,signature,unsupported};
        });assert.equal(local.count,10);assert(local.files>=1);assert.equal(local.signature,'%PDF');assert.match(local.unsupported,/exige conexão/);
        await page.reload();await heading(page);assert.equal(await page.evaluate(async()=>(await __qa.api.listOfflineQueue()).length),10);
        await context.setOffline(false);await page.evaluate(()=>__qa.api.flushOfflineQueue());
        await page.waitForFunction(async()=>(await __qa.api.listOfflineQueue()).length===0,{},{timeout:30000});return{operations:10,pdfGenerated:true,reloadedAndSynced:true};
      }finally{await env.context.close();}
    });
    await record('HTTP 503 na navegação recupera shell sem perder sessão e snapshot',async()=>{
      const env=await create();try{await env.page.goto(base);await ready(env.page);await control({kind:'navigation-failure',enabled:true});await env.page.reload();await heading(env.page);return{shellFallback:true};}finally{await control({kind:'navigation-failure',enabled:false});await env.context.close();}
    });
    await record('Perfil móvel Edge reabre offline com dados locais',async()=>{
      const env=await create('b',true);try{await env.page.goto(base);await ready(env.page);await env.context.setOffline(true);await env.page.reload();await heading(env.page);const data=await env.page.evaluate(()=>__qa.api.apiRequest('/api/customers'));assert(data.offline);assert(data.customers.length>0);await env.page.screenshot({path:folder+'/mobile-offline.png',fullPage:true});return{viewport:'390x844',engine:'Edge Chromium',physicalDevice:false};}finally{await env.context.close();}
    });
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
