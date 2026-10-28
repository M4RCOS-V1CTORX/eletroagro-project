import test from 'node:test';
import assert from 'node:assert/strict';
import {applyOfflineCommand,units} from '../apps/web/src/offlineModel.js';
import {readOffline} from '../apps/web/src/offlineRead.js';
import {createOfflineQueue,queueScope,canQueue} from '../apps/web/src/offlineQueue.js';
import {validateAttachment} from '../apps/api/src/lib/attachments.js';
import {normalizePolicy} from '../shared/access-policy.js';

test('permissões individuais impedem criação e recebimento offline sem autorização',()=>{
  const base=offlineFixture();base.company.role='member';base.company.permissions=normalizePolicy({modules:{sales:{view:true}}});
  assert.throws(()=>applyOfflineCommand(base,cmd('/api/sales',saleBody)),/perfil/);
  base.company.permissions=normalizePolicy({modules:{sales:{view:true,create:true}}});
  assert.throws(()=>applyOfflineCommand(base,cmd('/api/sales',saleBody)),/recebimentos/);
  const created=applyOfflineCommand(base,cmd('/api/sales',{...saleBody,amountPaid:'0'}));assert.equal(created.result.sale.amount_paid,'0.00');
  assert.equal(base.sales.length,0);
});

export function offlineFixture(){return{version:1,preparedAt:'2026-10-26T12:00:00Z',company:{id:'company',name:'Empresa de teste',document_settings:{}},access:{commercial:true,finance:true,operations:true,audit:true},customers:[{id:'customer',name:'Cliente de teste',payment_term_days:8}],catalog:[{id:'product',name:'Banana de teste',item_type:'product',unit:'kg',is_active:true,minimum_stock:'1.000'}],suppliers:[],sales:[],quotes:[],transportProfiles:[],entries:[],financialPayments:[],receipts:[],purchases:[],stock:[{id:'product',name:'Banana de teste',unit:'kg',minimum_stock:'1.000',stock:'100.000',movements:1}],movements:[],appointments:[],orders:[],attachments:[],activity:[]};}
const cmd=(path,payload,method='POST')=>({id:crypto.randomUUID(),createdAt:Date.now(),path,method,payload,localIds:{}});
const saleBody={customerId:'customer',saleDate:'2026-10-26',businessActivity:'farm',paymentMethod:'pix',amountPaid:'10',freightAmount:'3.50',freightCost:'2',discountAmount:'1',items:[{catalogItemId:'product',quantity:'2.500',unitPrice:'4.00'}]};
test('venda offline é provisória, usa centavos e reserva estoque sem alterar a base',()=>{
  const base=offlineFixture(),command=cmd('/api/sales',saleBody),result=applyOfflineCommand(base,command);
  assert.equal(result.result.sale.total,'12.50');assert.equal(result.result.sale.is_provisional,true);assert.equal(result.result.sale.sale_number,null);assert.equal(result.result.sale.due_date,'2026-11-03');assert.equal(result.data.stock[0].stock,'97.500');assert.equal(base.stock[0].stock,'100.000');assert.equal(result.data.entries.find(e=>e.entry_type==='income').amount_paid,'10.00');assert.equal(result.data.entries.find(e=>e.entry_type==='expense').amount,'2.00');
  assert.equal(applyOfflineCommand(base,command).result.sale.id,result.result.sale.id,'Reprodução mantém a mesma identidade provisória');
});
test('recebimento offline atualiza venda e financeiro e impede valor acima do saldo',()=>{
  const first=applyOfflineCommand(offlineFixture(),cmd('/api/sales',saleBody)),sale=first.result.sale;
  const received=applyOfflineCommand(first.data,cmd(`/api/sales/${sale.id}/payments`,{amount:'2.50',paymentMethod:'cash',receivedDate:'2026-10-27'}));assert.equal(received.result.sale.amount_paid,'12.50');assert.equal(received.result.sale.payment_status,'paid');assert.equal(received.data.entries.find(e=>e.entry_type==='income').amount_paid,'12.50');
  assert.throws(()=>applyOfflineCommand(received.data,cmd(`/api/sales/${sale.id}/payments`,{amount:'.01',paymentMethod:'pix'})));assert.equal(first.result.sale.amount_paid,'10.00');
});
test('estoque insuficiente, precisão inválida e permissões recusam sem mutação',()=>{
  const base=offlineFixture();assert.throws(()=>units('1.001'));assert.throws(()=>applyOfflineCommand(base,cmd('/api/sales',{...saleBody,items:[{catalogItemId:'product',quantity:'101',unitPrice:'1'}]})),/Estoque local insuficiente/);assert.equal(base.stock[0].stock,'100.000');base.access.commercial=false;assert.throws(()=>applyOfflineCommand(base,cmd('/api/sales',saleBody)),/perfil/);
});
test('parcelamento offline preserva todos os centavos e o calendário',()=>{
  const result=applyOfflineCommand(offlineFixture(),cmd('/api/operations/finance',{entryType:'expense',title:'Despesa parcelada',amount:'100.00',scheduleMode:'installments',scheduleCount:3,competenceDate:'2026-01-31',dueDate:'2026-01-31'}));assert.deepEqual(result.result.entries.map(e=>e.amount),['33.34','33.33','33.33']);assert.deepEqual(result.result.entries.map(e=>e.due_date),['2026-01-31','2026-02-28','2026-03-31']);
});
test('consultas offline filtram corretamente e não tratam provisória como número definitivo',()=>{
  const result=applyOfflineCommand(offlineFixture(),cmd('/api/sales',saleBody));const summary=readOffline(result.data,'/api/sales/summary?from=2026-10-01&to=2026-10-26&activity=farm').summary;assert.equal(summary.sales_total,'12.50');assert.equal(summary.received_total,'10.00');assert.equal(readOffline(result.data,'/api/sales?activity=electrical').sales.length,0);assert.equal(readOffline(result.data,'/api/operations/finance?type=expense').entries.length,1);
});
test('fila preserva rejeições, não envia entre contas e reutiliza a chave do envio original',async()=>{
  let active={issuer:'test',subject:'a',companyId:'a'},rows=[],sent=[];
  const queue=createOfflineQueue({context:()=>active,read:async()=>structuredClone(rows),put:async row=>{rows=rows.filter(r=>r.id!==row.id);rows.push(row);},remove:async id=>{rows=rows.filter(r=>r.id!==id);},send:async row=>{sent.push(row.id);return new Response(JSON.stringify({error:{message:'Estoque insuficiente'}}),{status:409});}});
  const key=crypto.randomUUID();await queue.enqueue('/api/sales',{method:'POST',body:'{}',headers:{'X-Idempotency-Key':key,Authorization:'never-store'}});assert.equal(rows[0].id,key);assert(!JSON.stringify(rows).includes('never-store'));active={issuer:'test',subject:'b',companyId:'b'};assert.equal((await queue.flush()).sent,0);assert.equal(sent.length,0);active={issuer:'test',subject:'a',companyId:'a'};const result=await queue.flush();assert.equal(result.failed,1);assert.equal(result.remaining,1);assert.equal(rows[0].status,'failed');assert.match(rows[0].error,/Estoque/);assert.equal(queueScope(active),rows[0].scope);
});
test('fila só remove após confirmação e evita duas sincronizações simultâneas',async()=>{
  let rows=[],calls=0;const queue=createOfflineQueue({context:()=>({issuer:'t',subject:'a',companyId:'c'}),read:async()=>rows,put:async row=>rows.push(row),remove:async id=>{rows=rows.filter(r=>r.id!==id);},send:async()=>{calls+=1;await new Promise(resolve=>setTimeout(resolve,10));return new Response('{}',{status:201});}});await queue.enqueue('/api/customers',{method:'POST',body:'{}'});await Promise.all([queue.flush(),queue.flush()]);assert.equal(calls,1);assert.equal(rows.length,0);assert.equal(canQueue('/api/customers/123','DELETE'),false);assert.equal(canQueue('/api/sales','POST'),true);
});
test('anexos exigem conteúdo, tipo e tamanho reais coerentes',()=>{
  const bytes=Buffer.from('%PDF-1.4\nTest');const attachment={mimeType:'application/pdf',byteSize:bytes.length,contentData:`data:application/pdf;base64,${bytes.toString('base64')}`};assert(validateAttachment(attachment));assert(!validateAttachment({...attachment,byteSize:1}));assert(!validateAttachment({...attachment,mimeType:'image/png'}));assert(!validateAttachment({...attachment,contentData:'javascript:alert(1)'}));
});
