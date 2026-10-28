import {useState} from 'react';
import {apiRequest} from './apiClient.js';
import {createCategoryPdf} from './categoryPdf.js';
import {savePdfToDevice} from './deviceFiles.js';
import {canAction} from '../../../shared/access-policy.js';
const modules={sales:'Vendas',expenses:'Despesas',payables:'Contas a pagar',receivables:'Contas a receber',purchases:'Compras',cashflow:'Pagamentos e recebimentos',stock:'Estoque',quotes:'Orçamentos'};
export default function CategoryReports({company,range}){
  const[selected,setSelected]=useState([]),[category,setCategory]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  async function generate(){
    setBusy(true);setMessage('');
    try{
      const reports=[];
      for(const module of selected){const query=new URLSearchParams({...range,module,category:['expenses','payables','receivables','cashflow'].includes(module)?category.trim()||'all':'all',export:'1'});reports.push(await apiRequest(`/api/completion/reports/category?${query}`));}
      for(const report of reports)await savePdfToDevice(createCategoryPdf(report,company),`${report.module}-${range.from}-${range.to}.pdf`);
      setMessage(`${reports.length} PDF(s) gerado(s).`);
    }catch(error){setMessage(error.message);}finally{setBusy(false);}
  }
  return <article className="report-panel"><header><strong>Relatórios por módulo</strong></header><div className="reports-filter">
    {Object.entries(modules).filter(([key])=>company&&canAction(company,key==='cashflow'?'finance':key,'export')).map(([key,label])=><label key={key}><input type="checkbox" checked={selected.includes(key)} disabled={busy} onChange={e=>setSelected(e.target.checked?[...selected,key]:selected.filter(v=>v!==key))}/>{label}</label>)}
    <label>Categoria financeira<input value={category} disabled={busy} placeholder="Todas as categorias" maxLength={80} onChange={e=>setCategory(e.target.value)}/></label>
    <button className="workspace-button primary" onClick={generate} disabled={busy||!selected.length}>{busy?'Gerando…':'Gerar PDFs separados'}</button>
    <p>O período acima será usado. Categoria financeira se aplica a despesas, contas e pagamentos.</p>
    {message&&<p role="status">{message}</p>}
  </div></article>;
}
