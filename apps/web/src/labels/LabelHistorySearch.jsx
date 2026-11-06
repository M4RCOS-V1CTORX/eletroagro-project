import { Search, X } from 'lucide-react';

export default function LabelHistorySearch({ value, onChange, onSearch, onClear, busy, hasSearch }) {
  return (
    <form className="label-history-search" role="search" onSubmit={onSearch}>
      <label htmlFor="label-history-query">Buscar no histórico</label>
      <div className="label-history-search-controls">
        <input id="label-history-query" type="search" maxLength={200} value={value}
          placeholder="Produto, propriedade ou responsável" disabled={busy}
          onChange={event => onChange(event.target.value)} />
        <button type="submit" className="workspace-button primary" disabled={busy}>
          <Search size={15} aria-hidden="true" /> Buscar
        </button>
        {(hasSearch || value) && (
          <button type="button" className="workspace-button subtle" disabled={busy} onClick={onClear}>
            <X size={15} aria-hidden="true" /> Limpar busca
          </button>
        )}
      </div>
    </form>
  );
}
