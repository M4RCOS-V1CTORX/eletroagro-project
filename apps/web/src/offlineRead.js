import {localToday,saleNumber} from './commercial.js';
import {decimal,units} from './offlineModel.js';
const sum=(rows,key)=>decimal(rows.reduce((n,row)=>n+units(row[key]||'0'),0n));
const text=value=>String(value||'').toLocaleLowerCase('pt-BR');
const date=value=>String(value||'').slice(0,10);
const range=(value,q)=> (!q.get('from')||date(value)>=q.get('from'))&&(!q.get('to')||date(value)<=q.get('to'));
const activity=(row,q)=>!q.get('activity')||q.get('activity')==='all'||row.business_activity===q.get('activity');
const balance=row=>decimal(units(row.total||row.amount||'0')-units(row.amount_paid||'0'));
function page(rows,q,key){const limit=Math.min(100,Math.max(1,Number(q.get('limit')||25))),offset=Math.max(0,Number(q.get('offset')||0));return{[key]:rows.slice(offset,offset+limit),pagination:{limit,offset,total:rows.length}};}
const state=(row,status)=>status==='all'?true:status==='archived'?!!row.archived_at:!row.archived_at&&(status==='inactive'?row.is_active===false:row.is_active!==false);
export function readOffline(data,path){
  const url=new URL(path,'https://offline.local'),p=url.pathname,q=url.searchParams,today=localToday(),search=text(q.get('q'));
  const can=area=>{if(data.access?.[area]===false)throw new Error('Seu acesso não permite consultar esta área offline.');};
  const customer=id=>data.customers.find(c=>c.id===id)||data.lookups?.customers.find(c=>c.id===id),supplier=id=>data.suppliers.find(s=>s.id===id)||data.lookups?.suppliers.find(s=>s.id===id);
  const entryRows=data.entries.map(e=>({...e,balance:balance(e),customer_name:customer(e.customer_id)?.name,supplier_name:supplier(e.supplier_id)?.name,overdue:e.status==='pending'&&e.due_date&&date(e.due_date)<today}));
  const saleRows=data.sales.map(s=>({...s,amount_due:balance(s),overdue:s.status==='completed'&&s.payment_status!=='paid'&&s.due_date&&date(s.due_date)<today}));
  let match;
  if(p==='/api/operations/lookups'){if(data.access.operations===false&&data.access.finance===false)throw new Error('Seu perfil não permite acessar estas opções.');const merge=(first,second)=>[...new Map([...first,...second].map(row=>[row.id,row])).values()].filter(row=>!row.archived_at&&row.is_active!==false);return{access:data.access,customers:merge(data.lookups?.customers||[],data.customers).map(({id,name})=>({id,name})),catalog:merge(data.lookups?.catalog||[],data.catalog.filter(r=>r.item_type==='product')).map(({id,name,unit,item_type,is_active,minimum_stock})=>({id,name,unit,item_type,is_active,minimum_stock})),suppliers:merge(data.lookups?.suppliers||[],data.suppliers).map(({id,name})=>({id,name}))};}
  if(p==='/api/operations/service-order-sources'){can('operations');return{quotes:data.quotes.filter(q=>q.status==='approved'&&!q.archived_at&&!data.orders.some(o=>o.quote_id===q.id)),sales:saleRows.filter(s=>s.status==='completed'&&!data.orders.some(o=>o.sale_id===s.id))};}
  if(p==='/api/company/me')return{company:data.company};
  if(p==='/api/completion/document-settings')return{settings:data.company.document_settings};
  if(p==='/api/completion/notifications')return{preferences:{browser_notifications:false,reminder_minutes:60},reminders:[]};
  if((match=/^\/api\/(customers|suppliers|catalog)(?:\/([\da-f-]+))?$/.exec(p))){
    can('commercial');const group=match[1],label=group==='customers'?'customer':group==='suppliers'?'supplier':'item',source=data[group];
    if(match[2]){const row=source.find(row=>row.id===match[2]);if(!row)throw new Error('Cadastro não encontrado neste aparelho.');return{[label]:row};}
    let rows=source.filter(row=>state(row,q.get('status'))&&(!search||text([row.name,row.code,row.tax_identifier,row.phone,row.category].join(' ')).includes(search)));
    if(group==='catalog')rows=rows.filter(row=>(!q.get('type')||row.item_type===q.get('type'))&&(q.get('status')!=='active'||row.is_active));
    rows.sort((a,b)=>String(a.name).localeCompare(String(b.name),'pt-BR'));if(q.get('order')==='desc')rows.reverse();
    return group==='catalog'?{items:rows.slice(0,100),total:rows.length}:page(rows,q,group);
  }
  if(p==='/api/sales/transport-profiles'){can('commercial');return{profiles:data.transportProfiles};}
  if(p==='/api/sales/approved-quotes'){can('commercial');return{quotes:data.quotes.filter(r=>r.status==='approved'&&!r.archived_at&&!data.sales.some(s=>s.quote_id===r.id))};}
  if(p==='/api/sales'||p==='/api/sales/summary'){
    can('commercial');let rows=saleRows.filter(s=>range(s.sale_date,q)&&activity(s,q));
    if(p.endsWith('/summary')){rows=rows.filter(r=>r.status==='completed');const open=rows.filter(r=>r.payment_status!=='paid'),overdue=open.filter(r=>r.overdue);return{summary:{sales_count:rows.length,sales_total:sum(rows,'total'),received_total:sum(rows,'amount_paid'),outstanding_total:sum(rows.map(r=>({value:balance(r)})),'value'),open_count:open.length,overdue_total:sum(overdue.map(r=>({value:balance(r)})),'value'),overdue_count:overdue.length}};}
    rows=rows.filter(r=>(!q.get('status')||q.get('status')==='all'||r.status===q.get('status'))&&(!q.get('paymentStatus')||q.get('paymentStatus')==='all'||q.get('paymentStatus')==='overdue'?(!q.get('paymentStatus')||q.get('paymentStatus')!=='overdue'||r.overdue):r.payment_status===q.get('paymentStatus'))&&(!search||text(`${r.customer_name} ${saleNumber(r)}`).includes(search)));
    rows.sort((a,b)=>String(b.sale_date).localeCompare(String(a.sale_date))||String(b.created_at).localeCompare(String(a.created_at)));return page(rows,q,'sales');
  }
  if((match=/^\/api\/sales\/customer-statement\/([\da-f-]+)$/.exec(p))){
    can('commercial');const c=customer(match[1]);if(!c)throw new Error('Cliente não encontrado neste aparelho.');const rows=saleRows.filter(r=>r.customer_id===c.id).sort((a,b)=>String(b.sale_date).localeCompare(String(a.sale_date))),completed=rows.filter(r=>r.status==='completed');q.set('limit','50');return{customer:c,summary:{count:completed.length,total:sum(completed,'total'),paid:sum(completed,'amount_paid'),balance:sum(completed.map(r=>({value:balance(r)})),'value'),overdue:sum(completed.filter(r=>r.overdue).map(r=>({value:balance(r)})),'value')},...page(rows,q,'sales')};
  }
  if((match=/^\/api\/sales\/([\da-f-]+)$/.exec(p))){can('commercial');const sale=saleRows.find(r=>r.id===match[1]);if(!sale)throw new Error('Venda não encontrada neste aparelho.');return{sale};}
  if(p==='/api/operations/finance'){
    can('finance');const filtered=entryRows.filter(r=>activity(r,q)&&range(r.due_date||r.competence_date,q));const payments=data.financialPayments.filter(pay=>range(pay.paid_at,q)&&filtered.some(e=>e.id===pay.entry_id));
    const values=type=>payments.filter(pay=>data.entries.find(e=>e.id===pay.entry_id)?.entry_type===type);
    return{entries:filtered.filter(r=>(!q.get('type')||q.get('type')==='all'||r.entry_type===q.get('type'))&&(!q.get('status')||q.get('status')==='all'||r.status===q.get('status'))&&(!search||text(`${r.title} ${r.customer_name||''} ${r.supplier_name||''}`).includes(search))),summary:{income:sum(values('income'),'amount'),expense:sum(values('expense'),'amount'),receivable:sum(filtered.filter(e=>e.entry_type==='income'&&e.status==='pending').map(e=>({value:e.balance})),'value'),payable:sum(filtered.filter(e=>e.entry_type==='expense'&&e.status==='pending').map(e=>({value:e.balance})),'value'),overdue_count:filtered.filter(e=>e.overdue).length}};
  }
  if(p==='/api/operations/stock'){can('operations');return{items:data.stock.filter(r=>!search||text(`${r.name} ${r.code}`).includes(search)),movements:data.movements.slice(0,30)};}
  if(p==='/api/operations/purchases'){can('finance');return{purchases:data.purchases.filter(r=>activity(r,q)).map(r=>({...r,supplier_name:supplier(r.supplier_id)?.name})).sort((a,b)=>String(b.purchase_date).localeCompare(String(a.purchase_date))).slice(0,50)};}
  if(p==='/api/operations/appointments'){can('operations');return{appointments:data.appointments.filter(r=>{const d=new Date(r.starts_at);const local=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;return range(local,q);}).map(a=>({...a,customer_name:customer(a.customer_id)?.name})).sort((a,b)=>String(a.starts_at).localeCompare(String(b.starts_at)))};}
  if(p==='/api/operations/service-orders'){can('operations');return{orders:data.orders.filter(r=>(!q.get('status')||q.get('status')==='all'||r.status===q.get('status'))&&(!search||text(`${r.title} ${r.customer_name}`).includes(search)))};}
  if((match=/^\/api\/operations\/service-orders\/([\da-f-]+)$/.exec(p))){can('operations');const order=data.orders.find(o=>o.id===match[1]);if(!order)throw new Error('Ordem não preparada neste aparelho.');return{order:{...order,activity:[]}};}
  if((match=/^\/api\/completion\/service-orders\/([\da-f-]+)\/attachments$/.exec(p))){can('operations');return{attachments:data.attachments.filter(a=>a.service_order_id===match[1])};}
  if(p==='/api/completion/payments'){can('finance');return{payments:data.financialPayments.map(pay=>{const entry=data.entries.find(e=>e.id===pay.entry_id)||{},receipt=data.receipts.find(r=>r.payment_id===pay.id);return{...pay,entry_type:entry.entry_type,title:entry.title,related_name:customer(entry.customer_id)?.name||supplier(entry.supplier_id)?.name,receipt_id:receipt?.id,receipt_number:receipt?.receipt_number,receipt_is_provisional:receipt?.is_provisional};}).sort((a,b)=>String(b.paid_at).localeCompare(String(a.paid_at)))};}
  if((match=/^\/api\/completion\/receipts\/([\da-f-]+)$/.exec(p))){can('finance');const receipt=data.receipts.find(r=>r.id===match[1]);if(!receipt)throw new Error('Recibo não encontrado neste aparelho.');return{receipt:{...receipt,company_name:data.company.name,tax_identifier:data.company.tax_identifier,phone:data.company.phone,email:data.company.email,document_settings:data.company.document_settings}};}
  if(p==='/api/operations/dashboard'){
    const completed=saleRows.filter(r=>r.status==='completed'&&range(r.sale_date,q)),finance=canDashboardFinance(data,q),quotes=data.quotes.filter(r=>!r.archived_at&&range(r.issued_at,q));return{access:data.access,sales:data.access.commercial?{count:completed.length,total:sum(completed,'total')}:null,quotes:data.access.commercial?{open:quotes.filter(r=>['draft','sent'].includes(r.status)).length,approved:quotes.filter(r=>r.status==='approved').length,expired:data.quotes.filter(r=>r.status==='sent'&&r.valid_until&&date(r.valid_until)<today).length}:null,finance,orders:data.access.operations?{active:data.orders.filter(o=>!['completed','cancelled'].includes(o.status)).length,overdue:data.orders.filter(o=>!['completed','cancelled'].includes(o.status)&&o.due_date&&date(o.due_date)<today).length}:null,stock:data.access.operations?{low_count:data.stock.filter(s=>Number(s.minimum_stock)>0&&Number(s.stock)<=Number(s.minimum_stock)).length}:null,upcoming:data.access.operations?data.appointments.filter(a=>a.status==='scheduled'&&new Date(a.starts_at)>new Date()).slice(0,5):[],activity:data.access.audit?data.activity:[]};
  }
  if(p==='/api/operations/audit'){can('audit');return{activity:data.activity};}
  if(p==='/api/quotes/summary'){can('commercial');const active=data.quotes.filter(r=>!r.archived_at),sent=active.filter(r=>r.status==='sent'),approved=active.filter(r=>r.status==='approved');return{summary:{draft_count:active.filter(r=>r.status==='draft').length,sent_count:sent.length,sent_total:sum(sent,'total'),approved_count:approved.length,approved_total:sum(approved,'total'),overdue_count:sent.filter(r=>r.valid_until&&date(r.valid_until)<today).length,expiring_count:sent.filter(r=>r.valid_until&&date(r.valid_until)>=today&&new Date(r.valid_until).getTime()<=Date.now()+7*86400000).length}};}
  if(p==='/api/quotes'){can('commercial');return page(data.quotes.filter(r=>!r.archived_at&&(!q.get('status')||q.get('status')==='all'||r.status===q.get('status'))&&(!search||text(`${r.customer_name} ${r.quote_number}`).includes(search))),q,'quotes');}
  if((match=/^\/api\/quotes\/([\da-f-]+)$/.exec(p))){can('commercial');const quote=data.quotes.find(r=>r.id===match[1]);if(!quote)throw new Error('Orçamento não preparado neste aparelho.');return{quote};}
  throw new Error('Esta consulta não foi preparada para uso offline. Reconecte para acessá-la.');
}
function canDashboardFinance(data,q){
  if(data.access?.finance===false)return null;const entries=data.entries,paid=data.financialPayments.filter(p=>range(p.paid_at,q));return{income:sum(paid.filter(p=>entries.find(e=>e.id===p.entry_id)?.entry_type==='income'),'amount'),expense:sum(paid.filter(p=>entries.find(e=>e.id===p.entry_id)?.entry_type==='expense'),'amount'),overdue:entries.filter(e=>e.status==='pending'&&e.due_date&&date(e.due_date)<localToday()).length,receivable:sum(entries.filter(e=>e.entry_type==='income'&&e.status==='pending').map(e=>({value:balance(e)})),'value'),payable:sum(entries.filter(e=>e.entry_type==='expense'&&e.status==='pending').map(e=>({value:balance(e)})),'value')};
}
