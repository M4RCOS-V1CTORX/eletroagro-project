import { decimal, units } from './offlineModel.js';
import { localToday } from './commercial.js';
export function offlineExpenses(data, query) {
  const today = localToday(),
    q = String(query.get('q') || '').trim().toLocaleLowerCase('pt-BR');
  const payments = data.financialPayments || [];
  const rows = data.entries.filter(e => e.entry_type === 'expense').map(entry => {
    const history = payments.filter(p => p.entry_id === entry.id).sort((a, b) => String(b.paid_at).localeCompare(String(a.paid_at)));
    return {
      ...entry,
      supplier_name: data.suppliers.find(s => s.id === entry.supplier_id)?.name || entry.supplier_name,
      amount_paid: entry.amount_paid || '0.00',
      balance: decimal(units(entry.amount) - units(entry.amount_paid || '0')),
      last_paid_at: history[0]?.paid_at || null,
      payment_method: history[0]?.payment_method || entry.payment_method,
      payments: history,
      overdue: entry.status === 'pending' && !!entry.due_date && String(entry.due_date).slice(0, 10) < today
    };
  });
  const filtered = rows.filter(e => {
    const status = query.get('status') || 'all';
    const statusMatches = status === 'all' || (status === 'overdue' ? e.overdue : e.status === status);
    const date = String(e.due_date || e.competence_date).slice(0, 10),
      matches = (key, value) => !query.get(key) || query.get(key) === 'all' || query.get(key) === value;
    return (!q || `${e.title} ${e.supplier_name || ''}`.toLocaleLowerCase('pt-BR').includes(q)) && matches('activity', e.business_activity) && matches('category', e.expense_category || 'Sem categoria') && statusMatches && (!query.get('paymentMethod') || query.get('paymentMethod') === 'all' || e.payments.some(p => p.payment_method === query.get('paymentMethod'))) && (!query.get('from') || date >= query.get('from')) && (!query.get('to') || date <= query.get('to'));
  });
  const sum = (selector, field) => decimal(filtered.filter(selector).reduce((n, e) => n + units(e[field] || '0'), 0n));
  const summary = {
    count: filtered.length,
    total: sum(e => e.status !== 'cancelled', 'amount'),
    paid: sum(e => e.status !== 'cancelled', 'amount_paid'),
    pending: sum(e => e.status === 'pending', 'balance'),
    overdue: sum(e => e.overdue, 'balance')
  };
  const key = query.get('sort') || 'due_date',
    direction = query.get('order') === 'desc' ? -1 : 1;
  filtered.sort((a, b) => {
    const left = key === 'due_date' ? a.due_date || a.competence_date : a[key],
      right = key === 'due_date' ? b.due_date || b.competence_date : b[key];
    let comparison = key === 'amount' ? units(left) < units(right) ? -1 : units(left) > units(right) ? 1 : 0 : String(left || '').localeCompare(String(right || ''));
    return comparison * direction || a.id.localeCompare(b.id);
  });
  const limit = Math.min(100, Math.max(1, Number(query.get('limit') || 25))),
    offset = Math.max(0, Number(query.get('offset') || 0));
  return {
    categories: [...new Set(rows.map(e => e.expense_category || 'Sem categoria'))].sort((a, b) => a.localeCompare(b)),
    entries: filtered.slice(offset, offset + limit),
    summary,
    pagination: {
      limit,
      offset,
      total: filtered.length
    },
    all: rows
  };
}
