import {queueScope} from './offlineQueue.js';
import {applyOfflineCommand} from './offlineModel.js';
import {readOffline} from './offlineRead.js';
import {localToday} from './commercial.js';
let databasePromise;
const request=req=>new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
function database(){
  if(!globalThis.indexedDB)throw new Error('O armazenamento offline não está disponível neste navegador.');
  return databasePromise ||= new Promise((resolve,reject)=>{const req=indexedDB.open('eletroagro-offline-safe',3);req.onupgradeneeded=()=>{for(const[name,key]of [['pending-requests','id'],['snapshots','scope'],['sessions','id'],['files','key']])if(!req.result.objectStoreNames.contains(name))req.result.createObjectStore(name,{keyPath:key});};req.onsuccess=()=>{const db=req.result;db.onversionchange=()=>{db.close();databasePromise=null;};resolve(db);};req.onerror=()=>{databasePromise=null;reject(req.error);};});
}
async function transact(stores,mode,work){
  const db=await database();let tx;try{tx=db.transaction(stores,mode,mode==='readwrite'?{durability:'strict'}:undefined);}catch{tx=db.transaction(stores,mode);}const done=new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||new Error('A gravação offline foi interrompida.'));tx.onerror=()=>{};});
  try{const result=await work(name=>tx.objectStore(name));await done;return result;}catch(error){try{tx.abort();}catch{}await done.catch(()=>{});if(error.name==='QuotaExceededError')throw new Error('O aparelho está sem espaço para salvar offline. Nenhum lançamento foi confirmado. Libere espaço ou reconecte.');throw error;}
}
export const offlineStorage={read:()=>transact(['pending-requests'],'readonly',s=>request(s('pending-requests').getAll())),put:row=>transact(['pending-requests','snapshots'],'readwrite',async s=>{await request(s('pending-requests').put(row));if(row.status==='failed'){const record=await request(s('snapshots').get(row.scope));if(record){for(const collection of ['customers','catalog','suppliers','sales','entries','purchases','appointments'])for(const entity of record.data[collection]||[])if(entity.local_operation_id===row.id){entity.sync_status='failed';entity.sync_error=row.error;}record.revision=(record.revision||0)+1;await request(s('snapshots').put(record));}}}),remove:id=>transact(['pending-requests'],'readwrite',s=>request(s('pending-requests').delete(id)))};
export async function offlineSession(){return transact(['sessions'],'readonly',async s=>(await request(s('sessions').get('active')))?.user||null);}
export async function rememberOfflineSession(user){if(!user?.issuer||!user?.subject||!user?.company?.id)return;const safe={issuer:user.issuer,subject:user.subject,email:user.email||'',name:user.name||'',company:user.company,offlineVerifiedAt:navigator.onLine?new Date().toISOString():user.offlineVerifiedAt};await transact(['sessions'],'readwrite',async s=>{await request(s('sessions').put({id:'active',user:safe}));await request(s('sessions').delete('signedout'));});}
export const forgetOfflineSession=()=>transact(['sessions'],'readwrite',async s=>{await request(s('sessions').delete('active'));await request(s('sessions').put({id:'signedout',pending:true}));});
export const offlineLogoutPending=()=>transact(['sessions'],'readonly',async s=>!!(await request(s('sessions').get('signedout')))?.pending);
export const clearOfflineLogout=()=>transact(['sessions'],'readwrite',s=>request(s('sessions').delete('signedout')));
export async function snapshotRecord(context){const scope=queueScope(context);if(!scope)return null;return transact(['snapshots'],'readonly',s=>request(s('snapshots').get(scope)));}
export async function installSnapshot(context,data,expectedRevision){
  const scope=queueScope(context);if(!scope||data.company?.id!==context.companyId)throw new Error('A empresa mudou durante a preparação offline.');
  return transact(['snapshots','pending-requests'],'readwrite',async s=>{
    const queued=(await request(s('pending-requests').getAll())).filter(row=>row.scope===scope);if(queued.length)throw new Error('Sincronize ou revise os lançamentos pendentes antes de substituir os dados offline.');
    const previous=await request(s('snapshots').get(scope));if(expectedRevision!=null&&(previous?.revision||0)!==expectedRevision){const error=new Error('Os dados mudaram durante a preparação. Prepare novamente para não substituir lançamentos mais recentes.');error.code='OFFLINE_SNAPSHOT_CHANGED';throw error;}
    const record={scope,data,preparedAt:data.preparedAt,idMap:previous?.idMap||{},nextSequence:previous?.nextSequence||0,confirmed:previous?.confirmed||{},dirty:false,revision:previous?.revision||0};await request(s('snapshots').put(record));return record;
  });
}
const replaceValues=(value,map)=>typeof value==='string'?(map[value]||value):Array.isArray(value)?value.map(v=>replaceValues(v,map)):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,replaceValues(v,map)])):value;
export async function localRead(context,path){const record=await snapshotRecord(context);if(!record)throw new Error('Prepare os dados offline enquanto estiver conectado para usar esta tela sem internet.');const result=readOffline(record.data,path);if(result.attachments)for(const attachment of result.attachments){const file=await deviceFile(context,attachment.id);if(file)attachment.content_data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file.blob);});}return{...result,offline:true,preparedAt:record.preparedAt,stale:!!record.dirty};}
export async function commitOffline(context,path,options){
  const scope=queueScope(context);if(!scope)throw new Error('Confirme sua conta e empresa antes de trabalhar offline.');
  const headers=Object.fromEntries(new Headers(options.headers||{}).entries()),key=headers['x-idempotency-key']||crypto.randomUUID();delete headers.authorization;
  return transact(['snapshots','pending-requests'],'readwrite',async s=>{
    const record=await request(s('snapshots').get(scope));if(!record)throw new Error('Prepare o modo offline com internet antes de registrar operações neste aparelho.');
    if(record.dirty)throw new Error('Os dados deste aparelho precisam ser atualizados antes de novos lançamentos offline. Reconecte e prepare o modo offline.');
    if(record.confirmed?.[key])return{...record.confirmed[key],offline:true,queued:false};
    const previous=await request(s('pending-requests').get(key));if(previous){if(previous.scope!==scope)throw new Error('Identificador de outra conta.');return{...previous.localResult,queued:true,offline:true,queueId:key,message:'O lançamento já está salvo neste aparelho e aguarda sincronização.'};}
    const command={id:key,path,method:options.method,payload:options.body?JSON.parse(options.body):{},createdAt:Date.now(),localIds:{}};
    const localDate=localToday();if(path==='/api/sales')command.payload.saleDate ||= localDate;
    if(/^\/api\/sales\/[\da-f-]+\/payments$/.test(path))command.payload.receivedDate ||= localDate;
    if(/^\/api\/operations\/finance\/[\da-f-]+\/payments$/.test(path))command.payload.paidAt ||= localDate;
    if(path==='/api/operations/purchases')command.payload.purchaseDate ||= localDate;
    if(path==='/api/operations/finance'){command.payload.competenceDate ||= localDate;if(command.payload.status==='settled')command.payload.settledAt ||= localDate;}
    // Payments against a provisional sale use the sale route after ID remapping.
    const finance=/^\/api\/operations\/finance\/([\da-f-]+)\/payments$/.exec(path);
    if(finance){const entry=record.data.entries.find(e=>e.id===finance[1]);if(entry?.source_type==='sale'&&entry.sale_id){command.path=`/api/sales/${entry.sale_id}/payments`;command.payload={...command.payload,receivedDate:command.payload.paidAt};}}
    const outcome=applyOfflineCommand(record.data,command);record.data=outcome.data;record.nextSequence=(record.nextSequence||0)+1;record.revision=(record.revision||0)+1;
    const row={id:key,scope,companyId:context.companyId,path:command.path,method:command.method,body:JSON.stringify(command.payload),headers,createdAt:command.createdAt,sequence:record.nextSequence,status:'pending',bindings:outcome.bindings,localResult:outcome.result,command};
    await request(s('pending-requests').put(row));await request(s('snapshots').put(record));return{...outcome.result,queued:true,offline:true,queueId:key,message:'Salvo neste aparelho. Documento e pagamentos provisórios aguardam confirmação do servidor.'};
  });
}
export async function outbound(context,row){
  const record=await snapshotRecord(context);if(!record||record.scope!==row.scope)throw new Error('Contexto offline indisponível.');
  const rows=(await offlineStorage.read()).filter(r=>r.scope===row.scope),pendingIds=new Map();for(const r of rows)for(const id of Object.keys(r.bindings||{}))pendingIds.set(id,r.id);
  const payload=JSON.parse(row.body||'{}'),map=record.idMap||{};
  const check=value=>{if(typeof value==='string'&&pendingIds.has(value)&&pendingIds.get(value)!==row.id&&!map[value]){const dependency=rows.find(r=>r.id===pendingIds.get(value));const error=new Error(dependency?.status==='failed'?'Um cadastro ou lançamento necessário foi recusado. Corrija a operação anterior antes de continuar.':'Aguardando a sincronização de um cadastro ou lançamento anterior.');error.code='OFFLINE_DEPENDENCY';throw error;}if(Array.isArray(value))value.forEach(check);else if(value&&typeof value==='object')Object.values(value).forEach(check);};check(payload);row.path.split('/').forEach(check);
  return{path:row.path.split('/').map(p=>map[p]||p).join('/'),body:JSON.stringify(replaceValues(payload,map))};
}
export async function acknowledge(context,row,response){
  return transact(['snapshots','pending-requests'],'readwrite',async s=>{
    const record=await request(s('snapshots').get(row.scope));if(!record)throw new Error('Dados locais ausentes. A confirmação será recuperada no próximo reenvio.');
    const aliases={};for(const[local,selector]of Object.entries(row.bindings||{})){const value=selector.split('.').reduce((v,key)=>v?.[key],response);if(value)aliases[local]=value;}
    Object.assign(record.idMap,aliases);record.data=replaceValues(record.data,aliases);
    if(response.sale?.id){const sale=record.data.sales.find(r=>r.id===response.sale.id);if(sale){sale.is_provisional=false;sale.sale_number=response.sale.sale_number??sale.sale_number;sale.sale_year=response.sale.sale_year??sale.sale_year;}}
    if(response.receipt?.id){const receipt=record.data.receipts.find(r=>r.id===response.receipt.id);if(receipt)Object.assign(receipt,response.receipt,{is_provisional:false,sync_status:'confirmed'});}
    for(const collection of ['customers','catalog','suppliers','transportProfiles','sales','entries','purchases','appointments'])for(const entity of record.data[collection]||[])if(entity.local_operation_id===row.id)entity.sync_status='confirmed';
    record.confirmed ||= {};record.confirmed[row.id]=response;const keys=Object.keys(record.confirmed);if(keys.length>100)delete record.confirmed[keys[0]];
    record.revision=(record.revision||0)+1;
    await request(s('snapshots').put(record));await request(s('pending-requests').delete(row.id));
  });
}
export async function markOfflineDirty(context){const scope=queueScope(context);if(!scope)return;await transact(['snapshots'],'readwrite',async s=>{const record=await request(s('snapshots').get(scope));if(record){record.dirty=true;record.revision=(record.revision||0)+1;await request(s('snapshots').put(record));}});}
export async function pendingFor(context){const scope=queueScope(context);return(await offlineStorage.read()).filter(row=>row.scope===scope);}
export async function resolveKnownReferences(context,path,options){const record=await snapshotRecord(context);if(!record)return{path,options};const map=record.idMap||{},url=new URL(path,'https://offline.local');return{path:url.pathname.split('/').map(part=>map[part]||part).join('/')+url.search,options:options.body?{...options,body:JSON.stringify(replaceValues(JSON.parse(options.body),map))}:options};}
export async function exportOfflineRecovery(context){const scope=queueScope(context);return transact(['snapshots','pending-requests'],'readonly',async s=>({format:'eletroagro-offline-recovery-v1',exportedAt:new Date().toISOString(),scope,snapshot:await request(s('snapshots').get(scope)),pending:(await request(s('pending-requests').getAll())).filter(row=>row.scope===scope)}));}
export async function saveDeviceFile(context,file){const scope=queueScope(context);if(!scope)throw new Error('Entre na empresa para guardar arquivos neste aparelho.');const row={...file,scope,key:`${scope}:${file.id||file.name}`,savedAt:new Date().toISOString()};await transact(['files'],'readwrite',s=>request(s('files').put(row)));return row;}
export async function deviceFiles(context){const scope=queueScope(context);if(!scope)return[];return transact(['files'],'readonly',async s=>(await request(s('files').getAll())).filter(f=>f.scope===scope).sort((a,b)=>b.savedAt.localeCompare(a.savedAt)));}
export async function deviceFile(context,id){const scope=queueScope(context);if(!scope)return null;return transact(['files'],'readonly',s=>request(s('files').get(`${scope}:${id}`)));}
export async function reviseOfflineCommand(context,rowId,payload,fresh,expectedRevision){
  const scope=queueScope(context);if(fresh.company.id!==context.companyId)throw new Error('A empresa mudou. Reabra o sistema.');
  return transact(['snapshots','pending-requests'],'readwrite',async s=>{
    const record=await request(s('snapshots').get(scope));if(!record||(record.revision||0)!==expectedRevision)throw new Error('A fila mudou durante a revisão. Aguarde a sincronização e tente novamente.');
    const rows=(await request(s('pending-requests').getAll())).filter(row=>row.scope===scope).sort((a,b)=>a.sequence-b.sequence),selected=rows.find(row=>row.id===rowId);
    if(rows.some(row=>row.status!=='failed'))throw new Error('Há operações ainda aguardando resposta. Sincronize a fila antes de corrigir os lançamentos recusados.');
    if(selected?.status!=='failed'||!selected.command)throw new Error('Somente operações recusadas pelo servidor podem ser corrigidas.');
    selected.command.payload=payload;selected.body=JSON.stringify(payload);let working=structuredClone(fresh);
    for(const row of rows){if(!row.command)continue;const command={...row.command,payload:replaceValues(row.command.payload,record.idMap||{})};try{const outcome=applyOfflineCommand(working,command);working=outcome.data;row.localResult=outcome.result;row.bindings=outcome.bindings;row.status='pending';row.error='';}catch(error){if(row.id===rowId)throw error;row.status='failed';row.error=error.message;row.excludedFromLocalTotals=true;}await request(s('pending-requests').put(row));}
    record.data=working;record.dirty=false;record.preparedAt=fresh.preparedAt;record.revision=(record.revision||0)+1;await request(s('snapshots').put(record));
  });
}
