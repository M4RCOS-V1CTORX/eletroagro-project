export const activityLabels = { unassigned: 'Sem atividade definida', electrical: 'Elétrica', farm: 'Fazenda' };
export const saleNumber = sale => sale.is_preview ? 'Prévia — sem emissão' : sale.is_provisional?`Provisória OFF-${sale.provisional_reference?.slice(-16)}`:`${String(sale.sale_number).padStart(3,'0')}/${sale.sale_year || String(sale.sale_date).slice(0,4)}`;
export function localToday() {
  const date=new Date();
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function dueFromTerm(date, days) {
  if(!date || days==='' || days==null) return '';
  const value=new Date(`${date}T12:00:00Z`);
  if(!Number.isInteger(Number(days)) || Number(days)<0 || Number(days)>3650 || Number.isNaN(value.getTime())) return '';
  value.setUTCDate(value.getUTCDate()+Number(days));
  return value.toISOString().slice(0,10);
}
export function duplicateSale(sale, date=localToday()) {
  return { quoteId:'',customerId:sale.customer_id||'',saleDate:date,dueDate:dueFromTerm(date,sale.payment_term_days),paymentTermDays:sale.payment_term_days??'',
    businessActivity:sale.business_activity||'unassigned',vehicle:sale.vehicle||'',plate:sale.plate||'',driver:sale.driver||'',destination:sale.destination||'',
    freightAmount:String(sale.freight_amount||'0'),freightCost:String(sale.freight_cost||'0'),
    amountPaid:'0',paymentMethod:sale.payment_method||'pix',discountAmount:String(sale.discount_amount||'0'),notes:sale.notes||'',
    items:sale.items.map(item=>({catalogItemId:item.catalog_item_id||'',isCustom:!item.catalog_item_id,name:item.name,itemType:item.item_type,unit:item.unit,quantity:String(item.quantity),unitPrice:String(item.unit_price),description:item.description||''})) };
}
export function saleMessage(sale) {
  const currency=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
  const due=sale.due_date ? new Intl.DateTimeFormat('pt-BR').format(new Date(`${String(sale.due_date).slice(0,10)}T12:00:00`)) : '';
  return `Olá, ${sale.customer_name}! Segue a nota de produtos nº ${saleNumber(sale)}, no valor de ${currency.format(Number(sale.total))}.${due?` Vencimento: ${due}.`:''} Saldo a pagar: ${currency.format(Math.max(0,Number(sale.total)-Number(sale.amount_paid)))}.`;
}
