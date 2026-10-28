import {useEffect,useState} from 'react';
import {apiRequest} from './apiClient.js';
import {authClient} from './authClient.js';
import {canAction,emptyPolicy,legacyToPolicy,moduleCatalog,actionLabels} from '../../../shared/access-policy.js';

export default function AccessAdministration({company}){
  const[data,setData]=useState(null),[q,setQ]=useState(''),[status,setStatus]=useState('all'),[offset,setOffset]=useState(0),[draft,setDraft]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[search,setSearch]=useState('');
  async function load(){try{setData(await apiRequest(`/api/company/admin/users?${new URLSearchParams({q,status,offset})}`));}catch(e){setError(e.message);}}
  useEffect(()=>{load();},[status,offset]);
  function editUser(user){setDraft({kind:'user',original:user,name:user.display_name||'',active:user.is_active,profileId:user.access_profile_id||'',permissions:user.permissions.version===2?user.permissions:legacyToPolicy(user)});}
  function editProfile(profile){setDraft({kind:'profile',original:profile,name:profile?.name||'',permissions:profile?.permissions||emptyPolicy()});}
  async function recover(){
    if(!window.confirm('Enviar instruções de recuperação para o e-mail deste usuário?'))return;
    setBusy(true);setError('');
    try{const result=await apiRequest(`/api/company/admin/users/${draft.original.id}/recovery`,{method:'POST',body:'{}'});const response=await authClient.requestPasswordReset({email:result.email,redirectTo:`${window.location.origin}/?reset=1`});if(response.error)throw new Error(response.error.message||'Não foi possível solicitar a recuperação.');window.alert('Solicitação enviada. O usuário deve conferir o e-mail.');}catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function save(e){e.preventDefault();if(!window.confirm(draft.kind==='profile'?'Salvar este perfil? Todos os usuários vinculados receberão estas permissões.':'Confirmar alteração do acesso deste usuário?'))return;
    setBusy(true);setError('');try{
      const original=draft.original;
      const body=draft.kind==='profile'?{name:draft.name,permissions:draft.permissions,expectedUpdatedAt:original?.updated_at,confirmation:original?.name}:{displayName:draft.name,isActive:draft.active,expectedUpdatedAt:original.updated_at,confirmation:original.email||original.display_name,...(canAction(company,'users','administer')?(draft.profileId?{profileId:draft.profileId}:{permissions:draft.permissions}):{})};
      await apiRequest(`/api/company/admin/${draft.kind==='profile'?'profiles':'users'}${original?`/${original.id}`:''}`,{method:original?'PATCH':'POST',body:JSON.stringify(body)});setDraft(null);await load();
    }catch(e){setError(e.message);}finally{setBusy(false);}}
  function grant(module,action,value){setDraft(current=>({...current,permissions:{...current.permissions,modules:{...current.permissions.modules,[module]:{...current.permissions.modules[module],[action]:value,...(action==='view'&&!value?Object.fromEntries(moduleCatalog[module].actions.map(a=>[a,false])):{})}}}}));}
  return <section className="settings-card"><header><strong>Usuários e permissões detalhadas</strong></header>
    <form className="reports-filter" onSubmit={e=>{e.preventDefault();setOffset(0);load();}}><label>Pesquisar usuário<input value={q} onChange={e=>setQ(e.target.value)}/></label><label>Situação<select value={status} onChange={e=>{setStatus(e.target.value);setOffset(0);}}><option value="all">Todas</option><option value="active">Ativos</option><option value="inactive">Inativos</option></select></label><button className="customers-secondary">Pesquisar</button></form>
    {error&&<p role="alert">{error}</p>}
    {data?.users.map(user=><article className="team-member-row" key={user.id}><span><b>{user.display_name||user.email||'Usuário'}</b><small>{user.email} · {user.role==='owner'?'Responsável':user.profile_name||'Permissões individuais'} · {user.is_active?'Ativo':'Inativo'}</small></span><button className="customers-secondary" onClick={()=>editUser(user)}>Detalhes e permissões</button></article>)}
    <div className="customer-form-actions"><button disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-25))}>Anterior</button><span>{data?.pagination.total||0} usuários</span><button disabled={!data||offset+25>=data.pagination.total} onClick={()=>setOffset(offset+25)}>Próxima</button></div>
    {canAction(company,'users','administer')&&<><h3>Perfis compartilhados</h3>{data?.profiles.map(profile=><button className="customers-secondary" key={profile.id} onClick={()=>editProfile(profile)}>{profile.name} ({profile.user_count} usuários)</button>)}<button className="customers-primary" onClick={()=>editProfile(null)}>Criar perfil</button></>}
    {draft&&<form className="customer-form" onSubmit={save}><h3>{draft.kind==='profile'?'Configurar perfil':'Detalhes do usuário'}</h3><label>Nome<input required value={draft.name} maxLength={draft.kind==='profile'?80:120} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
      {draft.kind==='user'&&<><label><input type="checkbox" checked={draft.active} onChange={e=>setDraft({...draft,active:e.target.checked})}/>Acesso ativo</label><label>Perfil<select value={draft.profileId} disabled={!canAction(company,'users','administer')} onChange={e=>setDraft({...draft,profileId:e.target.value})}><option value="">Permissões individuais</option>{data.profiles.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><p>Criado em {new Date(draft.original.created_at).toLocaleDateString('pt-BR')}. Último acesso: {draft.original.last_access_at?new Date(draft.original.last_access_at).toLocaleString('pt-BR'):'Ainda não registrado'}.</p></>}
      {draft.kind==='user'&&canAction(company,'users','reset')&&<button type="button" disabled={busy} className="customers-secondary" onClick={recover}>Enviar recuperação de acesso</button>}
      <label>Pesquisar permissão<input value={search} onChange={e=>setSearch(e.target.value)}/></label>
      {Object.entries(moduleCatalog).filter(([,m])=>m.label.toLowerCase().includes(search.toLowerCase())).map(([key,m])=><fieldset key={key} disabled={!!draft.profileId||draft.original?.role==='owner'||!canAction(company,'users','administer')}><legend>{m.label}</legend>{m.actions.map(action=><label className="settings-check" key={action}><input type="checkbox" checked={(draft.profileId?data.profiles.find(p=>p.id===draft.profileId)?.permissions:draft.permissions)?.modules?.[key]?.[action]===true} disabled={action!=='view'&&!draft.permissions.modules[key]?.view} onChange={e=>grant(key,action,e.target.checked)}/>{actionLabels[action]}</label>)}</fieldset>)}
      <div className="customer-form-actions"><button type="button" className="customers-secondary" onClick={()=>setDraft(null)}>Fechar</button>{draft.original?.role!=='owner'&&<button className="customers-primary" disabled={busy}>{busy?'Salvando…':'Confirmar e salvar'}</button>}</div>
    </form>}
  </section>;
}
