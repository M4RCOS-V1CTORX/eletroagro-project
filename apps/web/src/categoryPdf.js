import {jsPDF} from 'jspdf';
import {createPdfPalette,pdfAccent,drawPdfHeader,drawPdfFooters,formatPdfCurrency,formatPdfDate,PDF_PAGE} from './pdfDesign.js';

export function createCategoryPdf(report,company){
  const doc=new jsPDF(),palette=createPdfPalette(company);
  palette.accent=pdfAccent(report.color);
  const period=report.period.from?`${formatPdfDate(report.period.from)} a ${formatPdfDate(report.period.to)}`:`Posição em ${formatPdfDate(report.period.to)}`;
  let y=drawPdfHeader(doc,{company,title:report.title,subtitle:period,palette});
  const next=()=>{doc.addPage();y=drawPdfHeader(doc,{company,title:report.title,palette,compact:true});};
  const text=(value,size=9,bold=false)=>{
    doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(size);doc.setTextColor(...palette.ink);
    const lines=doc.splitTextToSize(String(value),178);
    for(const line of lines){if(y+5>PDF_PAGE.contentBottom)next();doc.text(line,16,y);y+=5;}
  };
  if(company?.address)text(company.address);
  text(`Categoria: ${report.category==='all'?'Todas':report.category} | Gerado em ${new Date(report.generatedAt).toLocaleString('pt-BR',{timeZone:'America/Bahia'})}`,8);
  text(`${report.summary.count} registro(s) | Total: ${formatPdfCurrency(report.summary.total)}`,11,true);y+=4;
  for(const row of report.rows){
    if(y+25>PDF_PAGE.contentBottom)next();
    text(row.description,10,true);
    text(`${formatPdfDate(row.date)} | ${row.party||row.category||'Sem categoria'} | ${row.status}`,8);
    text(report.module==='stock'?`Quantidade: ${row.quantity} ${row.unit} | Valor: ${formatPdfCurrency(row.amount)}`:`Valor: ${formatPdfCurrency(row.amount)} | Pago: ${formatPdfCurrency(row.paid)} | Saldo: ${formatPdfCurrency(row.balance)}`,9);
    y+=4;
  }
  if(!report.rows.length)text('Nenhum registro no período selecionado.');
  drawPdfFooters(doc,{company,palette});return doc;
}
