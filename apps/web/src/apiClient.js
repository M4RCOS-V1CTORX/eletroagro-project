import {offlineStorage,snapshotRecord,installSnapshot,localRead,commitOffline,outbound,acknowledge,markOfflineDirty,pendingFor,resolveKnownReferences,reviseOfflineCommand,exportOfflineRecovery,offlineSession,rememberOfflineSession,forgetOfflineSession,offlineLogoutPending,clearOfflineLogout} from './offlineStore.js';
import { getAuthAccessToken } from './authClient.js';
import { apiUrl } from './apiUrl.js';
import { canQueue, createOfflineQueue } from './offlineQueue.js';

let currentContext=null;
export function setApiContext(context){currentContext=context?{...context,apiUrl}:null;}

const queue=createOfflineQueue({
  context:()=>currentContext,
  read:offlineStorage.read,put:offlineStorage.put,remove:offlineStorage.remove,
  send:async row=>{const token=await getAuthAccessToken(undefined,{forceRefresh:true});assertAccount(token);const resolved=await outbound(currentContext,row);return send(resolved.path,{method:row.method,body:resolved.body,headers:{...row.headers,'x-idempotency-key':row.id,'x-company-context':row.companyId}},token);},
  confirmed:(row,result)=>acknowledge(currentContext,row,result),
  changed:()=>announceQueue(),
});
export async function offlineQueueCount(){return (await queue.summary()).remaining;}
export const listOfflineQueue=()=>queue.list();
export const getApiContext=()=>currentContext;
export {offlineSession,rememberOfflineSession,forgetOfflineSession,offlineLogoutPending,clearOfflineLogout};
export const offlineRecovery=()=>exportOfflineRecovery(currentContext);

async function announceQueue() {
  const summary=await queue.summary();
  window.dispatchEvent(new CustomEvent('eletroagro:offline-queue', { detail: { count: summary.remaining,failed:summary.failed } }));
}

async function enqueue(path, options) {
  const result=await commitOffline(currentContext,path,options);await announceQueue();if(navigator.onLine)flushOfflineQueue().catch(()=>{});return result;
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
  if(currentContext){const resolved=await resolveKnownReferences(currentContext,path,options);path=resolved.path;options=resolved.options;}
  const method = (options.method || 'GET').toUpperCase();
  const pending=currentContext?await pendingFor(currentContext):[];
  if(method==='GET'&&pending.length){try{return await localRead(currentContext,path);}catch(error){if(!navigator.onLine)throw error;}}
  if(method==='DELETE'&&pending.length)throw new Error('Existem lançamentos locais pendentes. Sincronize ou revise a fila antes de excluir cadastros.');
  const queueable=canQueue(path,method);
  const headers=Object.fromEntries(new Headers(options.headers||{}).entries());
  if(currentContext?.companyId)headers['x-company-context']=currentContext.companyId;
  if(queueable&&!headers['x-idempotency-key'])headers['x-idempotency-key']=crypto.randomUUID();
  options={...options,method,headers};
  if(!navigator.onLine){if(method==='GET')return localRead(currentContext,path);if(queueable)return enqueue(path,options);throw new Error('Esta ação exige conexão. Seus dados foram preservados.');}
  if(queueable&&currentContext&&(await pendingFor(currentContext)).length)return enqueue(path,options);
  const token = await getAuthAccessToken();assertAccount(token);
  let response;
  try {
    response = await send(path, options, token);
  } catch (error) {
    if(options.signal?.aborted)throw error;
    if(method==='GET'&&currentContext&&await snapshotRecord(currentContext))return localRead(currentContext,path);
    if(queueable) return enqueue(path, options);
    throw new Error(error.name==='AbortError'?'O servidor demorou para responder. Tente novamente; seus dados foram preservados.':navigator.onLine ? 'Não foi possível conectar ao servidor.' : 'Você está sem internet. Reconecte para carregar esta tela.');
  }
  if (response.status === 401) {
    const fresh = await getAuthAccessToken(undefined, { forceRefresh: true }).catch(() => null);
    if (fresh && fresh !== token) {assertAccount(fresh);response = await send(path, options, fresh);}
  }
  let body={};if(response.status!==204){try{body=await response.json();}catch{if(queueable)return enqueue(path,options);throw new Error('A resposta do servidor chegou incompleta. Tente novamente; os dados digitados foram preservados.');}}
  if (!response.ok) {const error=new Error(body.error?.message || 'Não foi possível concluir a operação.');error.status=response.status;error.code=body.error?.code;throw error;}
  if(!['GET','HEAD'].includes(method)&&currentContext){try{if(await snapshotRecord(currentContext)){await markOfflineDirty(currentContext);refreshAfterWrite();}}catch(error){notifyOffline({error:`A operação foi confirmada no servidor, mas o armazenamento offline precisa de atenção: ${error.message}`});}}
  return body;
}

export async function flushOfflineQueue(options) {
  if (!navigator.onLine || !('indexedDB' in window)) return { sent: 0, remaining: currentContext?await offlineQueueCount():0,failed:0 };
  const result=await queue.flush(options);if(result.sent&&result.remaining===0){await prepareOfflineState().catch(error=>notifyOffline({error:error.message}));window.dispatchEvent(new Event('eletroagro:offline-synced'));}return result;
}

function assertAccount(token){
  if(!currentContext)return;
  try{const part=token.split('.')[1];const payload=JSON.parse(atob(part.replaceAll('-','+').replaceAll('_','/')));if(payload.sub!==currentContext.subject||payload.iss!==currentContext.issuer)throw new Error();}
  catch{throw new Error('A conta da sessão mudou. Reabra o sistema antes de continuar.');}
}
function notifyOffline(detail){window.dispatchEvent(new CustomEvent('eletroagro:offline-status',{detail}));}
async function refreshAfterWrite(){for(let attempt=0;attempt<2;attempt++){try{await prepareOfflineState();return;}catch(error){if(error.code==='OFFLINE_SNAPSHOT_CHANGED'&&attempt===0)continue;notifyOffline({error:error.message});return;}}}
let preparing=null;
export async function prepareOfflineState(){
  if(preparing)return preparing;
  const context=currentContext;if(!context?.companyId)throw new Error('Entre na empresa antes de preparar o modo offline.');if(!navigator.onLine)throw new Error('Conecte à internet para preparar os dados neste aparelho.');
  preparing=(async()=>{notifyOffline({preparing:true});if((await pendingFor(context)).length)throw new Error('Existem lançamentos locais aguardando confirmação. Sincronize ou revise a fila antes de atualizar.');
    const revision=(await snapshotRecord(context))?.revision||0;
    const token=await getAuthAccessToken();assertAccount(token);const response=await send('/api/offline/snapshot',{headers:{'X-Company-Context':context.companyId}},token);const result=await response.json();if(!response.ok)throw new Error(result.error?.message||'Não foi possível preparar os dados offline.');
    if(result.snapshot.attachments?.length){const {storeAttachment}=await import('./deviceFiles.js');for(const orderId of new Set(result.snapshot.attachments.map(a=>a.service_order_id))){notifyOffline({preparing:true,step:'Guardando fotos e anexos no aparelho…'});const filesResponse=await send(`/api/completion/service-orders/${orderId}/attachments`,{headers:{'X-Company-Context':context.companyId}},token);if(!filesResponse.ok)throw new Error('Não foi possível guardar todos os anexos. Os dados anteriores foram preservados.');const files=await filesResponse.json();for(const attachment of files.attachments||[])await storeAttachment(context,{...attachment,service_order_id:orderId});}}
    await Promise.all([import('./SalesPage.jsx'),import('./CustomersPage.jsx'),import('./CatalogPage.jsx'),import('./SuppliersPage.jsx'),import('./QuotesPage.jsx'),import('./OperationsPages.jsx'),import('./ReceiptsPage.jsx'),import('./ReportsPage.jsx'),import('./SettingsPage.jsx'),import('jspdf')]);
    await installSnapshot(context,result.snapshot,revision);const persistent=await navigator.storage?.persist?.().catch(()=>false);notifyOffline({preparing:false,persistent,preparedAt:result.snapshot.preparedAt,error:''});return result.snapshot;
  })();try{return await preparing;}finally{preparing=null;notifyOffline({preparing:false});}
}
export async function offlineStatus(){const record=await snapshotRecord(currentContext),estimate=await navigator.storage?.estimate?.().catch(()=>null);return{prepared:!!record,preparedAt:record?.preparedAt,dirty:record?.dirty||false,estimate,...await queue.summary(),persistent:await navigator.storage?.persisted?.().catch(()=>false)};}
export async function correctOfflineOperation(id,payload){
  if(!navigator.onLine)throw new Error('Conecte à internet para conferir e corrigir uma operação recusada.');
  const context=currentContext,record=await snapshotRecord(context),token=await getAuthAccessToken();assertAccount(token);
  const response=await send('/api/offline/snapshot',{headers:{'x-company-context':context.companyId}},token);const body=await response.json();if(!response.ok)throw new Error(body.error?.message||'Não foi possível conferir o estado do servidor.');
  await reviseOfflineCommand(context,id,payload,body.snapshot,record?.revision||0);await announceQueue();window.dispatchEvent(new Event('eletroagro:offline-synced'));
}
