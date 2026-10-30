// Run only against qa-isolated-server.mjs. Fresh browser context; no user profile.
const {chromium}=require('C:/Users/USER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const base='http://127.0.0.1:5298';
const folder='tmp/offline-20261030';
const results=[];
async function record(name,action){const details=await action();results.push({name,result:'PASS',details});console.log('PASS '+name);}
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  let page,context;
  try{
    context=await browser.newContext({viewport:{width:1365,height:900},acceptDownloads:true});
    await context.addCookies([{name:'qa-user',value:'a',url:base}]);
    // Block any accidental dependency on production or external services.
    await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort('blockedbyclient'));
    page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const control=data=>context.request.post(base+'/qa/control',{data});
    const ready=async()=>{await page.getByRole('heading',{name:'Visão geral',exact:true}).waitFor({timeout:30000});await page.waitForFunction(async()=>globalThis.__qa&&(await __qa.api.offlineStatus()).prepared,{},{timeout:30000});};
    await record('Build de produção: preparação, controle do worker e cache completo',async()=>{
      await page.goto(base);await ready();await page.evaluate(()=>__qa.api.prepareOfflineState());
      const cache=await page.evaluate(async()=>{await __qa.shell();const keys=await caches.keys();return{controlled:!!navigator.serviceWorker.controller,keys,status:await __qa.api.offlineStatus()};});
      assert(cache.controlled);assert(cache.keys.some(key=>/^eletroagro-shell-[a-f0-9]{16}$/.test(key)));assert.equal(cache.status.dirty,false);
      await page.screenshot({path:folder+'/online-prepared.png',fullPage:true});return cache;
    });
    await record('Cadastro pela interface sem rede',async()=>{
      await context.setOffline(true);
      await page.getByRole('link',{name:'Clientes',exact:true}).click();
      await page.getByRole('button',{name:'Novo cliente',exact:true}).click();
      await page.getByLabel('Nome ou razão social').fill('Cliente criado na interface offline');
      await page.getByRole('button',{name:'Cadastrar cliente',exact:true}).click();
      await page.getByRole('heading',{name:'Novo cliente',exact:true}).waitFor({state:'hidden'});
      const rows=await page.evaluate(()=>__qa.api.listOfflineQueue());assert.equal(rows.length,1);assert.equal(rows[0].status,'pending');
      return{pending:rows.length};
    });
    let operations;
    await record('Vendas, pagamento, recibo, despesa, compra, estoque, agenda e arquivo offline',async()=>{
      operations=await page.evaluate(async()=>{
        const {api,store}=__qa,ctx=api.getApiContext(),record=await store.snapshotRecord(ctx),product=record.data.catalog[0];
        const customer=(await api.apiRequest('/api/customers?q=interface')).customers[0];
        const post=(path,body)=>api.apiRequest(path,{method:'POST',body:JSON.stringify(body)});
        const sale=(await post('/api/sales',{customerId:customer.id,paymentMethod:'pix',businessActivity:'farm',amountPaid:'2',items:[{catalogItemId:product.id,quantity:'2',unitPrice:'10'}]})).sale;
        await post(`/api/sales/${sale.id}/payments`,{amount:'3',paymentMethod:'cash'});
        const payment=(await store.snapshotRecord(ctx)).data.financialPayments[0];
        await post('/api/completion/receipts',{paymentId:payment.id});
        await post('/api/operations/finance',{entryType:'expense',title:'Despesa fictícia offline',amount:'12.34',businessActivity:'farm'});
        await post('/api/operations/purchases',{businessActivity:'farm',amountPaid:'0',items:[{catalogItemId:product.id,quantity:'1',unitCost:'1'}]});
        await post('/api/operations/stock/movements',{catalogItemId:product.id,direction:'in',quantity:'1',reason:'Entrada fictícia offline'});
        await post('/api/operations/appointments',{title:'Visita fictícia offline',startsAt:new Date(Date.now()+3600000).toISOString()});
        await store.saveDeviceFile(ctx,{id:'qa-pdf',name:'Documento fictício.pdf',blob:new Blob(['%PDF-1.4\nQA'],{type:'application/pdf'}),kind:'pdf'});
        return{pending:(await api.listOfflineQueue()).length,saleId:sale.id,total:sale.total,paid:(await api.apiRequest('/api/sales/'+sale.id)).sale.amount_paid,company:ctx.companyId,product:product.id};
      });
      assert.equal(operations.pending,8);assert.equal(operations.total,'20.00');assert.equal(operations.paid,'5.00');return operations;
    });
    await record('Fechar e reabrir aba offline preserva sessão, fila, dados e arquivo',async()=>{
      await page.close();page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
      await page.goto(base);await ready();
      const saved=await page.evaluate(async()=>({status:await __qa.api.offlineStatus(),sale:(await __qa.api.apiRequest('/api/sales/'+(await __qa.api.listOfflineQueue()).find(r=>r.path==='/api/sales').localResult.sale.id)).sale,files:(await __qa.store.deviceFiles(__qa.api.getApiContext())).length}));
      assert.equal(saved.status.remaining,8);assert.equal(saved.sale.total,'20.00');assert.equal(saved.sale.amount_paid,'5.00');assert.equal(saved.files,1);
      await page.screenshot({path:folder+'/offline-reopened.png',fullPage:true});return{remaining:saved.status.remaining,files:saved.files};
    });
    await record('Quota excedida reverte fila e snapshot atomicamente',async()=>{
      const result=await page.evaluate(async()=>{
        const before=JSON.stringify(await __qa.store.snapshotRecord(__qa.api.getApiContext())),count=(await __qa.api.listOfflineQueue()).length,original=IDBObjectStore.prototype.put;let message;
        IDBObjectStore.prototype.put=function(...args){if(this.name==='snapshots')throw new DOMException('Full','QuotaExceededError');return original.apply(this,args);};
        try{await __qa.api.apiRequest('/api/operations/finance',{method:'POST',body:JSON.stringify({entryType:'expense',title:'Sem espaço fictício',amount:'1'})});}catch(error){message=error.message;}finally{IDBObjectStore.prototype.put=original;}
        return{message,same:before===JSON.stringify(await __qa.store.snapshotRecord(__qa.api.getApiContext())),before:count,after:(await __qa.api.listOfflineQueue()).length};
      });assert.match(result.message,/sem espaço/);assert(result.same);assert.equal(result.before,result.after);return result;
    });
    await record('Resposta perdida após COMMIT: reenvio sem duplicar venda',async()=>{
      await control({kind:'lost',path:'/sales'});await context.setOffline(false);
      // Wait for the online event's first round before the explicit retry.
      await page.waitForTimeout(2000);
      await page.evaluate(()=>__qa.api.flushOfflineQueue());
      await page.waitForFunction(async()=>(await __qa.api.offlineStatus()).remaining===0,{},{timeout:30000});
      const evidence=await(await context.request.get(base+'/qa/evidence')).json();
      const sales=evidence.requests.filter(r=>r.method==='POST'&&r.path==='/sales');
      assert.equal(evidence.counts.find(r=>r.company_id===operations.company).count,1);
      assert(sales.length>=2);assert.equal(new Set(sales.map(r=>r.key)).size,1);
      return{salesInDatabase:1,attempts:sales.length,sameKey:true};
    });
    await record('Falha transitória HTTP 503 mantém fila; foco recupera envio',async()=>{
      await context.setOffline(true);
      await page.evaluate(()=>__qa.api.apiRequest('/api/customers',{method:'POST',body:JSON.stringify({name:'Retentativa fictícia'})}));
      await control({kind:'503',path:'/customers'});await context.setOffline(false);await page.waitForTimeout(800);
      assert.equal(await page.evaluate(async()=>(await __qa.api.listOfflineQueue()).length),1);
      await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
      await page.waitForFunction(async()=>(await __qa.api.listOfflineQueue()).length===0);return{recovered:true};
    });
    await record('Conflito preserva operação recusada e exige revisão',async()=>{
      await context.setOffline(true);await page.evaluate(()=>__qa.api.apiRequest('/api/customers',{method:'POST',body:JSON.stringify({name:'Conflito fictício'})}));
      await control({kind:'reject',path:'/customers'});await context.setOffline(false);
      await page.waitForFunction(async()=>(await __qa.api.listOfflineQueue()).some(r=>r.status==='failed'));
      await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForTimeout(300);
      const rows=await page.evaluate(()=>__qa.api.listOfflineQueue());assert.equal(rows.length,1);assert.equal(rows[0].status,'failed');
      await page.evaluate(async()=>{const row=(await __qa.api.listOfflineQueue())[0];await __qa.api.correctOfflineOperation(row.id,row.command.payload);await __qa.api.flushOfflineQueue();});
      assert.equal(await page.evaluate(async()=>(await __qa.api.listOfflineQueue()).length),0);return{preserved:true,reviewedAndSynced:true};
    });
    await record('Logout com fila preserva dados; outra identidade não vê nem envia a fila',async()=>{
      await context.setOffline(true);await page.evaluate(()=>__qa.api.apiRequest('/api/customers',{method:'POST',body:JSON.stringify({name:'Pendente exclusiva da conta A'})}));
      const before=await page.evaluate(()=>__qa.api.offlineRecovery());
      await page.getByRole('button',{name:'Sair',exact:true}).click();
      await page.waitForFunction(()=>!__qa.api.getApiContext());
      const result=await page.evaluate(async()=>{const all=await __qa.store.offlineStorage.read();return{active:await __qa.api.offlineSession(),pending:all.length,logout:await __qa.api.offlineLogoutPending()};});
      assert.equal(result.active,null);assert.equal(result.pending,1);assert(result.logout);
      await page.reload();assert.equal(await page.getByRole('heading',{name:'Visão geral',exact:true}).count(),0);
      await context.setOffline(false);
      // Complete the recorded remote logout before starting another test identity.
      await context.request.post(base+'/qa/logout');
      await page.evaluate(()=>__qa.api.clearOfflineLogout());
      await context.addCookies([{name:'qa-user',value:'b',url:base}]);await page.reload();await ready();
      const other=await page.evaluate(async()=>({ctx:__qa.api.getApiContext(),rows:await __qa.api.listOfflineQueue(),customers:(await __qa.api.apiRequest('/api/customers')).customers}));
      assert.equal(other.ctx.subject,'b');assert.equal(other.rows.length,0);assert(other.customers.every(r=>!r.name.includes('conta A')));
      const stored=await page.evaluate(()=>__qa.store.offlineStorage.read());assert.equal(stored.length,1);assert.equal(stored[0].id,before.pending[0].id);
      return{originalQueuePreserved:true,otherAccountPending:other.rows.length};
    });
    await record('Sessão e consulta em rede indisponível com onLine=true usam snapshot',async()=>{
      await page.route('**/api/health',route=>route.abort('internetdisconnected'));
      await page.reload();await ready();await page.unroute('**/api/health');
      await page.route('**/neon-auth/get-session',route=>route.abort('internetdisconnected'));
      const result=await page.evaluate(()=>__qa.api.apiRequest('/api/customers'));assert(result.offline);assert(result.customers.length>=1);
      await page.unroute('**/neon-auth/get-session');return{fallback:true};
    });
    assert.deepEqual(errors,[]);console.log('Browser console: no unhandled application errors');
    fs.writeFileSync(folder+'/browser-results.json',JSON.stringify({browser:await browser.version(),results,errors},null,2));
  }catch(error){
    results.push({result:'FAIL',error:String(error),stack:error.stack});
    fs.writeFileSync(folder+'/browser-results.json',JSON.stringify({results},null,2));
    if(page)await page.screenshot({path:folder+'/failure.png',fullPage:true}).catch(()=>{});
    throw error;
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
