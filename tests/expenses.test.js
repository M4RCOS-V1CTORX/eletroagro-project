import test from 'node:test';import assert from 'node:assert/strict';
import {offlineExpenses} from '../apps/web/src/expenseData.js';
const base=()=>({suppliers:[{id:'supplier',name:'Fornecedor de teste'}],entries:[
{id:'a',title:'Energia da fazenda',entry_type:'expense',source_type:'manual',expense_category:'Energia',business_activity:'farm',amount:'100.10',amount_paid:'0.25',status:'pending',competence_date:'2020-01-01',due_date:'2020-01-02',supplier_id:'supplier'},
{id:'b',title:'Frete pago',entry_type:'expense',source_type:'freight',business_activity:'farm',amount:'50.00',amount_paid:'50.00',status:'settled',competence_date:'2020-01-01',due_date:'2020-01-02'},
{id:'c',title:'Cancelada',entry_type:'expense',source_type:'manual',business_activity:'electrical',amount:'20.00',amount_paid:'0.00',status:'cancelled',competence_date:'2020-01-01'},
{id:'d',title:'Receita excluída',entry_type:'income',source_type:'manual',business_activity:'farm',amount:'999.00',amount_paid:'999.00',status:'settled',competence_date:'2020-01-01'}],financialPayments:[{id:'p1',entry_id:'a',amount:'0.25',paid_at:'2020-01-02',payment_method:'cash'},{id:'p2',entry_id:'b',amount:'50.00',paid_at:'2020-01-02',payment_method:'pix'}]});
test('despesas offline usam os mesmos filtros e totais, sem receitas ou valores cancelados',()=>{
 const result=offlineExpenses(base(),new URLSearchParams('limit=1'));assert.equal(result.entries.length,1);assert.equal(result.pagination.total,3);assert.equal(result.summary.total,'150.10');assert.equal(result.summary.paid,'50.25');assert.equal(result.summary.pending,'99.85');assert.equal(result.summary.overdue,'99.85');
 const only=offlineExpenses(base(),new URLSearchParams('activity=farm&category=Energia&status=overdue&q=Fornecedor&paymentMethod=cash&from=2020-01-01&to=2020-01-03'));assert.equal(only.pagination.total,1);assert.equal(only.summary.total,'100.10');assert.equal(only.entries[0].payment_method,'cash');
 assert.equal(offlineExpenses(base(),new URLSearchParams('status=cancelled')).summary.total,'0.00');assert.equal(offlineExpenses(base(),new URLSearchParams('paymentMethod=boleto')).pagination.total,0);
});
test('paginação de despesas mantém os indicadores do conjunto inteiro e ordena por valor',()=>{
 const data=base();data.entries=Array.from({length:30},(_,i)=>({...data.entries[0],id:String(i).padStart(2,'0'),amount:'0.01',amount_paid:'0.00'}));data.financialPayments=[];const result=offlineExpenses(data,new URLSearchParams('limit=25&offset=25&sort=amount&order=desc'));assert.equal(result.entries.length,5);assert.equal(result.pagination.total,30);assert.equal(result.summary.total,'0.30');assert.equal(result.summary.pending,'0.30');
});
