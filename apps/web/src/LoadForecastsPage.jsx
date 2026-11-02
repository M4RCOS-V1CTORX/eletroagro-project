import { useEffect, useState } from 'react';
import { ArrowLeft, CalendarDays, ChevronDown, ClipboardList, Download, Leaf, PackagePlus, Plus, Sprout, Trash2, Truck } from 'lucide-react';
import { apiRequest } from './apiClient.js';
import { createLoadForecastPdf } from './loadForecastPdf.js';
import { savePdfToDevice } from './deviceFiles.js';

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const total = (item) => { const units = (value, digits) => { const [whole, fraction = ''] = String(value || '0').split('.'); return BigInt(whole || '0') * 10n ** BigInt(digits) + BigInt((fraction + '0'.repeat(digits)).slice(0, digits)); }; try { return Number((units(item.quantity, 3) * units(item.unitPrice, 2) + 500n) / 1000n) / 100; } catch { return 0; } };
const blankItem = () => ({ productId: '', category: 'frutas', quantity: '1', unitPrice: '0', first: '0', second: '0', third: '0' });
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
export default function LoadForecastsPage({ onBack }) {
  const [forecasts, setForecasts] = useState([]), [products, setProducts] = useState([]), [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [requireFullPercentage, setRequireFullPercentage] = useState(false), [pdfBusy, setPdfBusy] = useState(null);
  const [draft, setDraft] = useState({ property: '', producer: '', date: today(), items: [blankItem()] });
  async function loadProducts() {
    const items = [];
    let offset = 0;
    for (;;) {
      const page = await apiRequest(`/api/catalog?type=product&status=active&offset=${offset}`);
      const seen = new Set(items.map(item => item.id));
      const fresh = page.items.filter(item => !seen.has(item.id));
      items.push(...fresh);
      if (items.length >= page.total || !fresh.length || page.items.length < 100) return { items };
      offset += page.items.length;
    }
  }
  async function load() {
    const [forecastsResult, productsResult] = await Promise.allSettled([apiRequest('/api/load-forecasts'), loadProducts()]);
    if (forecastsResult.status === 'fulfilled') setForecasts(forecastsResult.value.forecasts);
    if (productsResult.status === 'fulfilled') setProducts(productsResult.value.items);
    const errors = [forecastsResult, productsResult].filter(result => result.status === 'rejected').map(result => result.reason.message);
    if (errors.length) throw new Error(errors.join(' '));
  }
  useEffect(() => { load().catch(e => setError(e.message)).finally(() => setLoading(false)); }, []);
  function update(index, patch) { setDraft(d => ({ ...d, items: d.items.map((item,i) => i === index ? { ...item, ...patch } : item) })); }
  async function save(event) { event.preventDefault(); setError(''); setBusy(true); try { await apiRequest('/api/load-forecasts', { method:'POST', body:JSON.stringify({...draft,requireFullPercentage}) }); setDraft({ property:'', producer:'', date:today(), items:[blankItem()] }); await load(); } catch(e) { setError(e.message); } finally { setBusy(false); } }
  async function downloadPdf(forecast) { setError(''); setPdfBusy(forecast.id); try { await apiRequest('/api/company/authorize?module=quotes&action=export'); const company = await apiRequest('/api/company/me'); const {doc,filename} = await createLoadForecastPdf(forecast, company.company); await savePdfToDevice(doc,filename); } catch(e) { setError(e.message); } finally { setPdfBusy(null); } }
  return <section className="customers-page forecast-page">
    <button type="button" className="forecast-back" onClick={onBack}><ArrowLeft size={16}/> Voltar aos orçamentos</button>
    <div className="forecast-heading"><div className="forecast-heading-icon"><Truck size={24}/></div><div><span className="customers-kicker">COMERCIAL / ORÇAMENTOS</span><h1>Previsão de Carga</h1><p>Organize os produtos, quantidades e a classificação da sua carga.</p></div></div>
    {error && <p className="customers-feedback error" role="alert">{error}</p>}
    <form className="forecast-form" onSubmit={save}>
      <div className="forecast-section-heading"><div className="forecast-section-icon"><ClipboardList size={19}/></div><div><h2>Nova previsão</h2><p>Comece informando a origem da carga.</p></div></div>
      <div className="forecast-fields forecast-origin"><label>Propriedade<input required maxLength="200" placeholder="Nome da propriedade" value={draft.property} onChange={e=>setDraft({...draft,property:e.target.value})}/></label><label>Produtor<input required maxLength="200" placeholder="Nome do produtor" value={draft.producer} onChange={e=>setDraft({...draft,producer:e.target.value})}/></label><label>Data<input required type="date" value={draft.date} onChange={e=>setDraft({...draft,date:e.target.value})}/></label></div>
      <div className="forecast-items-heading"><div><h3>Produtos da carga</h3><p>Informe os produtos e seus respectivos valores.</p></div><span>{draft.items.length} {draft.items.length===1?'produto':'produtos'}</span></div>
      <fieldset className="forecast-percent-rule"><legend>Como validar os percentuais?</legend><p>Escolha como deseja classificar os produtos desta previsão.</p><div><label><input type="radio" name="percent-rule" checked={!requireFullPercentage} onChange={()=>setRequireFullPercentage(false)}/> Percentuais livres</label><label><input type="radio" name="percent-rule" checked={requireFullPercentage} onChange={()=>setRequireFullPercentage(true)}/> Devem somar 100% por produto</label></div></fieldset>
      {draft.items.map((item,index)=><fieldset className="forecast-item" key={index}><legend className="forecast-sr-only">Produto {index+1}</legend><div className="forecast-item-heading"><div><span className="forecast-item-icon"><Sprout size={17}/></span><strong>Produto {String(index+1).padStart(2,'0')}</strong></div>{draft.items.length>1&&<button type="button" className="forecast-remove" onClick={()=>setDraft({...draft,items:draft.items.filter((_,i)=>i!==index)})} aria-label={`Remover produto ${index+1}`}><Trash2 size={15}/> <span>Remover</span></button>}</div>
        <div className="forecast-fields forecast-product-fields"><label>Categoria<select value={item.category} onChange={e=>update(index,{category:e.target.value})}><option value="frutas">Frutas</option><option value="verduras">Verduras</option></select></label><label>Produto<select required value={item.productId} onChange={e=>{const product=products.find(p=>p.id===e.target.value);update(index,{productId:e.target.value,unitPrice:product?String(product.sale_price):'0'});}}><option value="">Selecione um produto</option>{products.map(p=><option value={p.id} key={p.id}>{p.name} ({p.unit})</option>)}</select></label><label>Quantidade<input required type="number" min="0.001" max="999999999.999" step="0.001" value={item.quantity} onChange={e=>update(index,{quantity:e.target.value})}/></label><label>Valor unitário (R$)<input required type="number" min="0" max="999999999.99" step="0.01" value={item.unitPrice} onChange={e=>update(index,{unitPrice:e.target.value})}/></label></div>
        <div className="forecast-quality"><div className="forecast-quality-copy"><strong>Classificação de qualidade</strong><span>Informe os percentuais para cada categoria.</span></div><div className="forecast-quality-fields">{[['first','Primeira'],['second','Segunda'],['third','Terceira']].map(([key,label])=><label key={key}>{label}<span className="forecast-percent"><input required aria-label={`${label} (%)`} type="number" min="0" max="100" step="0.01" value={item[key]} onChange={e=>update(index,{[key]:e.target.value})}/><span>%</span></span></label>)}</div><div className="forecast-item-total"><span>Valor do produto</span><strong>{money.format(total(item))}</strong></div></div></fieldset>)}
      <button type="button" className="forecast-add" onClick={()=>setDraft({...draft,items:[...draft.items,blankItem()]})}><Plus size={17}/> Adicionar produto</button>
      <div className="forecast-form-footer"><div><span>Valor total da carga</span><strong>{money.format(draft.items.reduce((sum,item)=>sum+Math.round(total(item)*100),0)/100)}</strong></div><button className="customers-primary" disabled={busy}><ClipboardList size={16}/> {busy?'Salvando…':'Salvar previsão'}</button></div>
    </form>
    <div className="forecast-history-heading"><div><span className="customers-kicker">ACOMPANHAMENTO</span><h2>Previsões registradas</h2><p>Consulte as cargas cadastradas pela equipe.</p></div><span className="forecast-count">{forecasts.length} {forecasts.length===1?'registro':'registros'}</span></div>
    {loading?<div className="forecast-empty">Carregando previsões…</div>:!error&&!forecasts.length?<div className="forecast-empty"><span><PackagePlus size={23}/></span><strong>Nenhuma previsão cadastrada</strong><p>As previsões salvas aparecerão aqui para toda a equipe.</p></div>:null}
    <div className="forecast-history">{forecasts.map(f=><details className="forecast-record" key={f.id}><summary><span className="forecast-record-icon"><Leaf size={19}/></span><span className="forecast-record-title"><strong>{f.property}</strong><small>{f.producer}</small></span><span className="forecast-record-date"><CalendarDays size={15}/> {String(f.forecast_date).slice(0,10).split('-').reverse().join('/')}</span><span className="forecast-count">{f.items.length} {f.items.length===1?'produto':'produtos'}</span><ChevronDown className="forecast-chevron" size={19}/></summary><div className="forecast-record-body"><div className="forecast-record-actions"><button type="button" className="customers-secondary" disabled={pdfBusy!==null} onClick={()=>downloadPdf(f)}><Download size={15}/> {pdfBusy===f.id?'Gerando…':'Baixar PDF'}</button></div><div className="customers-table-wrap"><table className="customers-table forecast-table"><thead><tr><th>Produto</th><th>Categoria</th><th>Quantidade</th><th>Primeira / segunda / terceira</th><th>Valor unitário</th><th>Total</th></tr></thead><tbody>{f.items.map((item,i)=><tr key={i}><td><strong>{item.name}</strong></td><td>{item.category==='frutas'?'Frutas':'Verduras'}</td><td>{item.quantity} {item.unit}</td><td>{item.first}% / {item.second}% / {item.third}%</td><td>{money.format(Number(item.unitPrice))}</td><td><strong>{money.format(total(item))}</strong></td></tr>)}</tbody></table></div></div></details>)}</div>
  </section>;
}
