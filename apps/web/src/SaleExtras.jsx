import { useEffect, useState } from 'react';
import { apiRequest } from './apiClient.js';
import { activityLabels, activityOptions, dueFromTerm, saleNumber } from './commercial.js';
const currency=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value||0));
const date=value=>value?new Intl.DateTimeFormat('pt-BR').format(new Date(`${String(value).slice(0,10)}T12:00:00`)):'—';

export function ActivitySelect({value,onChange,all=false,context='all'}) {
  const options=all?activityOptions.all:activityOptions[context]||activityOptions.all;
  const historical=value&&value!=='all'&&!options.includes(value);
  return <label>Atividade<select aria-label="Atividade" value={value} onChange={e=>onChange(e.target.value)}>{all&&<option value="all">Todas as atividades</option>}{historical&&<option value={value}>{activityLabels[value]||value} (histórico)</option>}{options.map(id=><option key={id} value={id}>{activityLabels[id]}</option>)}</select></label>;
}

export function SaleExtraFields({draft,setDraft,profiles,setProfiles,busy}) {
  const [saving,setSaving]=useState(false);const [message,setMessage]=useState('');const [selected,setSelected]=useState('');
  function field(key,label,max) {return <label key={key}>{label}<input maxLength={max} value={draft[key]||''} onChange={e=>{setSelected('');setDraft({...draft,[key]:e.target.value});}}/></label>;}
  async function saveProfile(){setSaving(true);setMessage('');try{const r=await apiRequest('/api/sales/transport-profiles',{method:'POST',body:JSON.stringify({vehicle:draft.vehicle,plate:draft.plate,driver:draft.driver})});setProfiles(current=>[...current.filter(p=>p.id!==r.profile.id),r.profile]);setSelected(r.profile.id);setMessage('Transporte salvo para as próximas vendas.');}catch(e){setMessage(e.message);}finally{setSaving(false);}}
  async function removeProfile(){if(!selected||!window.confirm('Remover este transporte da lista? As vendas anteriores serão preservadas.'))return;setSaving(true);try{await apiRequest(`/api/sales/transport-profiles/${selected}`,{method:'DELETE'});setProfiles(current=>current.filter(p=>p.id!==selected));setSelected('');setMessage('Transporte removido da lista.');}catch(e){setMessage(e.message);}finally{setSaving(false);}}
  return <fieldset className="sale-extra-fields field-wide" disabled={busy||saving}><legend>Atividade e transporte</legend>
    <ActivitySelect context="sale" value={draft.businessActivity} onChange={value=>setDraft({...draft,businessActivity:value})}/>
    <label>Transporte salvo<select value={selected} onChange={e=>{setSelected(e.target.value);const p=profiles.find(p=>p.id===e.target.value);setDraft({...draft,vehicle:p?.vehicle||'',plate:p?.plate||'',driver:p?.driver||''});}}><option value="">Informar transporte avulso</option>{profiles.map(p=><option key={p.id} value={p.id}>{p.vehicle} · {p.plate||'Sem placa'} · {p.driver||'Sem motorista'}</option>)}</select></label>
    {field('vehicle','Veículo',120)}{field('plate','Placa',12)}{field('driver','Motorista',120)}{field('destination','Destino',200)}
    <div className="sale-inline-actions field-wide"><button type="button" className="customers-secondary" disabled={saving||!draft.vehicle?.trim()} onClick={saveProfile}>{saving?'Salvando…':'Salvar transporte para reutilizar'}</button>{selected&&<button type="button" className="customers-secondary" onClick={removeProfile}>Remover transporte salvo</button>}</div>
    {message&&<p className="field-wide" role="status">{message}</p>}
    <label>Frete cobrado do cliente (R$)<input type="number" min="0" step="0.01" value={draft.freightAmount} onChange={e=>setDraft({...draft,freightAmount:e.target.value})}/></label>
    <label>Custo do transporte (R$)<input type="number" min="0" step="0.01" value={draft.freightCost} onChange={e=>setDraft({...draft,freightCost:e.target.value})}/><small>Gera uma conta a pagar no Financeiro. Não aparece na nota do cliente.</small></label>
    <label>Prazo de pagamento (dias)<input type="number" min="0" max="3650" step="1" value={draft.paymentTermDays} onChange={e=>setDraft({...draft,paymentTermDays:e.target.value,dueDate:dueFromTerm(draft.saleDate,e.target.value)})}/><small>O vencimento pode ser ajustado manualmente.</small></label>
  </fieldset>;
}

export function CustomerStatement({customerId,onClose,onOpenSale}) {
  const [data,setData]=useState(null);const [error,setError]=useState('');const [loading,setLoading]=useState(true);const [offset,setOffset]=useState(0);
  useEffect(()=>{let active=true;setLoading(true);setError('');apiRequest(`/api/sales/customer-statement/${customerId}?offset=${offset}`).then(r=>{if(active)setData(r);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[customerId,offset]);
  return <div className="modal-backdrop statement-backdrop"><section className="customer-modal sales-modal" role="dialog" aria-modal="true" aria-labelledby="statement-title"><header className="customer-modal-heading"><div><span className="customers-kicker">EXTRATO DO CLIENTE</span><h2 id="statement-title">{data?.customer.name||'Carregando cliente…'}</h2></div><button className="modal-close" aria-label="Fechar" onClick={onClose}>×</button></header>
    {error&&<p className="customers-feedback error" role="alert">{error}</p>}
    {loading&&<p role="status">Carregando extrato…</p>}
    {data&&<><dl className="sale-statement-summary"><div><dt>Total vendido</dt><dd>{currency(data.summary.total)}</dd></div><div><dt>Recebido</dt><dd>{currency(data.summary.paid)}</dd></div><div><dt>Em aberto</dt><dd>{currency(data.summary.balance)}</dd></div><div><dt>Vencido</dt><dd>{currency(data.summary.overdue)}</dd></div></dl><p className="sales-field-help">Resumo de todas as vendas concluídas, incluindo recebimentos parciais. Notas canceladas não entram nos totais.</p>
    <div className="customers-table-wrap"><table className="customers-table statement-table"><thead><tr><th>Nota</th><th>Vencimento</th><th>Total</th><th>Saldo</th><th>Situação</th></tr></thead><tbody>{data.sales.map(s=><tr key={s.id}><td data-label="Nota">{onOpenSale?<button className="customers-secondary" onClick={()=>onOpenSale(s)}>{saleNumber(s)}</button>:saleNumber(s)}</td><td data-label="Vencimento">{date(s.due_date)}</td><td data-label="Total">{currency(s.total)}</td><td data-label="Saldo">{s.status==='cancelled'?'—':currency(Number(s.total)-Number(s.amount_paid))}</td><td data-label="Situação">{s.status==='cancelled'?'Cancelada':Number(s.total)===Number(s.amount_paid)?'Recebida':'Em aberto'}</td></tr>)}{!data.sales.length&&<tr><td colSpan="5">Nenhuma venda registrada para este cliente.</td></tr>}</tbody></table></div><div className="customers-pagination"><button disabled={!offset||loading} onClick={()=>setOffset(Math.max(0,offset-50))}>Anterior</button><span>{data.pagination.total} nota(s)</span><button disabled={offset+50>=data.pagination.total||loading} onClick={()=>setOffset(offset+50)}>Próxima</button></div></>}
    <footer className="customer-form-actions"><button className="customers-secondary" onClick={onClose}>Fechar</button></footer></section></div>;
}
