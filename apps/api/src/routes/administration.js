import {Router} from 'express';
import {canAction,moduleCatalog,actionLabels,normalizePolicy} from '../../../../shared/access-policy.js';
const uuid=/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const stamp=value=>new Date(value).getTime();
export function createAdministrationRouter({pool}){
  const router=Router();
  const deny=(res,status,message)=>res.status(status).json({error:{code:'ADMIN_VALIDATION',message}});
  async function audit(db,req,action,type,id,before,after){await db.query('INSERT INTO public.audit_logs(company_id,actor_subject,action,entity_type,entity_id,summary)VALUES($1,$2,$3,$4,$5,$6::jsonb)',[req.company.company_id,req.auth.subject,action,type,id,JSON.stringify({before,after,result:'success'})]);}
  router.get('/users',async(req,res,next)=>{
    if(!canAction(req.company,'users','view'))return deny(res,403,'Seu perfil não permite consultar usuários.');
    const q=String(req.query.q||'').trim().slice(0,100),status=req.query.status||'all',role=req.query.role||'all',limit=25,offset=Math.max(0,parseInt(req.query.offset,10)||0);
    if(!['all','active','inactive'].includes(status)||!['all','owner','member'].includes(role))return deny(res,400,'Filtros de usuários inválidos.');
    try{const result=await pool.query(`SELECT m.id,m.email,m.display_name,m.role,m.is_active,m.created_at,m.updated_at,m.last_access_at,m.updated_by_subject,m.access_profile_id,p.name AS profile_name,COALESCE(p.permissions,m.permissions) AS permissions,COUNT(*) OVER()::int AS total_count
      FROM public.company_memberships m LEFT JOIN public.company_access_profiles p ON p.company_id=m.company_id AND p.id=m.access_profile_id
      WHERE m.company_id=$1 AND ($2='' OR m.display_name ILIKE '%'||$2||'%' OR m.email ILIKE '%'||$2||'%')
      AND ($3='all' OR m.is_active=($3='active')) AND ($4='all' OR m.role=$4) ORDER BY m.role,m.display_name NULLS LAST,m.created_at LIMIT $5 OFFSET $6`,[req.company.company_id,q,status,role,limit,offset]);
      const profiles=await pool.query('SELECT p.*, (SELECT COUNT(*)::int FROM public.company_memberships m WHERE m.company_id=p.company_id AND m.access_profile_id=p.id) AS user_count FROM public.company_access_profiles p WHERE p.company_id=$1 ORDER BY name',[req.company.company_id]);
      return res.json({users:result.rows,profiles:profiles.rows,modules:moduleCatalog,actions:actionLabels,pagination:{limit,offset,total:result.rows[0]?.total_count||0},currentMembershipId:req.company.membership_id});
    }catch(error){next(error);}
  });
  router.post('/profiles',async(req,res,next)=>{
    if(!canAction(req.company,'users','administer'))return deny(res,403,'Seu perfil não permite administrar permissões.');
    const name=typeof req.body.name==='string'?req.body.name.trim():'';
    if(name.length<2||name.length>80)return deny(res,400,'Informe um nome de perfil de 2 a 80 caracteres.');
    const client=await pool.connect();try{await client.query('BEGIN');const policy=normalizePolicy(req.body.permissions);const row=await client.query('INSERT INTO public.company_access_profiles(company_id,name,permissions,created_by_subject,updated_by_subject)VALUES($1,$2,$3::jsonb,$4,$4)RETURNING *',[req.company.company_id,name,JSON.stringify(policy),req.auth.subject]);await audit(client,req,'created','access_profile',row.rows[0].id,null,{name,permissions:policy});await client.query('COMMIT');res.status(201).json({profile:row.rows[0]});}catch(error){await client.query('ROLLBACK');if(error.code==='23505')return deny(res,409,'Já existe um perfil com esse nome.');next(error);}finally{client.release();}
  });
  router.patch('/profiles/:id',async(req,res,next)=>{
    if(!canAction(req.company,'users','administer')||!uuid.test(req.params.id))return deny(res,403,'Perfil indisponível para alteração.');
    if(req.company.role!=='owner'&&req.company.access_profile_id===req.params.id)return deny(res,403,'O próprio perfil deve ser alterado por outro administrador.');
    const client=await pool.connect();try{await client.query('BEGIN');const result=await client.query('SELECT * FROM public.company_access_profiles WHERE company_id=$1 AND id=$2 FOR UPDATE',[req.company.company_id,req.params.id]);const current=result.rows[0];
      if(!current||stamp(current.updated_at)!==stamp(req.body.expectedUpdatedAt)||req.body.confirmation!==current.name){await client.query('ROLLBACK');return deny(res,409,'Atualize o perfil e confirme seu nome antes de salvar.');}
      const name=typeof req.body.name==='string'?req.body.name.trim():current.name;if(name.length<2||name.length>80){await client.query('ROLLBACK');return deny(res,400,'Nome de perfil inválido.');}
      const policy=normalizePolicy(req.body.permissions);const updated=await client.query("UPDATE public.company_access_profiles SET name=$3,permissions=$4::jsonb,updated_by_subject=$5,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE company_id=$1 AND id=$2 RETURNING *",[req.company.company_id,current.id,name,JSON.stringify(policy),req.auth.subject]);
      await audit(client,req,'permissions_changed','access_profile',current.id,{name:current.name,permissions:current.permissions},{name,permissions:policy});await client.query('COMMIT');res.json({profile:updated.rows[0]});
    }catch(error){await client.query('ROLLBACK');if(error.code==='23505')return deny(res,409,'Já existe um perfil com esse nome.');next(error);}finally{client.release();}
  });
  router.patch('/users/:id',async(req,res,next)=>{
    if(!uuid.test(req.params.id))return deny(res,400,'Usuário inválido.');
    if(!canAction(req.company,'users','edit'))return deny(res,403,'Seu perfil não permite editar usuários.');
    const b=req.body||{},permissionChange=Object.hasOwn(b,'permissions')||Object.hasOwn(b,'profileId');
    if(permissionChange&&!canAction(req.company,'users','administer'))return deny(res,403,'Seu perfil não permite conceder ou revogar permissões.');
    const client=await pool.connect();try{await client.query('BEGIN');await client.query('SELECT id FROM public.companies WHERE id=$1 FOR UPDATE',[req.company.company_id]);
      const record=await client.query('SELECT * FROM public.company_memberships WHERE company_id=$1 AND id=$2 FOR UPDATE',[req.company.company_id,req.params.id]);const member=record.rows[0];
      const abort=async(status,message)=>{await client.query('ROLLBACK');return deny(res,status,message);};
      if(!member)return await abort(404,'Usuário não encontrado.');
      if(member.role==='owner')return await abort(409,'O responsável principal mantém acesso administrativo e não pode ser suspenso ou ter seu perfil substituído.');
      if(member.id===req.company.membership_id&&permissionChange)return await abort(403,'Não é permitido alterar os próprios privilégios por esta operação.');
      if(stamp(member.updated_at)!==stamp(b.expectedUpdatedAt)||b.confirmation!==(member.email||member.display_name))return await abort(409,'Atualize o usuário e confirme sua identificação antes de salvar.');
      let profileId=member.access_profile_id,permissions=member.permissions;
      if(Object.hasOwn(b,'profileId')){profileId=b.profileId||null;if(profileId){if(!uuid.test(profileId))return await abort(400,'Perfil inválido.');const profile=await client.query('SELECT permissions FROM public.company_access_profiles WHERE company_id=$1 AND id=$2',[req.company.company_id,profileId]);if(!profile.rows.length)return await abort(404,'Perfil não encontrado nesta empresa.');permissions=profile.rows[0].permissions;}}
      if(Object.hasOwn(b,'permissions')){permissions=normalizePolicy(b.permissions);profileId=null;}
      const name=Object.hasOwn(b,'displayName')?String(b.displayName).trim():member.display_name;if(name&&name.length>120)return await abort(400,'O nome deve ter até 120 caracteres.');
      const active=typeof b.isActive==='boolean'?b.isActive:member.is_active;
      const updated=await client.query("UPDATE public.company_memberships SET display_name=$3,is_active=$4,permissions=$5::jsonb,access_profile_id=$6,updated_by_subject=$7,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE company_id=$1 AND id=$2 RETURNING id,email,display_name,role,is_active,permissions,access_profile_id,updated_at",[req.company.company_id,member.id,name,active,JSON.stringify(permissions),profileId,req.auth.subject]);
      await audit(client,req,permissionChange?'permissions_changed':active!==member.is_active?'access_changed':'updated','company_membership',member.id,{name:member.display_name,active:member.is_active,profileId:member.access_profile_id,permissions:member.permissions},{name,active,profileId,permissions});await client.query('COMMIT');res.json({user:updated.rows[0]});
    }catch(error){await client.query('ROLLBACK');if(error.code==='23514')return deny(res,409,'A empresa atingiu o limite de usuários ativos.');next(error);}finally{client.release();}
  });
  router.post('/users/:id/recovery',async(req,res,next)=>{
    if(!canAction(req.company,'users','reset')||!uuid.test(req.params.id))return deny(res,403,'Recuperação de acesso não autorizada.');
    try{const member=await pool.query('SELECT id,email FROM public.company_memberships WHERE company_id=$1 AND id=$2',[req.company.company_id,req.params.id]);if(!member.rows[0]?.email)return deny(res,404,'Usuário ou e-mail indisponível.');await audit(pool,req,'recovery_requested','company_membership',member.rows[0].id,null,{result:'requested'});res.json({email:member.rows[0].email});}catch(error){next(error);}
  });
  return router;
}
