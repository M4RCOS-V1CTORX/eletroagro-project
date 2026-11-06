import { FileText, Pencil, Trash2 } from 'lucide-react';
import LabelCodeActions from './LabelCodeActions.jsx';

const dateFormatter = new Intl.DateTimeFormat('pt-BR');

export default function LabelHistory({ labels, canEdit, onEdit, canDelete, busy, onDelete, filtered }) {
  if (!labels.length) {
    return (
      <div className="label-history-empty">
        <FileText size={28} strokeWidth={1.4} aria-hidden="true" />
        <h3>{filtered ? 'Nenhuma etiqueta encontrada' : 'Nenhuma etiqueta salva'}</h3>
        <p>{filtered ? 'Tente outro termo ou limpe a busca para ver o histórico completo.' : 'As informações salvas pelo formulário aparecerão aqui.'}</p>
      </div>
    );
  }

  return (
    <ul className="label-history-list">
      {labels.map(label => (
        <li key={label.id}>
          <article className="label-history-record" aria-label={`Etiqueta de ${label.product_name}`}>
            <header>
              <span>INFORMAÇÕES DA ETIQUETA</span>
              <span>Ref. {label.id.slice(0, 8).toUpperCase()}</span>
            </header>
            <dl>
              <div><dt>Produto</dt><dd>{label.product_name}</dd></div>
              <div><dt>Propriedade</dt><dd>{label.property_name}</dd></div>
              <div><dt>Responsáveis pela colheita</dt><dd>{label.producers.map(producer => producer.name).join(', ')}</dd></div>
              <div><dt>Data da colheita</dt><dd>{dateFormatter.format(new Date(`${String(label.harvest_date).slice(0, 10)}T12:00:00`))}</dd></div>
            </dl>
            <footer>
              <LabelCodeActions label={label} />
              {canEdit && label.editable && (
                <button type="button" className="workspace-button subtle" disabled={busy}
                  aria-label={`Editar etiqueta de ${label.product_name}`} onClick={() => onEdit(label)}>
                  <Pencil size={15} aria-hidden="true" /> Editar
                </button>
              )}
              {canDelete && (
                <button type="button" className="workspace-button subtle" disabled={busy}
                  aria-label={`Excluir etiqueta de ${label.product_name}`} onClick={() => onDelete(label)}>
                  <Trash2 size={15} aria-hidden="true" /> Excluir
                </button>
              )}
            </footer>
            {canEdit && !label.editable && <p className="label-code-note">Esta etiqueta está disponível para consulta e impressão, mas não pode ser editada.</p>}
          </article>
        </li>
      ))}
    </ul>
  );
}
