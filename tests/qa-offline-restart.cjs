// Full Edge process restart with a new, test-only disk profile.
const {chromium}=require('C:/Users/USER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const base='http://127.0.0.1:5298',folder='tmp/offline-20261030';
const profile=path.resolve(folder,'profile-'+Date.now());
const launch=()=>chromium.launchPersistentContext(profile,{channel:'msedge',headless:true,viewport:{width:1280,height:900}});
async function restrict(context){await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort('blockedbyclient'));}
(async()=>{let context;try{
  context=await launch();await restrict(context);await context.addCookies([{name:'qa-user',value:'a',url:base}]);
  let page=await context.newPage();await page.goto(base);await page.getByRole('heading',{name:'Visão geral',exact:true}).waitFor({timeout:30000});
  await page.evaluate(()=>__qa.api.prepareOfflineState());await context.setOffline(true);
  const original=await page.evaluate(async()=>{await __qa.api.apiRequest('/api/customers',{method:'POST',body:JSON.stringify({name:'Persistência após encerrar Edge'})});await __qa.store.saveDeviceFile(__qa.api.getApiContext(),{id:'restart-file',name:'Arquivo após reinício',blob:new Blob(['restart-proof']),kind:'pdf'});return{row:(await __qa.api.listOfflineQueue())[0],recovery:JSON.stringify((await __qa.api.offlineRecovery()).snapshot)};});
  const version=context.browser()?.version();await context.close();context=null;
  context=await launch();await restrict(context);await context.setOffline(true);page=await context.newPage();
  await page.goto(base);await page.getByRole('heading',{name:'Visão geral',exact:true}).waitFor({timeout:30000});
  const recovered=await page.evaluate(async()=>({rows:await __qa.api.listOfflineQueue(),snapshot:JSON.stringify((await __qa.api.offlineRecovery()).snapshot),files:await __qa.store.deviceFiles(__qa.api.getApiContext()),session:await __qa.api.offlineSession()}));
  assert.equal(recovered.rows.length,1);assert.equal(recovered.rows[0].id,original.row.id);assert.equal(recovered.snapshot,original.recovery);assert.equal(recovered.files.length,1);assert.equal(recovered.session.subject,'a');assert.equal(recovered.session.token,undefined);
  await page.screenshot({path:folder+'/full-browser-restart.png',fullPage:true});
  await context.setOffline(false);await page.evaluate(()=>__qa.api.flushOfflineQueue());await page.waitForFunction(async()=>(await __qa.api.listOfflineQueue()).length===0);
  const result={result:'PASS',browser:version,fullProcessRestart:true,offlineReopen:true,sameQueueId:true,sameSnapshot:true,filePreserved:true,synchronizedAfterRestart:true};
  fs.writeFileSync(folder+'/browser-restart.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await context?.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
