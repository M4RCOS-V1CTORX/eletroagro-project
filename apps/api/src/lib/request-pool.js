import {AsyncLocalStorage} from 'node:async_hooks';
const contexts=new WeakMap();

// Keyed writes and their replay response share one database transaction. Existing
// route transactions become savepoints, so the business rules stay in their routers.
export function createRequestPool(raw){
  if(!raw)return null;
  const storage=new AsyncLocalStorage();
  const pool=new Proxy(raw,{get(target,key){
    if(key==='query')return async(...args)=>{const scope=storage.getStore();if(!scope)return target.query(...args);if(scope.finished)throw new Error('A requisição já foi encerrada.');return scope.client.query(...args);};
    if(key==='connect')return async()=>{const scope=storage.getStore();if(!scope)return target.connect();const stack=[];return{
      async query(sql,params){const command=typeof sql==='string'?sql.trim().toUpperCase():'';
        if(scope.finished){if(command==='ROLLBACK')return{rows:[],rowCount:0};throw new Error('A requisição já foi encerrada.');}
        if(command==='BEGIN'){const name=`request_savepoint_${++scope.sequence}`;stack.push(name);return scope.client.query(`SAVEPOINT ${name}`);}
        if(command==='COMMIT'){const name=stack.pop();if(!name)throw new Error('Transação sem início.');return scope.client.query(`RELEASE SAVEPOINT ${name}`);}
        if(command==='ROLLBACK'){const name=stack.pop();if(name){await scope.client.query(`ROLLBACK TO SAVEPOINT ${name}`);return scope.client.query(`RELEASE SAVEPOINT ${name}`);}return{rows:[],rowCount:0};}
        return scope.client.query(sql,params);
      },release(){},
    };};
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
  contexts.set(pool,{raw,storage});return pool;
}

export async function atomicIdempotency(pool,request,response,next){
  const key=request.get('x-idempotency-key');if(!key||['GET','HEAD','OPTIONS'].includes(request.method))return next();
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key))return response.status(400).json({error:{code:'INVALID_IDEMPOTENCY_KEY',message:'Identificador de sincronização inválido.'}});
  const infrastructure=contexts.get(pool);if(!infrastructure)throw new Error('O pool de requisições precisa estar configurado.');
  const {raw,storage}=infrastructure,client=await raw.connect();let ended=false;
  const scope={client,sequence:0,finished:false};
  async function release(rollback){if(ended)return;ended=true;scope.finished=true;try{if(rollback)await client.query('ROLLBACK');}finally{client.release();}}
  try{
    await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='15s'");
    const inserted=await client.query(`INSERT INTO public.idempotency_keys(company_id,idempotency_key,request_path) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING idempotency_key`,[request.company.company_id,key,request.originalUrl]);
    if(!inserted.rowCount){
      const existing=(await client.query('SELECT request_path,response_status,response_body,created_at FROM public.idempotency_keys WHERE company_id=$1 AND idempotency_key=$2',[request.company.company_id,key])).rows[0];
      await release(true);
      if(existing?.request_path!==request.originalUrl)return response.status(409).json({error:{code:'IDEMPOTENCY_PATH_CONFLICT',message:'Este identificador já foi usado em outra operação.'}});
      if(existing?.response_status)return existing.response_status===204?response.sendStatus(204):response.status(existing.response_status).json(existing.response_body);
      if(existing?.created_at&&Date.now()-new Date(existing.created_at).getTime()>600000)return response.status(409).json({error:{code:'SYNC_REVIEW_REQUIRED',message:'Há uma operação antiga sem confirmação recuperável. Ela precisa de conferência para evitar duplicação; o lançamento local foi preservado.'}});
      return response.status(409).json({error:{code:'SYNC_IN_PROGRESS',message:'Esta operação já está sendo sincronizada. Aguarde e tente novamente.'}});
    }
    const originalEnd=response.end.bind(response);
    response.end=function(chunk,encoding,callback){
      if(scope.finished)return response;
      scope.finished=true;
      (async()=>{
        if(response.statusCode>=400){await release(true);return originalEnd(chunk,encoding,callback);}
        const body=chunk?JSON.parse(Buffer.isBuffer(chunk)?chunk.toString('utf8'):String(chunk)):null;
        await client.query('UPDATE public.idempotency_keys SET response_status=$3,response_body=$4::jsonb WHERE company_id=$1 AND idempotency_key=$2',[request.company.company_id,key,response.statusCode,JSON.stringify(body)]);
        await client.query('COMMIT');await release(false);originalEnd(chunk,encoding,callback);
      })().catch(async error=>{await release(true).catch(()=>{});console.error('Falha ao confirmar sincronização:',error.message);if(!response.headersSent){response.statusCode=503;response.removeHeader('Content-Length');originalEnd(JSON.stringify({error:{code:'SYNC_COMMIT_FAILED',message:'Não foi possível confirmar a operação. Tente novamente com o mesmo identificador.'}}));}else response.destroy();});
      return response;
    };
    response.once('close',()=>{if(!scope.finished)release(true).catch(()=>{});});
    return storage.run(scope,()=>next());
  }catch(error){await release(true).catch(()=>{});console.error('Falha ao iniciar sincronização:',error.message);return response.status(error.code==='55P03'?409:503).json({error:{code:'SYNC_UNAVAILABLE',message:'Não foi possível confirmar a sincronização. Aguarde e tente novamente.'}});}
}
