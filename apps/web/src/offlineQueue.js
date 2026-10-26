// Queue identity contains account/company identifiers only, never a session token.
export function queueScope(context){return context?.issuer&&context?.subject&&context?.companyId?JSON.stringify([context.apiUrl||'',context.issuer,context.subject,context.companyId]):null;}
export function canQueue(path,method){
  if(method==='POST')return /^\/api\/(customers|catalog|suppliers|sales)$/.test(path)||/^\/api\/sales\/(transport-profiles|[\da-f-]+\/payments)$/.test(path)||/^\/api\/completion\/receipts$/.test(path)||/^\/api\/operations\/(purchases|finance(?:\/[\da-f-]+\/payments)?|appointments|stock\/movements)$/.test(path);
  return method==='PATCH'&&(/^\/api\/(customers|catalog|suppliers)\/[\da-f-]+$/.test(path)||/^\/api\/operations\/appointments\/[\da-f-]+\/status$/.test(path));
}
export function createOfflineQueue({read,put,remove,context,send,confirmed,changed=async()=>{}}){
  let running=null;
  async function list(){const scope=queueScope(context());return scope?(await read()).filter(row=>row.scope===scope).sort((a,b)=>a.sequence!=null&&b.sequence!=null?a.sequence-b.sequence:a.createdAt-b.createdAt):[];}
  async function summary(){const rows=await list();return{remaining:rows.length,failed:rows.filter(row=>row.status==='failed').length};}
  async function enqueue(path,options){
    const current=context(),scope=queueScope(current);if(!scope)throw new Error('Não foi possível confirmar sua conta e empresa. Reconecte antes de salvar offline.');
    const headers=Object.fromEntries(new Headers(options.headers||{}).entries());const id=headers['x-idempotency-key']||crypto.randomUUID();delete headers.authorization;
    await put({id,scope,companyId:current.companyId,path,method:options.method,body:options.body||null,headers,createdAt:Date.now(),status:'pending'});await changed();
    return{queued:true,offline:true,queueId:id,message:'Operação salva neste aparelho, aguardando sincronização. Ainda não foi confirmada pelo servidor.'};
  }
  async function flush({retryFailed=false}={}){
    if(running)return running;
    running=(async()=>{const scope=queueScope(context());let sent=0;
      for(const row of await list()){
        if(scope!==queueScope(context()))break;
        if(row.status==='failed'&&!retryFailed)continue;
        try{
          const response=await send(row);
          if(response.ok){if(confirmed)await confirmed(row,response.status===204?{}:await response.json());else await remove(row.id);sent+=1;}
          else if(response.status>=400&&response.status<500&&![401,408,429].includes(response.status)){
            const body=await response.json().catch(()=>({}));if(response.status===409&&['SYNC_IN_PROGRESS','SYNC_UNAVAILABLE'].includes(body.error?.code))break;
            await put({...row,status:'failed',error:body.error?.message||'O servidor recusou esta operação. Revise antes de tentar novamente.'});
          }else break;
        }catch(error){if(error.code==='OFFLINE_DEPENDENCY'){await put({...row,status:'failed',error:error.message});continue;}break;}
      }
      await changed();return{sent,...await summary()};
    })();try{return await running;}finally{running=null;}
  }
  async function discard(id){if(!(await list()).some(row=>row.id===id))throw new Error('Operação não pertence à conta atual.');await remove(id);await changed();}
  return{list,summary,enqueue,flush,discard};
}
