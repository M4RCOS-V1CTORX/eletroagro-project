import {dueFromTerm,localToday} from './commercial.js';
const methods=new Set(['pix','cash','card_debit','card_credit','transfer','boleto','other']);
export function units(value,decimals=2){const text=String(value??'0');if(!new RegExp(`^\\d{1,${decimals===3?9:10}}(?:\\.\\d{1,${decimals}})?$`).test(text))throw new Error('Confira os valores e quantidades. Use números positivos e a precisão indicada.');const[whole,fraction='']=text.split('.');const result=BigInt(whole)*10n**BigInt(decimals)+BigInt((fraction+'0'.repeat(decimals)).slice(0,decimals));if(result>999999999999n)throw new Error('O valor excede o limite permitido.');return result;}
export const decimal=(value,decimals=2)=>{const magnitude=value<0n?-value:value;return`${value<0n?'-':''}${magnitude/10n**BigInt(decimals)}.${String(magnitude%10n**BigInt(decimals)).padStart(decimals,'0')}`;};
const signed=(value,decimals=3)=>String(value).startsWith('-')?-units(String(value).slice(1),decimals):units(value,decimals);
const requireText=(value,label,max=200)=>{if(typeof value!=='string'||value.trim().length<2||value.length>max)throw new Error(`Confira o campo ${label}.`);return value.trim();};
function date(value){const text=String(value||localToday()),parsed=new Date(`${text}T12:00:00Z`);if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==text)throw new Error('Informe uma data válida.');return text;}
const maps={taxIdentifier:'tax_identifier',customerType:'customer_type',postalCode:'postal_code',streetNumber:'street_number',addressComplement:'address_complement',paymentTermDays:'payment_term_days',itemType:'item_type',costPrice:'cost_price',salePrice:'sale_price',minimumStock:'minimum_stock',estimatedMinutes:'estimated_minutes',isActive:'is_active'};
const normalize=body=>Object.fromEntries(Object.entries(body).map(([k,v])=>[maps[k]||k,v]));
function shiftDate(value,index,frequency){const d=new Date(`${value}T12:00:00Z`);if(frequency==='week')d.setUTCDate(d.getUTCDate()+7*index);else{const day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+index);d.setUTCDate(Math.min(day,new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate()));}return d.toISOString().slice(0,10);}

export function applyOfflineCommand(source,command){
  const data=structuredClone(source),body=command.payload||{},path=command.path,method=command.method;
  command.localIds ||= {};const id=name=>command.localIds[name] ||= crypto.randomUUID();
  const bindings={},bind=(name,selector)=>{const value=id(name);bindings[value]=selector;return value;};
  const stamp=new Date(command.createdAt||Date.now()).toISOString(),reference=`OFF-${command.id}`;
  const meta={sync_status:'pending',local_operation_id:command.id,created_at:stamp,updated_at:stamp};
  const catalogRows=[...data.catalog,...(data.lookups?.catalog||[])],customerRows=[...data.customers,...(data.lookups?.customers||[])],supplierRows=[...data.suppliers,...(data.lookups?.suppliers||[])];
  const can=area=>data.access?.[area]!==false;
  const authorize=area=>{if(!can(area))throw new Error('Seu perfil não permite executar esta operação offline.');};
  const find=(list,key,label)=>{const result=(list||[]).find(row=>row.id===key);if(!result)throw new Error(`${label} não está disponível nos dados deste aparelho. Prepare o modo offline antes de sair.`);return result;};
  const activity=body.businessActivity||'unassigned';if(!['unassigned','electrical','farm'].includes(activity))throw new Error('Selecione uma atividade válida.');
  function paymentMethod(value=body.paymentMethod){if(!methods.has(value))throw new Error('Selecione uma forma de pagamento válida.');return value;}
  function stockChange(itemId,quantity,direction,reason,trackedOnly=false){
    const product=find(catalogRows,itemId,'Produto');if(product.archived_at||!product.is_active||product.item_type!=='product')throw new Error('Produto indisponível para movimentação.');
    let stock=data.stock.find(s=>s.id===itemId);if(!stock){stock={id:itemId,name:product.name,unit:product.unit,minimum_stock:product.minimum_stock||'0',movements:0,stock:'0.000'};data.stock.push(stock);}
    if(trackedOnly&&!Number(stock.movements)&&!Number(stock.minimum_stock))return;
    const before=signed(stock.stock);if(direction==='out'&&before<quantity)throw new Error(`Estoque local insuficiente para ${product.name}. Atualize os dados ou revise a quantidade.`);
    stock.stock=decimal(before+(direction==='in'?quantity:-quantity),3);stock.movements=Number(stock.movements||0)+1;
    data.movements.unshift({id:crypto.randomUUID(),catalog_item_id:itemId,item_name:product.name,unit:product.unit,direction,quantity:decimal(quantity,3),reason,created_at:stamp,sync_status:'pending'});
  }
  function addPayment(entry,amount,paidAt,selector='financialPaymentId',name='payment'){
    const previous=units(entry.amount_paid||'0'),total=units(entry.amount);if(amount<=0n||previous+amount>total)throw new Error('O valor informado supera o saldo local ou não é positivo.');
    const payment={id:bind(name,selector),entry_id:entry.id,amount:decimal(amount),paid_at:paidAt,payment_method:paymentMethod(),...meta};data.financialPayments.unshift(payment);
    entry.payment_method=payment.payment_method;entry.amount_paid=decimal(previous+amount);entry.status=previous+amount===total?'settled':'pending';entry.settled_at=entry.status==='settled'?paidAt:null;entry.sync_status='pending';return payment;
  }
  let match;
  if((match=/^\/api\/(customers|catalog|suppliers)(?:\/([\da-f-]+))?$/.exec(path))&&['POST','PATCH'].includes(method)){
    authorize('commercial');const group=match[1]==='catalog'?'catalog':match[1],label=group==='catalog'?'item':group==='customers'?'customer':'supplier';
    const fields=normalize(body);if(method==='POST'||body.name!==undefined)fields.name=requireText(body.name,'nome',group==='catalog'?180:200);
    if(fields.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email))throw new Error('Informe um e-mail válido.');
    if(fields.payment_term_days!=null&&fields.payment_term_days!==''&&(!Number.isInteger(Number(fields.payment_term_days))||Number(fields.payment_term_days)<0||Number(fields.payment_term_days)>3650))throw new Error('Prazo de pagamento inválido.');
    if(group==='catalog')for(const field of ['cost_price','sale_price','minimum_stock'])if(fields[field]!=null)units(fields[field],field==='minimum_stock'?3:2);
    if(method==='PATCH'){const entry=find(data[group],match[2],'Cadastro');Object.assign(entry,fields,{sync_status:'pending',updated_at:stamp});return{data,result:{[label]:entry},bindings};}
    if(group==='catalog'&&!['product','service'].includes(fields.item_type))throw new Error('Selecione produto ou serviço.');
    const entry={id:bind('entity',`${label}.id`),is_active:true,archived_at:null,...fields,...meta};data[group].push(entry);return{data,result:{[label]:entry},bindings};
  }
  if(path==='/api/sales/transport-profiles'&&method==='POST'){
    authorize('commercial');const entry={id:bind('entity','profile.id'),vehicle:requireText(body.vehicle,'veículo',120),plate:String(body.plate||'').trim().toUpperCase(),driver:String(body.driver||'').trim()};if(entry.plate.length>12||entry.driver.length>120)throw new Error('Confira placa e motorista.');data.transportProfiles.push(entry);return{data,result:{profile:entry},bindings};
  }
  if(path==='/api/sales'&&method==='POST'){
    authorize('commercial');paymentMethod();let customer,items,discount;
    if(body.quoteId){const quote=find(data.quotes,body.quoteId,'Orçamento');if(quote.status!=='approved'||data.sales.some(s=>s.quote_id===quote.id))throw new Error('Este orçamento não pode ser convertido.');customer={id:quote.customer_id,name:quote.customer_name,tax_identifier:quote.customer_tax_identifier,phone:quote.customer_phone,...data.customers.find(c=>c.id===quote.customer_id)};items=quote.items.map(i=>({...i}));discount=units(quote.discount_amount);}
    else{
      customer=find(customerRows,body.customerId,'Cliente');if(customer.archived_at)throw new Error('O cliente está arquivado.');discount=units(body.discountAmount||'0');
      if(!Array.isArray(body.items)||!body.items.length||body.items.length>100)throw new Error('Adicione de 1 a 100 itens à venda.');
      items=body.items.map((item,index)=>{const catalog=item.catalogItemId?find(catalogRows,item.catalogItemId,'Produto ou serviço'):null;if(catalog&&(catalog.archived_at||!catalog.is_active))throw new Error('Um dos itens está inativo.');const quantity=units(item.quantity,3),price=units(item.unitPrice);if(quantity<=0n)throw new Error('A quantidade precisa ser positiva.');if(!catalog&&!['product','service'].includes(item.itemType))throw new Error('Selecione o tipo do item.');return{id:crypto.randomUUID(),position:index+1,catalog_item_id:catalog?.id||null,item_type:catalog?.item_type||item.itemType,name:catalog?.name||requireText(item.name,'descrição',180),description:catalog?.description||item.description||'',unit:catalog?.unit||(typeof item.unit==='string'&&item.unit.trim()&&item.unit.length<=20?item.unit.trim():(()=>{throw new Error('Informe uma unidade válida.');})()),quantity:decimal(quantity,3),unit_price:decimal(price),line_total:decimal((quantity*price+500n)/1000n)};});
    }
    const subtotal=items.reduce((sum,i)=>sum+units(i.line_total),0n),freight=units(body.freightAmount||'0'),freightCost=units(body.freightCost||'0');if(discount>subtotal)throw new Error('O desconto não pode superar o subtotal.');const total=subtotal-discount+freight;if(total>999999999999n)throw new Error('O total excede o limite permitido.');
    const paid=units(body.amountPaid||'0');if(paid>total)throw new Error('O recebido não pode superar o total.');
    const saleDate=date(body.saleDate),term=body.paymentTermDays===''||body.paymentTermDays==null?customer.payment_term_days:Number(body.paymentTermDays);if(term!=null&&(!Number.isInteger(Number(term))||Number(term)<0||Number(term)>3650))throw new Error('Prazo inválido.');
    const sale={id:bind('sale','sale.id'),sale_number:null,sale_year:Number(saleDate.slice(0,4)),is_provisional:true,provisional_reference:reference,customer_id:customer.id,customer_name:customer.name,customer_phone:customer.phone,customer_tax_identifier:customer.tax_identifier,quote_id:body.quoteId||null,status:'completed',sale_date:saleDate,due_date:body.dueDate?date(body.dueDate):dueFromTerm(saleDate,term)||null,payment_term_days:term??null,payment_method:body.paymentMethod,payment_status:paid===total?'paid':paid>0n?'partial':'pending',subtotal:decimal(subtotal),discount_amount:decimal(discount),freight_amount:decimal(freight),freight_cost:decimal(freightCost),total:decimal(total),amount_paid:'0.00',business_activity:activity,notes:body.notes||'',vehicle:body.vehicle||'',plate:String(body.plate||'').toUpperCase(),driver:body.driver||'',destination:body.destination||'',items,payments:[],...meta};
    for(const key of ['vehicle','plate','driver','destination'])if(sale[key].length>({vehicle:120,plate:12,driver:120,destination:200}[key]))throw new Error('Confira os dados de transporte.');
    for(const item of items)if(item.item_type==='product'&&item.catalog_item_id)stockChange(item.catalog_item_id,units(item.quantity,3),'out',`Venda provisória ${reference}`,true);
    if(total>0n){const entry={id:bind('entry','financialEntryId'),entry_type:'income',amount:decimal(total),amount_paid:'0.00',title:`Nota provisória ${reference}`,competence_date:saleDate,due_date:sale.due_date,status:'pending',source_type:'sale',source_id:sale.id,sale_id:sale.id,customer_id:customer.id,business_activity:activity,...meta};data.entries.push(entry);if(paid>0n){const p=addPayment(entry,paid,saleDate);sale.payments.push({...p,received_date:saleDate});}}
    if(freightCost>0n)data.entries.push({id:bind('freight','freightEntryId'),entry_type:'expense',amount:decimal(freightCost),amount_paid:'0.00',title:`Frete provisório ${reference}`,competence_date:saleDate,due_date:saleDate,status:'pending',source_type:'freight',source_id:sale.id,sale_id:sale.id,business_activity:activity,...meta});
    sale.amount_paid=decimal(paid);data.sales.push(sale);return{data,result:{sale},bindings};
  }
  if((match=/^\/api\/(sales|operations\/finance)\/([\da-f-]+)\/payments$/.exec(path))&&method==='POST'){
    const isSale=match[1]==='sales';authorize(isSale?'commercial':'finance');paymentMethod();const amount=units(body.amount),paidAt=date(body.receivedDate||body.paidAt);
    const sale=isSale?find(data.sales,match[2],'Venda'):null;
    const entry=sale?data.entries.find(e=>e.source_type==='sale'&&e.source_id===sale.id):find(data.entries,match[2],'Lançamento');
    if(!entry||entry.status==='cancelled'||sale?.status==='cancelled')throw new Error('O lançamento está cancelado ou indisponível.');
    const payment=addPayment(entry,amount,paidAt,isSale?'financialPaymentId':'paymentId');
    const linkedSale=sale||(entry.source_type==='sale'?data.sales.find(s=>s.id===entry.sale_id):null);if(linkedSale){const previous=units(linkedSale.amount_paid);if(previous+amount>units(linkedSale.total))throw new Error('O recebimento supera o saldo da venda.');linkedSale.amount_paid=decimal(previous+amount);linkedSale.payment_status=previous+amount===units(linkedSale.total)?'paid':'partial';linkedSale.sync_status='pending';linkedSale.payments.unshift({...payment,received_date:paidAt});}
    return{data,result:isSale?{sale:linkedSale}:{paid:entry.amount_paid,balance:decimal(units(entry.amount)-units(entry.amount_paid)),settled:entry.status==='settled'},bindings};
  }
  if(path==='/api/operations/finance'&&method==='POST'){
    authorize('finance');const total=units(body.amount),title=requireText(body.title,'descrição',180);const category=body.expenseCategory?requireText(body.expenseCategory,'categoria',80).replace(/\s+/g,' '):null;if(!['income','expense'].includes(body.entryType)||total<=0n)throw new Error('Informe tipo e valor válidos.');
    const mode=body.scheduleMode||'single',count=mode==='single'?1:Number(body.scheduleCount);if(!['single','installments','recurring'].includes(mode)||!Number.isInteger(count)||count<1||count>120||body.status==='settled'&&count>1)throw new Error('Confira as parcelas e a situação inicial.');
    const entries=[];for(let index=0;index<count;index++){const amount=mode==='installments'?total/BigInt(count)+(index<Number(total%BigInt(count))?1n:0n):total;if(amount<=0n)throw new Error('O valor não pode gerar parcelas de zero.');const entry={id:bind(`entry${index}`,`entries.${index}.id`),title:count>1?`${title} · ${index+1}/${count}`:title,entry_type:body.entryType,amount:decimal(amount),amount_paid:'0.00',status:'pending',business_activity:activity,competence_date:shiftDate(date(body.competenceDate),index,body.scheduleFrequency),due_date:body.dueDate?shiftDate(date(body.dueDate),index,body.scheduleFrequency):null,customer_id:body.customerId||null,supplier_id:body.supplierId||null,source_type:'manual',expense_category:category,notes:body.notes||'',...meta};if(entry.customer_id)find(customerRows,entry.customer_id,'Cliente');if(entry.supplier_id)find(supplierRows,entry.supplier_id,'Fornecedor');data.entries.push(entry);entries.push(entry);if(body.status==='settled')addPayment(entry,amount,date(body.settledAt));}
    return{data,result:{entry:entries[0],entries},bindings};
  }
  if(path==='/api/operations/purchases'&&method==='POST'){
    authorize('finance');const purchaseDate=date(body.purchaseDate);if(!Array.isArray(body.items)||!body.items.length||body.items.length>100)throw new Error('Adicione os produtos da compra.');let total=0n;
    for(const item of body.items){const quantity=units(item.quantity,3),cost=units(item.unitCost);if(quantity<=0n)throw new Error('Informe uma quantidade positiva.');stockChange(item.catalogItemId,quantity,'in',`Compra provisória ${reference}`);total+=(quantity*cost+500n)/1000n;}
    if(total>999999999999n)throw new Error('O total da compra excede o limite.');const paid=units(body.amountPaid||'0');if(paid>total)throw new Error('O pagamento supera a compra.');if(body.supplierId)find(supplierRows,body.supplierId,'Fornecedor');
    const purchase={id:bind('purchase','purchase.id'),purchase_number:null,provisional_reference:reference,is_provisional:true,total:decimal(total),purchase_date:purchaseDate,supplier_id:body.supplierId||null,business_activity:activity,...meta};data.purchases.push(purchase);
    if(total>0n){const entry={id:bind('entry','financialEntryId'),entry_type:'expense',title:`Compra provisória ${reference}`,amount:decimal(total),amount_paid:'0.00',status:'pending',competence_date:purchaseDate,due_date:body.dueDate?date(body.dueDate):null,supplier_id:body.supplierId||null,source_type:'purchase',source_id:purchase.id,business_activity:activity,...meta};data.entries.push(entry);if(paid>0n)addPayment(entry,paid,purchaseDate);}
    return{data,result:{purchase},bindings};
  }
  if(path==='/api/operations/stock/movements'&&method==='POST'){
    authorize('operations');const quantity=units(body.quantity,3);if(quantity<=0n||!['in','out'].includes(body.direction))throw new Error('Confira a movimentação.');stockChange(body.catalogItemId,quantity,body.direction,requireText(body.reason,'motivo',300));const movement=data.movements[0];movement.id=bind('entity','movement.id');return{data,result:{movement},bindings};
  }
  if(path==='/api/operations/appointments'&&method==='POST'){
    authorize('operations');const start=new Date(body.startsAt),end=body.endsAt?new Date(body.endsAt):null;if(Number.isNaN(start.getTime())||end&&(Number.isNaN(end.getTime())||end<=start))throw new Error('Confira os horários do compromisso.');
    const appointment={id:bind('entity','appointment.id'),title:requireText(body.title,'título',180),starts_at:start.toISOString(),ends_at:end?.toISOString()||null,customer_id:body.customerId||null,service_order_id:body.serviceOrderId||null,status:'scheduled',address:body.address||'',notes:body.notes||'',...meta};data.appointments.push(appointment);return{data,result:{appointment},bindings};
  }
  if((match=/^\/api\/operations\/appointments\/([\da-f-]+)\/status$/.exec(path))&&method==='PATCH'){
    authorize('operations');if(!['scheduled','completed','cancelled'].includes(body.status))throw new Error('Situação inválida.');const appointment=find(data.appointments,match[1],'Compromisso');Object.assign(appointment,{status:body.status,...meta});return{data,result:{appointment},bindings};
  }
  if(path==='/api/completion/receipts'&&method==='POST'){
    authorize('finance');const payment=find(data.financialPayments,body.paymentId,'Pagamento'),entry=find(data.entries,payment.entry_id,'Lançamento');const customer=data.customers.find(c=>c.id===entry.customer_id),supplier=data.suppliers.find(s=>s.id===entry.supplier_id);
    const receipt={id:bind('entity','receipt.id'),receipt_number:null,is_provisional:true,provisional_reference:reference,payment_id:payment.id,financial_entry_id:entry.id,amount:payment.amount,paid_at:payment.paid_at,payment_method:payment.payment_method,description:body.description||entry.title,payer_name:body.payerName||(entry.entry_type==='income'?customer?.name||data.company.name:data.company.name),payee_name:body.payeeName||(entry.entry_type==='income'?data.company.name:supplier?.name||'Fornecedor'),signature_required:body.signatureRequired!==false,...meta};data.receipts.push(receipt);return{data,result:{receipt},bindings};
  }
  throw new Error('Esta ação exige conexão para preservar a integridade. Seus dados não foram enviados nem descartados.');
}
