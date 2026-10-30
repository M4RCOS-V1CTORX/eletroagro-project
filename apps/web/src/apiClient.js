import {offlineStorage,snapshotRecord,installSnapshot,localRead,commitOffline,outbound,acknowledge,markOfflineDirty,pendingFor,resolveKnownReferences,reviseOfflineCommand,exportOfflineRecovery,offlineSession,rememberOfflineSession,forgetOfflineSession,offlineLogoutPending,clearOfflineLogout} from './offlineStore.js';
import { getAuthAccessToken } from './authClient.js';
import { apiUrl } from './apiUrl.js';
import { canQueue, createOfflineQueue, queueScope } from './offlineQueue.js';
import {ensureOfflineShell} from './offlineShell.js';

let currentContext=null;
export function setApiContext(context){currentContext=context?{...context,apiUrl}:null;}
function assertSameContext(context){
  if(currentContext!==context){const error=new Error('A sessão mudou. Reabra a tela na conta atual. Os dados permanecem na conta original.');error.code='SESSION_CONTEXT_CHANGED';throw error;}
}

const queue=createOfflineQueue({
  context:()=>currentContext,
  read:offlineStorage.read,put:offlineStorage.put,remove:offlineStorage.remove,
  send:async row=>{
    const context=currentContext;
    const checkContext=()=>{if(!context||currentContext!==context||queueScope(context)!==row.scope)throw new Error('A sessão mudou. O lançamento continua guardado na conta original.');};
    checkContext();
    const token=await getAuthAccessToken(undefined,{forceRefresh:true});
    checkContext();assertAccount(token);
    const resolved=await outbound(context,row);
    checkContext();
    const response=await send(resolved.path,{method:row.method,body:resolved.body,headers:{...row.headers,'x-idempotency-key':row.id,'x-company-context':row.companyId}},token);
    checkContext();
    return response;
  },
  confirmed:(row,result)=>{
    if(queueScope(currentContext)!==row.scope)throw new Error('A sessão mudou. A confirmação será recuperada pela conta original.');
    return acknowledge(currentContext,row,result);
  },
  changed:()=>announceQueue(),
});
export async function offlineQueueCount(){return (await queue.summary()).remaining;}
export const listOfflineQueue=async()=>{const context=currentContext;const rows=await queue.list();assertSameContext(context);return rows;};
export const getApiContext=()=>currentContext;
export {offlineSession,rememberOfflineSession,forgetOfflineSession,offlineLogoutPending,clearOfflineLogout};
export const offlineRecovery=async()=>{const context=currentContext;const result=await exportOfflineRecovery(context);assertSameContext(context);return result;};

async function announceQueue() {
  const summary=await queue.summary();
  window.dispatchEvent(new CustomEvent('eletroagro:offline-queue', { detail: { count: summary.remaining,failed:summary.failed } }));
}

async function enqueue(path, options, context=currentContext) {
  const result=await commitOffline(context,path,options);
  // The write is already committed. A status refresh must not report it as failed.
  await announceQueue().catch(()=>{});
  if(navigator.onLine)flushOfflineQueue().catch(()=>{});
  return result;
}

async function send(path, options, token) {
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),25000);
  const headers=new Headers();for(const[key,value]of Object.entries(options.headers||{}))headers.set(key,value);headers.set('Authorization',`Bearer ${token}`);if(options.body&&!headers.has('Content-Type'))headers.set('Content-Type','application/json');
  const abort=()=>controller.abort();options.signal?.addEventListener('abort',abort,{once:true});
  try{return await fetch(`${apiUrl}${path}`, { ...options,signal:controller.signal, headers });}
  finally{clearTimeout(timeout);options.signal?.removeEventListener('abort',abort);}
}

const inFlightWrites=new Map();
export function apiRequest(path,options={}){
  const method=(options.method||'GET').toUpperCase();if(['GET','HEAD'].includes(method))return executeRequest(path,options);
  const explicitKey=new Headers(options.headers||{}).get('x-idempotency-key');
  const key=JSON.stringify([currentContext,method,path,options.body||'',explicitKey]);if(inFlightWrites.has(key))return inFlightWrites.get(key);
  const result=executeRequest(path,options).finally(()=>inFlightWrites.delete(key));inFlightWrites.set(key,result);return result;
}
async function executeRequest(path, options = {}) {
  const context=currentContext;
  const checkContext=()=>{if(currentContext!==context){const error=new Error('A sessão mudou. Reabra a tela na conta atual. Lançamentos locais permanecem na conta original.');error.code='SESSION_CONTEXT_CHANGED';throw error;}};
  const checked=async promise=>{const result=await promise;checkContext();return result;};
  const readLocal=()=>{checkContext();return checked(localRead(context,path));};
  const saveLocal=()=>checked(enqueue(path,options,context));
  if(context){const resolved=await checked(resolveKnownReferences(context,path,options));path=resolved.path;options=resolved.options;}
  const method = (options.method || 'GET').toUpperCase();
  const pending=context?await checked(pendingFor(context)):[];
  if(method==='GET'&&pending.length){try{return await readLocal();}catch(error){checkContext();if(!navigator.onLine)throw error;}}
  if(method==='DELETE'&&pending.length)throw new Error('Existem lançamentos locais pendentes. Sincronize ou revise a fila antes de excluir cadastros.');
  const queueable=canQueue(path,method);
  const headers=Object.fromEntries(new Headers(options.headers||{}).entries());
  if(context?.companyId)headers['x-company-context']=context.companyId;
  if(queueable&&!headers['x-idempotency-key'])headers['x-idempotency-key']=crypto.randomUUID();
  options={...options,method,headers};
  if(!navigator.onLine){if(method==='GET')return readLocal();if(queueable)return saveLocal();throw new Error('Esta ação exige conexão. Seus dados foram preservados.');}
  if(queueable&&context&&(await checked(pendingFor(context))).length)return saveLocal();
  let response;
  try {
    const token=await checked(getAuthAccessToken());assertAccount(token);
    response=await send(path,options,token);
    checkContext();
    if(response.status===401){
      const fresh=await checked(getAuthAccessToken(undefined,{forceRefresh:true}).catch(()=>null));
      if(fresh&&fresh!==token){assertAccount(fresh);response=await send(path,options,fresh);checkContext();}
    }
  } catch (error) {
    if(error.code==='SESSION_CONTEXT_CHANGED')throw error;
    if(options.signal?.aborted)throw error;
    const transient=error.name==='TypeError'||error.name==='AbortError'||/failed to fetch|network error|load failed|fetch failed/i.test(error.message);
    if(!transient){checkContext();throw error;}
    // Keep uncertain writes under their original identity, even if logout happened
    // while the transport was pending. Never return that result to the new session.
    if(queueable)return saveLocal();
    checkContext();
    if(method==='GET'&&context&&await checked(snapshotRecord(context)))return readLocal();
    throw new Error(error.name==='AbortError'?'O servidor demorou para responder. Tente novamente; seus dados foram preservados.':navigator.onLine ? 'Não foi possível conectar ao servidor.' : 'Você está sem internet. Reconecte para carregar esta tela.');
  }
  if(response.status>=500){
    if(queueable)return saveLocal();
    if(method==='GET'&&context&&await checked(snapshotRecord(context)))return readLocal();
  }
  let body={};if(response.status!==204){try{body=await response.json();}catch{if(queueable&&response.ok)return saveLocal();checkContext();throw new Error('A resposta do servidor chegou incompleta. Tente novamente; os dados digitados foram preservados.');}}
  checkContext();
  if (!response.ok) {const error=new Error(body.error?.message || 'Não foi possível concluir a operação.');error.status=response.status;error.code=body.error?.code;throw error;}
  if(!['GET','HEAD'].includes(method)&&context){try{if(await checked(snapshotRecord(context))){await checked(markOfflineDirty(context));refreshAfterWrite();}}catch(error){checkContext();notifyOffline({error:`A operação foi confirmada no servidor, mas o armazenamento offline precisa de atenção: ${error.message}`});}}
  checkContext();
  return body;
}

export async function flushOfflineQueue(options) {
  if (!navigator.onLine || !('indexedDB' in window)) return { sent: 0, remaining: currentContext?await offlineQueueCount():0,failed:0 };
  const context=currentContext;
  const result=await queue.flush(options);
  if(currentContext!==context)return{sent:0,...await queue.summary()};
  if(result.sent&&result.remaining===0){await prepareOfflineState().catch(error=>{if(currentContext===context)notifyOffline({error:error.message});});if(currentContext===context)window.dispatchEvent(new Event('eletroagro:offline-synced'));}
  return result;
}

function assertAccount(token){
  if(!currentContext)return;
  try{const part=token.split('.')[1];const payload=JSON.parse(atob(part.replaceAll('-','+').replaceAll('_','/')));if(payload.sub!==currentContext.subject||payload.iss!==currentContext.issuer)throw new Error();}
  catch{throw new Error('A conta da sessão mudou. Reabra o sistema antes de continuar.');}
}
function notifyOffline(detail){window.dispatchEvent(new CustomEvent('eletroagro:offline-status',{detail}));}
async function refreshAfterWrite(){for(let attempt=0;attempt<2;attempt++){try{await prepareOfflineState();return;}catch(error){if(error.code==='OFFLINE_SNAPSHOT_CHANGED'&&attempt===0)continue;notifyOffline({error:error.message});return;}}}
let preparing=null,preparingContext=null;
export async function prepareOfflineState(){
  const context=currentContext;
  if(preparing){assertSameContext(preparingContext);return preparing;}
  if(!context?.companyId)throw new Error('Entre na empresa antes de preparar o modo offline.');if(!navigator.onLine)throw new Error('Conecte à internet para preparar os dados neste aparelho.');
  const checked=async promise=>{const result=await promise;assertSameContext(context);return result;};
  preparingContext=context;
  preparing=(async()=>{notifyOffline({preparing:true});if((await checked(pendingFor(context))).length)throw new Error('Existem lançamentos locais aguardando confirmação. Sincronize ou revise a fila antes de atualizar.');
    const revision=(await checked(snapshotRecord(context)))?.revision||0;
    const token=await checked(getAuthAccessToken());assertAccount(token);const response=await checked(send('/api/offline/snapshot',{headers:{'X-Company-Context':context.companyId}},token));const result=await checked(response.json());if(!response.ok)throw new Error(result.error?.message||'Não foi possível preparar os dados offline.');
    if(result.snapshot.attachments?.length){const {storeAttachment}=await checked(import('./deviceFiles.js'));for(const orderId of new Set(result.snapshot.attachments.map(a=>a.service_order_id))){notifyOffline({preparing:true,step:'Guardando fotos e anexos no aparelho…'});const filesResponse=await checked(send(`/api/completion/service-orders/${orderId}/attachments`,{headers:{'X-Company-Context':context.companyId}},token));if(!filesResponse.ok)throw new Error('Não foi possível guardar todos os anexos. Os dados anteriores foram preservados.');const files=await checked(filesResponse.json());for(const attachment of files.attachments||[])await checked(storeAttachment(context,{...attachment,service_order_id:orderId}));}}
    await checked(Promise.all([import('./SalesPage.jsx'),import('./CustomersPage.jsx'),import('./CatalogPage.jsx'),import('./SuppliersPage.jsx'),import('./QuotesPage.jsx'),import('./OperationsPages.jsx'),import('./ReceiptsPage.jsx'),import('./ReportsPage.jsx'),import('./SettingsPage.jsx'),import('jspdf')]));
    if(import.meta.env.PROD)await checked(ensureOfflineShell());
    await checked(installSnapshot(context,result.snapshot,revision));const persistent=await checked(navigator.storage?.persist?.().catch(()=>false));notifyOffline({preparing:false,persistent,preparedAt:result.snapshot.preparedAt,error:''});return result.snapshot;
  })();try{return await preparing;}finally{preparing=null;preparingContext=null;if(currentContext===context)notifyOffline({preparing:false});}
}
export async function offlineStatus(){const record=await snapshotRecord(currentContext),estimate=await navigator.storage?.estimate?.().catch(()=>null);return{prepared:!!record,preparedAt:record?.preparedAt,dirty:record?.dirty||false,estimate,...await queue.summary(),persistent:await navigator.storage?.persisted?.().catch(()=>false)};}
export async function correctOfflineOperation(id,payload){
  if(!navigator.onLine)throw new Error('Conecte à internet para conferir e corrigir uma operação recusada.');
  const context=currentContext;
  const checked=async promise=>{const result=await promise;assertSameContext(context);return result;};
  const record=await checked(snapshotRecord(context)),token=await checked(getAuthAccessToken());assertAccount(token);
  const response=await checked(send('/api/offline/snapshot',{headers:{'x-company-context':context.companyId}},token));const body=await checked(response.json());if(!response.ok)throw new Error(body.error?.message||'Não foi possível conferir o estado do servidor.');
  await checked(reviseOfflineCommand(context,id,payload,body.snapshot,record?.revision||0));await checked(announceQueue());window.dispatchEvent(new Event('eletroagro:offline-synced'));
}
