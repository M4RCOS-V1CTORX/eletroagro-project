import { createPdfPalette, drawPdfFooters, drawPdfHeader, drawPdfSection, drawPdfSignature, drawPdfTableHeader, formatPdfCurrency, formatPdfDate, loadPdfLogo, PDF_PAGE } from './pdfDesign.js';
import { saleNumber } from './commercial.js';
const methods={pix:'Pix',cash:'Dinheiro',card_debit:'Débito',card_credit:'Crédito',transfer:'Transferência',boleto:'Boleto',other:'Outro'};

export async function createSalePdf(sale,company,{logo:providedLogo}={}) {
  const {jsPDF}=await import('jspdf');
  const doc=new jsPDF({unit:'mm',format:'a4'}), palette=createPdfPalette(company);
  const logo=providedLogo===undefined?await loadPdfLogo():providedLogo;
  const {width,margin,contentBottom}=PDF_PAGE, right=width-margin;
  const number=saleNumber(sale),title='Nota de produtos';
  let y=drawPdfHeader(doc,{company,title,number,numberPrefix:'Nº ',subtitle:`Data: ${formatPdfDate(sale.sale_date)}`,status:sale.is_preview?'Prévia':sale.is_provisional?'Provisória — offline':sale.status==='cancelled'?'Cancelada':'Concluída',palette,logo});
  function newPage(){doc.addPage();y=drawPdfHeader(doc,{company,title,number,numberPrefix:'Nº ',palette,compact:true});}
  function room(height){if(y+height>contentBottom)newPage();}
  function line(text,{bold=false,size=9,color=palette.ink}={}){room(6);doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(size);doc.setTextColor(...color);doc.text(String(text),margin+4,y);y+=5;}
  function paragraph(text,bold=false){doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(9);for(const part of doc.splitTextToSize(String(text),right-margin-8))line(part,{bold});}
  y=drawPdfSection(doc,y,'Cliente','',palette);
  if(sale.is_provisional||sale.sync_status==='pending')paragraph(sale.is_provisional?'DOCUMENTO PROVISÓRIO — AGUARDANDO SINCRONIZAÇÃO':'Existem recebimentos locais aguardando confirmação do servidor.',true);
  paragraph(sale.customer_name||'Cliente',true);
  const clientDetails=[sale.customer_tax_identifier&&`CPF/CNPJ: ${sale.customer_tax_identifier}`,sale.customer_phone&&`Telefone: ${sale.customer_phone}`].filter(Boolean).join('   |   ');
  if(clientDetails)paragraph(clientDetails);
  y+=3;room(43);y=drawPdfSection(doc,y,'Informações básicas','',palette);
  const fields=[['Veículo',sale.vehicle],['Placa',sale.plate],['Motorista',sale.driver],['Destino',sale.destination],['Data',formatPdfDate(sale.sale_date)],['Vencimento',formatPdfDate(sale.due_date)]];
  for(let i=0;i<fields.length;i+=3){
    doc.setFontSize(9);
    const row=fields.slice(i,i+3).map(([label,value])=>[label,doc.splitTextToSize(String(value||'Não informado'),51)]);
    const height=8+Math.max(...row.map(([,lines])=>lines.length))*4.5;room(height);
    for(const [j,[label,lines]] of row.entries()){const x=margin+4+j*59;doc.setFont('helvetica','bold');doc.setTextColor(...palette.navy);doc.text(label,x,y);doc.setFont('helvetica','normal');doc.setTextColor(...palette.ink);doc.text(lines,x,y+5);}
    y+=height;
  }
  room(26);y=drawPdfSection(doc,y,'Produtos e serviços','',palette);
  const columns=[{label:'Descrição',x:margin+4},{label:'Qtd./un.',x:123,align:'right'},{label:'Preço',x:153,align:'right'},{label:'Total',x:right-4,align:'right'}];
  const tableHeader=()=>{y=drawPdfTableHeader(doc,y,columns,palette);};tableHeader();
  for(const item of sale.items||[]){
    doc.setFont('helvetica','normal');doc.setFontSize(9);
    const lines=doc.splitTextToSize([item.name,item.description].filter(Boolean).join(' — '),78);
    let first=true;
    while(lines.length){
      if(y+14>contentBottom){newPage();tableHeader();}
      const count=Math.max(1,Math.floor((contentBottom-y-8)/4.5)),part=lines.splice(0,count),height=Math.max(10,part.length*4.5+5);
      doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(...palette.ink);doc.text(part,margin+4,y+3.5);
      if(first){doc.text(`${new Intl.NumberFormat('pt-BR',{maximumFractionDigits:3}).format(Number(item.quantity))} ${item.unit||''}`,123,y+3.5,{align:'right'});doc.text(formatPdfCurrency(item.unit_price),153,y+3.5,{align:'right'});doc.setFont('helvetica','bold');doc.text(formatPdfCurrency(item.line_total),right-4,y+3.5,{align:'right'});}
      doc.setDrawColor(...palette.line);doc.line(margin,y+height-2,right,y+height-2);y+=height;first=false;
      if(lines.length){newPage();tableHeader();}
    }
  }
  y+=3;room(44);
  const totals=[['Subtotal dos itens',sale.subtotal],...(Number(sale.discount_amount)>0?[['Desconto',-Number(sale.discount_amount)]]:[]),['Frete',sale.freight_amount||0],['Total',sale.total],['Recebido',sale.amount_paid],['Saldo em aberto',Number(sale.total)-Number(sale.amount_paid)]];
  for(const [label,amount] of totals){doc.setFont('helvetica',label==='Total'?'bold':'normal');doc.setFontSize(label==='Total'?12:9);doc.setTextColor(...palette.navy);doc.text(label,105,y+4);doc.text(formatPdfCurrency(amount),right-4,y+4,{align:'right'});y+=6.5;}
  y+=5;room(22);y=drawPdfSection(doc,y,'Pagamento','',palette);
  paragraph(`Forma: ${methods[sale.payment_method]||'Outro'}`);
  if(sale.payment_term_days!=null)paragraph(Number(sale.payment_term_days)===0?'Condição: à vista':`Condição: a prazo — ${sale.payment_term_days} dias`);
  const settings=company?.document_settings||{};
  for(const text of [settings.pixKey&&`Chave Pix: ${settings.pixKey}`,settings.bankDetails&&`Dados bancários: ${settings.bankDetails}`,settings.paymentInstructions].filter(Boolean))paragraph(text);
  if(sale.payments?.length){y+=5;room(20);y=drawPdfSection(doc,y,'Recebimentos','',palette);for(const payment of sale.payments)paragraph(`${formatPdfDate(payment.received_date)} — ${methods[payment.payment_method]||'Outro'} — ${formatPdfCurrency(payment.amount)}`);}
  if(sale.notes){y+=5;room(20);y=drawPdfSection(doc,y,'Observações','',palette);paragraph(sale.notes);}
  if(settings.showSignature!==false){room(28);y+=15;drawPdfSignature(doc,y,'Assinatura do cliente',palette);}
  drawPdfFooters(doc,{company,palette,text:settings.footerText||'Documento comercial — não fiscal'});
  const clientPart=(sale.customer_name||'cliente').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'-').slice(0,48);
  const filename=`nota-${number.replace('/','-')}-${clientPart}.pdf`;
  if(typeof window!=='undefined'){const {archivePdf}=await import('./deviceFiles.js');await archivePdf(doc,filename);}
  return {doc,filename};
}
