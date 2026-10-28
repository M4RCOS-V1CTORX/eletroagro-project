import {canAction} from '../../../../shared/access-policy.js';

export function requestRequirement(req){
  const path=(req.originalUrl||req.url||'').split('?')[0],method=req.method,read=['GET','HEAD','OPTIONS'].includes(method);
  const action=read?'view':method==='DELETE'?'delete':method==='PATCH'||method==='PUT'?'edit':'create';
  if(path==='/api/company/authorize')return [req.query.module,req.query.action||'export'];
  if(path==='/api/company/me')return ['company',action];
  if(path.startsWith('/api/company/admin'))return ['users',read?'view':path.includes('profiles')||path.includes('permissions')?'administer':path.includes('recovery')?'reset':action];
  if(path.startsWith('/api/company/access'))return ['users',read?'view':path.includes('permissions')?'administer':'edit'];
  if(path.startsWith('/api/company/invitations'))return ['users',method==='DELETE'?'edit':'create'];
  for(const module of ['customers','catalog','suppliers','quotes','sales'])if(path.startsWith(`/api/${module}`)){
    if(path.includes('/cancel'))return[module,'cancel'];
    if(path.includes('/payments'))return[module,'receive'];
    if(path.includes('/status')&&module==='quotes')return[module,req.body?.status==='approved'?'approve':req.body?.status==='cancelled'?'cancel':'edit'];
    return[module,action];
  }
  if(path.includes('/reports'))return ['reports',req.query?.export==='1'?'export':'view'];
  if(path.includes('/audit'))return ['audit','view'];
  if(path.includes('/dashboard'))return ['dashboard','view'];
  if(path.includes('/appointments'))return ['agenda',!read&&req.body?.status==='cancelled'?'cancel':action];
  if(path.includes('/service-orders')||path.includes('/service-order-sources'))return ['orders',path.includes('/status')&&req.body?.status==='cancelled'?'cancel':action];
  if(path.includes('/purchases'))return ['purchases',action];
  if(path.includes('/stock'))return ['stock',action];
  if(path.includes('/finance/expenses'))return ['expenses',path.endsWith('/cancel')?'cancel':action];
  if(path.includes('/finance/accounts'))return ['accounts',path.endsWith('/cancel')?'cancel':path.includes('/payments')?'settle':action];
  if(path.includes('/finance'))return ['finance',path.includes('/payments')?'settle':action];
  if(path.includes('/receipts'))return ['receipts',action];
  if(path.includes('/completion/payments'))return ['receipts','view'];
  if(path.includes('/document-settings'))return ['company',read?'view':'edit'];
  if(path.includes('/notifications'))return ['agenda','view'];
  if(path==='/api/offline/snapshot'||path.includes('/lookups'))return ['lookup','view'];
  return null;
}
export async function authorizeRequest(pool,req,res,next){
  const requirement=requestRequirement(req);
  if(!requirement||req.company.role==='owner'||req.company.permissions?.version!==2)return next();
  let[module,action]=requirement,allowed=false;
  if(module==='lookup')allowed=['customers','catalog','suppliers','sales','expenses','purchases','stock','payables','receivables','finance','agenda','orders'].some(m=>canAction(req.company,m,'view'));
  else if(module==='accounts'){
    let type=req.query?.type||'all';
    if(req.params?.id||/\/accounts\/[\da-f-]{36}/.test(req.originalUrl)){
      const id=(req.originalUrl.match(/\/accounts\/([\da-f-]{36})/)||[])[1];
      const record=await pool.query('SELECT entry_type FROM public.financial_entries WHERE company_id=$1 AND id=$2',[req.company.company_id,id]);type=record.rows[0]?.entry_type||'all';
    }
    const modules=type==='income'?['receivables']:type==='expense'?['payables']:['payables','receivables'];
    const needed=action==='settle'?(type==='income'?'receive':'pay'):action;
    const available=modules.filter(m=>canAction(req.company,m,needed)||canAction(req.company,'finance',needed)||type==='expense'&&canAction(req.company,'expenses',needed));allowed=available.length>0;
    if(action==='view'&&type==='all'&&available.length===1)req.allowedAccountType=available[0]==='payables'?'expense':'income';
  }else if(module==='finance'){
    let type=req.body?.entryType;
    if(action==='settle'){
      const id=(req.originalUrl.match(/\/finance\/([\da-f-]{36})\/payments/)||[])[1];
      const row=await pool.query('SELECT entry_type FROM public.financial_entries WHERE company_id=$1 AND id=$2',[req.company.company_id,id]);type=row.rows[0]?.entry_type;
    }
    const mapped=type==='income'?'receivables':'payables',specific=type==='income'?'receive':'pay';
    allowed=canAction(req.company,'finance',action==='settle'?specific:action)||canAction(req.company,mapped,action==='settle'?specific:action)||type==='expense'&&canAction(req.company,'expenses',action==='settle'?'pay':action);
  }else allowed=canAction(req.company,module,action);
  if(module==='finance'&&action==='view')allowed=canAction(req.company,'finance','view');
  if(allowed&&module==='sales'&&action==='create'&&Number(req.body?.amountPaid)>0)allowed=canAction(req.company,'sales','receive');
  if(allowed&&module==='purchases'&&action==='create'&&Number(req.body?.amountPaid)>0)allowed=canAction(req.company,'payables','pay')||canAction(req.company,'finance','pay');
  if(allowed&&module==='finance'&&action==='create'&&req.body?.status==='settled')allowed=canAction(req.company,req.body.entryType==='income'?'receivables':'payables',req.body.entryType==='income'?'receive':'pay')||canAction(req.company,'finance',req.body.entryType==='income'?'receive':'pay')||req.body.entryType==='expense'&&canAction(req.company,'expenses','pay');
  if(allowed){
    if(['stock','catalog'].includes(module)&&action==='view'&&!canAction(req.company,module,'costs')){const json=res.json.bind(res);res.json=body=>{const redact=value=>{if(Array.isArray(value))return value.map(redact);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!['cost_price','unit_cost','costPrice','inventory_value'].includes(key)).map(([key,v])=>[key,redact(v)]));return value;};return json(redact(body));};}
    return next();
  }
  await pool.query("INSERT INTO public.audit_logs(company_id,actor_subject,action,entity_type,entity_id,summary)VALUES($1,$2,'access_denied','access',NULL,$3::jsonb)",[req.company.company_id,req.auth.subject,JSON.stringify({module,action,result:'denied'})]).catch(()=>{});
  return res.status(403).json({error:{code:'ACTION_FORBIDDEN',message:'Seu perfil não permite executar esta ação.'}});
}
