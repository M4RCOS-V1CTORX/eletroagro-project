import {Router} from 'express';
const uuid=/^[a-f0-9-]{36}$/i;
export function createAgendaRouter({pool}){
 const router=Router();
 router.get('/options',async(req,res,next)=>{try{const company=req.company.company_id;const members=await pool.query('SELECT id,COALESCE(display_name,email,\'Usuário\') AS name FROM public.company_memberships WHERE company_id=$1 AND is_active ORDER BY name',[company]);const suppliers=await pool.query('SELECT id,name FROM public.suppliers WHERE company_id=$1 AND is_active AND archived_at IS NULL ORDER BY name',[company]);return res.json({members:members.rows,suppliers:suppliers.rows});}catch(e){next(e);}});
 async function change(req,res,next){
  const b=req.body||{},id=req.params.id,remove=req.method==='DELETE';let client;
  try{
   client=await pool.connect();await client.query('BEGIN');await client.query('SELECT id FROM public.companies WHERE id=$1 FOR UPDATE',[req.company.company_id]);
   const old=id?(await client.query('SELECT * FROM public.appointments WHERE company_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE',[req.company.company_id,id])).rows[0]:null;
   const reject=async(status,message)=>{await client.query('ROLLBACK');return res.status(status).json({error:{message}});};
   if(id&&!old)return await reject(404,'Compromisso não encontrado.');
   if(remove){await client.query("UPDATE public.appointments SET deleted_at=now(),status='cancelled',updated_at=now() WHERE company_id=$1 AND id=$2",[req.company.company_id,id]);}
   else{
    const title=String(b.title??old?.title??'').trim(),start=b.startsAt??old?.starts_at,end=b.endsAt??old?.ends_at,status=b.status??old?.status??'scheduled',priority=b.priority??old?.priority??'normal',category=String(b.category??old?.category??'').trim();
    if(title.length<2||title.length>180||!Number.isFinite(Date.parse(start))||end&&(!Number.isFinite(Date.parse(end))||Date.parse(end)<=Date.parse(start))||!['scheduled','completed','cancelled'].includes(status)||!['low','normal','high','urgent'].includes(priority)||category&&(category.length<2||category.length>80))return await reject(400,'Confira título, horários, categoria e prioridade.');
    const refs={customerId:['customers','customer_id'],supplierId:['suppliers','supplier_id'],responsibleMemberId:['company_memberships','responsible_member_id'],serviceOrderId:['service_orders','service_order_id']},values={};
    for(const[key,[table,column]]of Object.entries(refs)){const value=Object.hasOwn(b,key)?b[key]||null:old?.[column]||null;values[key]=value;if(value&&(!uuid.test(value)||!(await client.query(`SELECT id FROM public.${table} WHERE company_id=$1 AND id=$2`,[req.company.company_id,value])).rows.length))return await reject(400,'Um vínculo não pertence à empresa.');}
    if(values.responsibleMemberId&&status==='scheduled'){
     const collision=await client.query("SELECT id FROM public.appointments WHERE company_id=$1 AND responsible_member_id=$2 AND deleted_at IS NULL AND status='scheduled' AND ($3::uuid IS NULL OR id<>$3) AND starts_at<COALESCE($5::timestamptz,$4::timestamptz+interval '1 minute') AND COALESCE(ends_at,starts_at+interval '1 minute')>$4::timestamptz",[req.company.company_id,values.responsibleMemberId,id||null,start,end||null]);if(collision.rows.length)return await reject(409,'O responsável já possui compromisso neste horário.');
    }
    const params=[req.company.company_id,title,start,end||null,status,priority,category||null,values.customerId,values.supplierId,values.responsibleMemberId,values.serviceOrderId,String(b.address??old?.address??'').slice(0,500),String(b.notes??old?.notes??'').slice(0,3000)];
    const result=id?await client.query('UPDATE public.appointments SET title=$2,starts_at=$3,ends_at=$4,status=$5,priority=$6,category=$7,customer_id=$8,supplier_id=$9,responsible_member_id=$10,service_order_id=$11,address=$12,notes=$13,updated_at=now() WHERE company_id=$1 AND id=$14 RETURNING *',[...params,id]):await client.query('INSERT INTO public.appointments(company_id,title,starts_at,ends_at,status,priority,category,customer_id,supplier_id,responsible_member_id,service_order_id,address,notes,created_by_subject)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)RETURNING *',[...params,req.auth.subject]);
    req.savedAppointment=result.rows[0];
   }
   await client.query('INSERT INTO public.audit_logs(company_id,actor_subject,action,entity_type,entity_id,summary)VALUES($1,$2,$3,\'appointment\',$4,$5::jsonb)',[req.company.company_id,req.auth.subject,remove?'deleted':id?'updated':'created',id||req.savedAppointment.id,JSON.stringify({before:old,after:req.savedAppointment||null})]);
   await client.query('COMMIT');return res.status(id?200:201).json({appointment:req.savedAppointment,deleted:remove});
  }catch(e){await client?.query('ROLLBACK').catch(()=>{});next(e);}finally{client?.release();}
 }
 router.post('/',change);router.patch('/:id',change);router.patch('/:id/status',change);router.delete('/:id',change);return router;
}
