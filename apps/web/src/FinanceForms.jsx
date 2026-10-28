import ExpenseCategoryField from './ExpenseCategoryField.jsx';
import { X } from 'lucide-react';
import { ActivitySelect } from './SaleExtras.jsx';
import { Message, SmallButton } from './WorkspaceUI.jsx';
export const paymentMethods = {
  pix: 'Pix',
  cash: 'Dinheiro',
  card_debit: 'Débito',
  card_credit: 'Crédito',
  transfer: 'Transferência',
  boleto: 'Boleto',
  other: 'Outro'
};
const methods = paymentMethods;
const moneyText = value => new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL'
}).format(Number(value || 0));
export function FinanceEntryDialog({
  draft,
  setDraft,
  busy,
  error,
  onSubmit,
  customers = [],
  suppliers = [],
  editing = false,
  showExpenseCategory = false,
  categories = [],
  categoryLabel='Categoria da despesa'
}) {
  return draft ? <div className="workspace-backdrop" onMouseDown={e => !busy && e.target === e.currentTarget && setDraft(null)}><section className="workspace-modal finance-entry-modal" role="dialog" aria-modal="true"><header><span className="workspace-eyebrow">NOVO REGISTRO</span><h2>{editing ? (draft.entryType==='income'?'Editar conta a receber':'Editar despesa') : draft.entryType === 'income' ? 'Registrar receita' : 'Registrar despesa'}</h2><button onClick={() => setDraft(null)} disabled={busy} aria-label="Fechar"><X /></button></header><form onSubmit={onSubmit}><ActivitySelect context={showExpenseCategory&&draft.entryType==='expense'?'expense':'all'} value={draft.businessActivity} onChange={value => setDraft({
          ...draft,
          businessActivity: value
        })} />{showExpenseCategory && <ExpenseCategoryField label={categoryLabel} value={draft.expenseCategory} onChange={value => setDraft({
          ...draft,
          expenseCategory: value
        })} categories={categories} />}<label>Descrição<input required minLength="2" maxLength="180" value={draft.title} onChange={e => setDraft({
            ...draft,
            title: e.target.value
          })} placeholder="Ex.: compra de material, serviço…" /></label><div className="workspace-form-row"><label>Valor (R$)<input required type="number" min="0.01" step="0.01" value={draft.amount} onChange={e => setDraft({
              ...draft,
              amount: e.target.value
            })} /></label><label>Competência<input required type="date" value={draft.competenceDate} onChange={e => setDraft({
              ...draft,
              competenceDate: e.target.value
            })} /></label></div><div className="workspace-form-row"><label>Vencimento<input type="date" value={draft.dueDate} onChange={e => setDraft({
              ...draft,
              dueDate: e.target.value
            })} /></label><label>{draft.entryType === 'income' ? 'Cliente' : 'Fornecedor'}<select value={draft.entryType === 'income' ? draft.customerId : draft.supplierId} onChange={e => setDraft({
              ...draft,
              [draft.entryType === 'income' ? 'customerId' : 'supplierId']: e.target.value
            })}><option value="">Sem vínculo</option>{(draft.entryType === 'income' ? customers : suppliers).map(x => <option value={x.id} key={x.id}>{x.name}</option>)}</select></label></div>{!editing && <><div className="workspace-form-row"><label>Programação<select aria-label="Programação" value={draft.scheduleMode} onChange={e => setDraft({
                ...draft,
                scheduleMode: e.target.value,
                status: e.target.value === 'single' ? draft.status : 'pending'
              })}><option value="single">Lançamento único</option><option value="installments">Parcelar o valor total</option><option value="recurring">Repetir o mesmo valor</option></select></label>{draft.scheduleMode !== 'single' && <label>{draft.scheduleMode === 'installments' ? 'Quantidade de parcelas' : 'Quantidade de repetições'}<input type="number" min="2" max="120" value={draft.scheduleCount} onChange={e => setDraft({
                ...draft,
                scheduleCount: Number(e.target.value)
              })} /></label>}</div>{draft.scheduleMode !== 'single' && <label>Intervalo<select aria-label="Intervalo" value={draft.scheduleFrequency} onChange={e => setDraft({
              ...draft,
              scheduleFrequency: e.target.value
            })}><option value="month">Mensal</option><option value="week">Semanal</option></select><small>{draft.scheduleMode === 'installments' ? 'O valor total será dividido entre os lançamentos.' : 'O mesmo valor será repetido em cada lançamento.'}</small></label>}<label>Condição inicial<select aria-label="Condição inicial" disabled={draft.scheduleMode !== 'single'} value={draft.status} onChange={e => setDraft({
              ...draft,
              status: e.target.value
            })}><option value="pending">Pendente</option><option value="settled">Já recebido / pago</option></select></label>{draft.status === 'settled' && <div className="workspace-form-row"><label>Data<input type="date" value={draft.settledAt} onChange={e => setDraft({
                ...draft,
                settledAt: e.target.value
              })} /></label><label>Forma<select aria-label="Forma" value={draft.paymentMethod} onChange={e => setDraft({
                ...draft,
                paymentMethod: e.target.value
              })}>{Object.entries(methods).map(([v, l]) => <option value={v} key={v}>{l}</option>)}</select></label></div>}</>}<label>Observações<textarea aria-label="Observações" rows="3" maxLength="3000" value={draft.notes} onChange={e => setDraft({
            ...draft,
            notes: e.target.value
          })} /></label><Message error={error} /><footer><SmallButton disabled={busy} onClick={() => setDraft(null)}>Cancelar</SmallButton><button className="workspace-button primary" disabled={busy}>{busy ? 'Salvando…' : editing ? 'Salvar alterações' : showExpenseCategory ? 'Salvar despesa' : 'Salvar lançamento'}</button></footer></form></section></div> : null;
}
export function FinancePaymentDialog({
  payment,
  setPayment,
  busy,
  error,
  onSubmit
}) {
  return payment ? <div className="workspace-backdrop"><section className="workspace-modal finance-entry-modal" role="dialog" aria-modal="true"><header><span className="workspace-eyebrow">BAIXA FINANCEIRA</span><h2>Registrar {payment.entry.entry_type === 'income' ? 'recebimento' : 'pagamento'}</h2><button onClick={() => setPayment(null)} disabled={busy} aria-label="Fechar"><X /></button></header><form onSubmit={onSubmit}><p className="finance-balance-callout">Saldo restante <strong>{moneyText(payment.entry.balance)}</strong></p><label>Valor<input required type="number" min="0.01" max={payment.entry.balance} step="0.01" value={payment.amount} onChange={e => setPayment({
            ...payment,
            amount: e.target.value
          })} /></label><div className="workspace-form-row"><label>Data<input type="date" required value={payment.paidAt} onChange={e => setPayment({
              ...payment,
              paidAt: e.target.value
            })} /></label><label>Forma<select value={payment.paymentMethod} onChange={e => setPayment({
              ...payment,
              paymentMethod: e.target.value
            })}>{Object.entries(methods).map(([v, l]) => <option value={v} key={v}>{l}</option>)}</select></label></div><Message error={error} /><footer><SmallButton disabled={busy} onClick={() => setPayment(null)}>Cancelar</SmallButton><button className="workspace-button primary" disabled={busy}>{busy ? 'Salvando…' : 'Confirmar baixa'}</button></footer></form></section></div> : null;
}
