import test from 'node:test';
import assert from 'node:assert/strict';
import {createLoadForecastPdf,forecastLineCents} from '../apps/web/src/loadForecastPdf.js';

test('PDF de previsão preserva dados e pagina muitos produtos', async () => {
  const item={name:'Banana de teste',category:'frutas',quantity:'2.500',unitPrice:'3.45',weight:'5.250',unit:'kg',first:'33.33',second:'33.33',third:'33.34'};
  assert.equal(forecastLineCents(item),863n);
  const forecast={property:'Fazenda Exemplo',producer:'Produtor Teste',forecast_date:'2026-11-02',items:Array.from({length:40},(_,i)=>i===0?{...item,loadQuality:{first:'33.33',second:'33.33',third:'33.34'}}:item)};
  const {doc,filename}=await createLoadForecastPdf(forecast,{name:'Empresa Exemplo',address:'Rua Exemplo 123',document_settings:{}},{logo:null});
  assert(doc.getNumberOfPages()>1);
  const output=doc.output();
  for(const text of ['Fazenda Exemplo','Produtor Teste','Banana de teste','33.34%','Valor total da carga','Quantidade total','Peso total']) assert(output.includes(text),text);
  assert(output.includes('Rua Exemplo 123'));
  assert(output.indexOf('Rua Exemplo 123') < output.indexOf('Dados da carga'));
  assert.equal(filename,'previsao-carga-2026-11-02.pdf');
});

test('PDF separa unidades e sinaliza peso ausente em previsões antigas', async () => {
  const base={name:'Produto teste',category:'frutas',unitPrice:'1.00',first:'10',second:'20',third:'30'};
  const forecast={property:'Fazenda',producer:'Produtor',forecast_date:'2026-11-02',items:[{...base,unit:'kg',quantity:'1.250',weight:'2.500'},{...base,unit:'kg',quantity:'2.500',weight:'1.250'},{...base,unit:'cx',quantity:'3',weight:''}]};
  const {doc}=await createLoadForecastPdf(forecast,{name:'Empresa',document_settings:{}},{logo:null});const pdf=doc.output();
  assert(pdf.includes('3,75 kg')); assert(pdf.includes('3 cx')); assert(pdf.includes('3,75 kg')); assert(pdf.includes('registro anterior')); assert(pdf.includes('sem peso informado'));
});

test('PDF soma três itens de 100 kg e mostra apenas percentuais gerais', async () => {
  const item={name:'Banana',category:'frutas',unitPrice:'2.00',weight:'100',quantity:'100',unit:'kg'};
  const forecast={property:'Fazenda',producer:'Produtor',forecast_date:'2026-11-02',items:[{...item,loadQuality:{first:'50',second:'30',third:'20'}},item,item]};
  const {doc}=await createLoadForecastPdf(forecast,{name:'Empresa',document_settings:{}},{logo:null});const pdf=doc.output();
  assert(pdf.includes('Quantidade total: 300 kg'));assert(pdf.includes('Peso total: 300 kg'));assert(pdf.includes('primeira: 50%'));assert(pdf.includes('segunda: 30%'));assert(pdf.includes('terceira: 20%'));assert(!pdf.includes('Soma dos percentuais'));
});
