export const activities = new Set(['unassigned', 'electrical', 'farm']);

export function parseSaleExtras(body) {
  const value = { businessActivity: body.businessActivity ?? 'unassigned' };
  if (!activities.has(value.businessActivity)) return { error: 'Selecione uma atividade válida.' };
  for (const [key, max] of Object.entries({ vehicle: 120, plate: 12, driver: 120, destination: 200 })) {
    if (body[key] != null && typeof body[key] !== 'string') return { error: 'Confira os dados do transporte.' };
    value[key] = (body[key] || '').trim();
    if (value[key].length > max) return { error: `O campo ${key} excede ${max} caracteres.` };
  }
  value.plate = value.plate.toUpperCase();
  for (const key of ['freightAmount', 'freightCost']) {
    const text = String(body[key] ?? '0');
    if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(text)) return { error: 'Informe valores de frete válidos, maiores ou iguais a zero.' };
    const [whole, fraction = ''] = text.split('.');
    value[key] = BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
  }
  value.paymentTermDays = body.paymentTermDays === '' || body.paymentTermDays == null ? null : Number(body.paymentTermDays);
  if (value.paymentTermDays !== null && (!Number.isInteger(value.paymentTermDays) || value.paymentTermDays < 0 || value.paymentTermDays > 3650)) return { error: 'O prazo deve ser de 0 a 3650 dias.' };
  return { value };
}

export function dueDateFromTerm(date, days) {
  if (days == null) return null;
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}
