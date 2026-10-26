import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSaleExtras, dueDateFromTerm } from '../apps/api/src/lib/commercial.js';
import { duplicateSale, dueFromTerm, saleMessage, saleNumber } from '../apps/web/src/commercial.js';
import { createSalePdf } from '../apps/web/src/salePdf.js';

test('frete é convertido em centavos e dados inválidos são recusados',()=>{
  const parsed=parseSaleExtras({freightAmount:'3500.00',freightCost:'3100.15',businessActivity:'farm',plate:'knx3h03',paymentTermDays:'8'});
  assert.equal(parsed.value.freightAmount,350000n);assert.equal(parsed.value.freightCost,310015n);assert.equal(parsed.value.plate,'KNX3H03');
  for(const body of [{freightAmount:'-1'},{freightAmount:'0.001'},{freightCost:'NaN'},{businessActivity:'invalid'},{paymentTermDays:1.2},{paymentTermDays:3651},{vehicle:[]}])assert(parseSaleExtras(body).error);
});
test('prazo automático atravessa meses, anos e anos bissextos',()=>{
  for(const [date,days,result] of [['2026-12-28',8,'2027-01-05'],['2028-02-28',1,'2028-02-29'],['2026-10-13',8,'2026-10-21'],['2026-10-13',0,'2026-10-13']]){
    assert.equal(dueDateFromTerm(date,days),result);assert.equal(dueFromTerm(date,days),result);
  }
  assert.equal(dueFromTerm('2026-10-13',''),'');assert.equal(dueDateFromTerm('2026-10-13',null),null);
});
const sale={id:'old',sale_number:1,sale_year:2027,customer_id:'customer',customer_name:'Cliente de validação',customer_phone:'74999999999',sale_date:'2027-01-02',due_date:'2027-01-10',payment_term_days:8,payment_method:'pix',business_activity:'farm',vehicle:'Caminhão truck',plate:'ABC1D23',driver:'Motorista de validação',destination:'Feira de Santana',subtotal:'5838.00',discount_amount:'0.00',freight_amount:'3500.00',freight_cost:'3000.00',total:'9338.00',amount_paid:'1000.00',status:'completed',quote_id:'old-quote',items:[{id:'old-item',name:'Banana prata anã — 1ª',item_type:'product',catalog_item_id:null,unit:'kg',quantity:'1002',unit_price:'1.00',line_total:'1002.00'}]};
test('duplicação reinicia recebimentos, origem e data sem alterar a venda anterior',()=>{
  const draft=duplicateSale(sale,'2027-02-01');assert.equal(draft.amountPaid,'0');assert.equal(draft.quoteId,'');assert.equal(draft.saleDate,'2027-02-01');assert.equal(draft.dueDate,'2027-02-09');assert.equal(draft.vehicle,sale.vehicle);assert.equal(draft.items[0].isCustom,true);assert.equal(draft.freightCost,'3000.00');assert(!draft.id);assert(!draft.sale_number);assert(!draft.items[0].id);assert.equal(sale.amount_paid,'1000.00');
});
test('identificação e mensagem de cobrança preservam ano, vencimento e saldo',()=>{
  assert.equal(saleNumber(sale),'001/2027');const message=saleMessage(sale);assert.match(message,/001\/2027/);assert.match(message,/10\/01\/2027/);assert.match(message,/8\.338,00/);assert.equal(saleNumber({is_preview:true}),'Prévia — sem emissão');
});
test('nota PDF contém frete e pagamento sem expor custo interno e pagina textos extensos',async()=>{
  const company={name:'Empresa de validação',document_settings:{pixKey:'pix-de-validacao',showSignature:true}};
  const {doc,filename}=await createSalePdf({...sale,notes:'Linha longa para verificação de paginação e margens. '.repeat(120)},company,{logo:null});
  const output=doc.output();assert.match(filename,/001-2027/);assert.match(output,/Frete/);assert.match(output,/pix-de-validacao/);assert(!output.includes('3.000,00'));assert(doc.getNumberOfPages()>1);
});
