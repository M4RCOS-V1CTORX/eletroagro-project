// Smoke test of the uninstrumented release. Real Neon SDK, no real authentication.
const {chromium}=require('C:/Users/USER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const folder='tmp/offline-20261030',root=path.resolve(folder,'release-final');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.jpeg':'image/jpeg'};
const server=http.createServer((req,res)=>{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const target=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!target.startsWith(root+path.sep)||!fs.existsSync(target)||!fs.statSync(target).isFile()){res.writeHead(404);return res.end();}res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(target).pipe(res);});
(async()=>{let browser;try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1280,height:900}});let apiUrl;
  await context.route('**/*',route=>{const url=route.request().url();if(url.endsWith('/api/health'))apiUrl=url.slice(0,-'/api/health'.length);if(url.startsWith(base+'/')&&!url.includes('/neon-auth/'))return route.continue();return route.abort('internetdisconnected');});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(base);
  await page.locator('.auth-card').waitFor({timeout:30000});assert(apiUrl);assert.equal(await page.evaluate(()=>globalThis.__qa),undefined);
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller,{},{timeout:30000});
  const shell=await page.evaluate(()=>new Promise((resolve,reject)=>{const channel=new MessageChannel(),timer=setTimeout(()=>reject(new Error('Shell handshake timeout')),5000);channel.port1.onmessage=event=>{clearTimeout(timer);resolve(event.data);channel.port1.close();};navigator.serviceWorker.controller.postMessage({type:'VERIFY_OFFLINE_SHELL',entry:document.querySelector('script[type="module"]').src},[channel.port2]);}));assert(shell.ready);
  const token='e30.'+Buffer.from(JSON.stringify({iss:'qa-local',sub:'a'})).toString('base64url')+'.qa';
  const snapshotResponse=await context.request.get('http://127.0.0.1:5298/api/offline/snapshot',{headers:{Authorization:'Bearer '+token}});assert.equal(snapshotResponse.status(),200);const snapshot=(await snapshotResponse.json()).snapshot;
  await page.evaluate(async({apiUrl,snapshot})=>{
    const scope=JSON.stringify([apiUrl,'qa-local','a',snapshot.company.id]);
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('eletroagro-offline-safe',3);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    await new Promise((resolve,reject)=>{const tx=db.transaction(['sessions','snapshots'],'readwrite');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
      tx.objectStore('sessions').put({id:'active',user:{issuer:'qa-local',subject:'a',company:snapshot.company}});
      tx.objectStore('snapshots').put({scope,data:snapshot,preparedAt:snapshot.preparedAt,idMap:{},nextSequence:0,confirmed:{},dirty:false,revision:0});});db.close();
  },{apiUrl,snapshot});
  await context.setOffline(true);await page.reload();await page.getByRole('heading',{name:'Visão geral',exact:true}).waitFor({timeout:30000});
  await page.getByRole('link',{name:'Clientes',exact:true}).click();await page.getByRole('button',{name:'Novo cliente',exact:true}).click();await page.getByLabel('Nome ou razão social').fill('Cliente no artefato sem instrumentos');await page.getByRole('button',{name:'Cadastrar cliente',exact:true}).click();await page.getByRole('heading',{name:'Novo cliente',exact:true}).waitFor({state:'hidden'});
  await page.reload();await page.getByRole('heading',{name:'Visão geral',exact:true}).waitFor();
  const rows=await page.evaluate(async()=>{const db=await new Promise(resolve=>{const req=indexedDB.open('eletroagro-offline-safe',3);req.onsuccess=()=>resolve(req.result);});const rows=await new Promise(resolve=>{const request=db.transaction('pending-requests').objectStore('pending-requests').getAll();request.onsuccess=()=>resolve(request.result);});db.close();return rows;});
  assert.equal(rows.length,1);assert.equal(rows[0].scope,JSON.stringify([apiUrl,'qa-local','a',snapshot.company.id]));assert.equal(rows[0].status,'pending');assert.deepEqual(errors,[]);
  await page.screenshot({path:folder+'/release-offline.png',fullPage:true});
  const evidence={result:'PASS',browser:await browser.version(),qaBridgeAbsent:true,realNeonSdkBundled:true,realAuthenticationTested:false,legacyIndexedDbFormatAccepted:true,shellReady:true,offlineReopenAndUiWrite:true,pendingPreservedAfterReload:true,externalRequestsBlocked:true};fs.writeFileSync(folder+'/release-smoke.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}})().catch(error=>{console.error(error);process.exitCode=1;});
