import test from 'node:test';
import assert from 'node:assert/strict';
import {createLoadForecastPdf,forecastLineCents} from '../apps/web/src/loadForecastPdf.js';

test('PDF de previsão preserva dados e pagina muitos produtos', async () => {
  const item={name:'Banana de teste',category:'frutas',quantity:'2.500',unitPrice:'3.45',unit:'kg',first:'33.33',second:'33.33',third:'33.34'};
  assert.equal(forecastLineCents(item),863n);
  const forecast={property:'Fazenda Exemplo',producer:'Produtor Teste',forecast_date:'2026-11-02',items:Array.from({length:40},()=>item)};
  const {doc,filename}=await createLoadForecastPdf(forecast,{name:'Empresa Exemplo',address:'Rua Exemplo 123',document_settings:{}},{logo:null});
  assert(doc.getNumberOfPages()>1);
  const output=doc.output();
  for(const text of ['Fazenda Exemplo','Produtor Teste','Banana de teste','33.34%','Valor total da carga']) assert(output.includes(text),text);
  assert(output.includes('Rua Exemplo 123'));
  assert(output.indexOf('Rua Exemplo 123') < output.indexOf('Dados da carga'));
  assert.equal(filename,'previsao-carga-2026-11-02.pdf');
});
