import { Save } from 'lucide-react';

export default function LabelForm({ draft, busy, canSave, onChange, onSave, editing, onCancel }) {
  return (
    <form className="label-form" onSubmit={onSave}>
      <div className="label-form-grid">
        <label>
          Produto
          <input required minLength={2} maxLength={200} value={draft.productName} disabled={busy}
            placeholder="Ex.: Banana-prata" onChange={event => onChange({ productName: event.target.value })} />
        </label>
        <label>
          Propriedade
          <input required minLength={2} maxLength={200} value={draft.propertyName} disabled={busy}
            placeholder="Ex.: Fazenda Boa Vista" onChange={event => onChange({ propertyName: event.target.value })} />
        </label>
        <div className="label-form-responsibles">
          <label>
            Responsáveis pela colheita
            <textarea required maxLength={20100} rows={3} value={draft.producerNames} disabled={busy}
              aria-describedby="label-producers-help" placeholder={'Maria Oliveira\nJoão Santos'}
              onChange={event => onChange({ producerNames: event.target.value })} />
          </label>
          <small id="label-producers-help">Digite um nome por linha. Você pode informar mais de um responsável.</small>
        </div>
        <label>
          Data da colheita
          <input required type="date" min="1900-01-01" value={draft.harvestDate} disabled={busy}
            onChange={event => onChange({ harvestDate: event.target.value })} />
        </label>
        <label>
          Telefone
          <input
            type="tel"
            autoComplete="tel"
            maxLength={30}
            value={draft.phone}
            disabled={busy}
            aria-describedby="label-contacts-help"
            placeholder="Ex.: (77) 99999-1234"
            onChange={event => onChange({ phone: event.target.value })}
          />
        </label>
        <label>
          E-mail
          <input
            type="email"
            autoComplete="email"
            maxLength={254}
            value={draft.email}
            disabled={busy}
            aria-describedby="label-contacts-help"
            placeholder="Ex.: contato@fazenda.com.br"
            onChange={event => onChange({ email: event.target.value })}
          />
        </label>
      </div>
      <p id="label-contacts-help" className="label-code-note">
        Telefone e e-mail são opcionais. Informe apenas contatos que deseja divulgar na consulta pública.
      </p>
      <footer className="label-form-footer">
        <p>{editing ? 'O QR Code permanece o mesmo. A consulta online será atualizada; o texto no papel já impresso não muda.' : 'Após salvar, baixe ou imprima o QR Code pelo histórico. É necessário ter internet para salvar e consultar as etiquetas.'}</p>
        {editing && <button type="button" className="workspace-button subtle" disabled={busy} onClick={onCancel}>Cancelar edição</button>}
        <button type="submit" className="workspace-button primary" disabled={busy || !canSave}>
          <Save size={16} aria-hidden="true" /> {busy ? 'Salvando…' : editing ? 'Salvar alterações' : 'Salvar etiqueta'}
        </button>
      </footer>
    </form>
  );
}
