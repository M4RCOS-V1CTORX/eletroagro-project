import {createPdfPalette,drawPdfFooters,drawPdfHeader,drawPdfSection,formatPdfCurrency,formatPdfDate,loadPdfLogo,PDF_PAGE} from './pdfDesign.js';

export function forecastLineCents(item) {
  const units = (value, digits) => { const [whole, fraction=''] = String(value || '0').split('.'); return BigInt(whole || '0') * 10n ** BigInt(digits) + BigInt((fraction + '0'.repeat(digits)).slice(0,digits)); };
  return (units(item.quantity,3) * units(item.unitPrice,2) + 500n) / 1000n;
}
export async function createLoadForecastPdf(forecast, company, {logo:providedLogo}={}) {
  const {jsPDF}=await import('jspdf');
  const doc=new jsPDF({unit:'mm',format:'a4'}), palette=createPdfPalette(company), logo=providedLogo===undefined?await loadPdfLogo():providedLogo;
  const {margin,width,contentBottom}=PDF_PAGE, right=width-margin;
  let y=drawPdfHeader(doc,{company,title:'Previsão de carga',subtitle:`Data: ${formatPdfDate(forecast.forecast_date)}`,palette,logo,groupedCompany:true});
  const newPage=()=>{doc.addPage();y=drawPdfHeader(doc,{company,title:'Previsão de carga',palette,compact:true});};
  const line=(text,{bold=false,size=9}={})=>{doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(size);doc.setTextColor(...palette.ink);const lines=doc.splitTextToSize(String(text),right-margin-8);for(const part of lines){if(y+6>contentBottom)newPage();doc.text(part,margin+4,y);y+=5;}};
  y=drawPdfSection(doc,y,'Dados da carga','',palette);
  line(`Propriedade: ${forecast.property}`,{bold:true});line(`Produtor: ${forecast.producer}`);line(`Data: ${formatPdfDate(forecast.forecast_date)}`);y+=4;
  if(y+20>contentBottom)newPage();y=drawPdfSection(doc,y,'Produtos','',palette);
  let total=0n, totalWeight=0n, weightsMissing=false;
  const quantities=new Map(), quality=forecast.items?.[0]?.loadQuality;
  const thousandths = value => { const [whole,fraction='']=String(value||'0').split('.'); return BigInt(whole||'0')*1000n+BigInt((fraction+'000').slice(0,3)); };
  const formatThousandths = value => new Intl.NumberFormat('pt-BR',{maximumFractionDigits:3}).format(Number(value)/1000);
  for(const [i,item] of (forecast.items||[]).entries()) {
    if(y+32>contentBottom)newPage();
    const cents=forecastLineCents(item);total+=cents;
    const unit=String(item.unit||'un').trim();quantities.set(unit,(quantities.get(unit)||0n)+thousandths(item.quantity));
    if(item.weight==null||item.weight==='')weightsMissing=true;else totalWeight+=thousandths(item.weight);
    line(`${i+1}. ${item.name} — ${item.category==='frutas'?'Frutas':'Verduras'}`,{bold:true,size:10});
    line(`Quantidade: ${item.quantity} ${item.unit||''}    |    Valor unitário: ${formatPdfCurrency(item.unitPrice)}    |    Total: ${formatPdfCurrency(Number(cents)/100)}`);
    line(`Peso: ${item.weight==null||item.weight===''?'Não informado':`${item.weight} kg`}`);
    if(!quality && item.first!=null)line(`Qualidade por produto (registro anterior): primeira ${item.first}% | segunda ${item.second}% | terceira ${item.third}%`);
    y+=3;
  }
  if(y+24>contentBottom)newPage();y+=3;
  line('Totais da carga',{bold:true,size:11});
  for(const [unit,quantity] of quantities)line(`Quantidade total: ${formatThousandths(quantity)} ${unit}`);
  line(`Peso ${weightsMissing ? 'informado' : 'total'}: ${formatThousandths(totalWeight)} kg${weightsMissing?' (há produtos sem peso informado)':''}`);
  if(quality) line(`Qualidade da carga — primeira: ${quality.first}% | segunda: ${quality.second}% | terceira: ${quality.third}%`);
  else line('Percentuais anteriores registrados por produto.');
  line(`Valor total da carga: ${formatPdfCurrency(Number(total)/100)}`,{bold:true,size:11});
  drawPdfFooters(doc,{company,palette,text:company?.document_settings?.footerText||'Documento comercial — não fiscal'});
  return {doc,filename:`previsao-carga-${String(forecast.forecast_date).slice(0,10)}.pdf`};
}
