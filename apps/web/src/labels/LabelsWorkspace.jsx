import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import { apiRequest } from '../apiClient.js';
import { localToday } from '../commercial.js';
import LabelForm from './LabelForm.jsx';
import LabelHistory from './LabelHistory.jsx';
import LabelHistorySearch from './LabelHistorySearch.jsx';

const PAGE_SIZE = 25;

function emptyDraft() {
  return { productName: '', propertyName: '', producerNames: '', harvestDate: localToday(), key: crypto.randomUUID() };
}

export default function LabelsWorkspace({ canCreate, canEdit, canDelete }) {
  const formSection = useRef(null);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [labels, setLabels] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setHistoryError('');
    setUnavailable(false);

    async function loadHistory() {
      try {
        const params = new URLSearchParams({ offset: String(offset), q: search });
        const result = await apiRequest(`/api/traceability/labels?${params}`, { offlineFallback: false });
        if (!active) return;
        setLabels(result.labels);
        setTotal(result.pagination.total);
        setReady(true);
      } catch (error) {
        if (!active) return;
        setReady(false);
        if (error.code === 'TRACEABILITY_NOT_READY') setUnavailable(true);
        else setHistoryError(error.message);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadHistory();
    return () => { active = false; };
  }, [offset, refresh, search]);

  function searchHistory(event) {
    event.preventDefault();
    setSearch(searchInput.trim());
    setOffset(0);
    setRefresh(value => value + 1);
  }

  function clearSearch() {
    setSearchInput('');
    setSearch('');
    setOffset(0);
  }

  function changeDraft(values) {
    setDraft(current => ({ ...current, ...values, key: crypto.randomUUID() }));
    setNotice('');
  }

  function beginEdit(label) {
    const original = { productName: label.product_name, propertyName: label.property_name,
      producerNames: label.producers.map(producer => producer.name), harvestDate: String(label.harvest_date).slice(0, 10) };
    setEditing({ publicId: label.public_id, original });
    setDraft({ ...original, producerNames: original.producerNames.join('\n'), key: crypto.randomUUID() });
    setFormError('');
    setNotice('');
  }

  useEffect(() => {
    if (editing) {
      formSection.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      formSection.current?.querySelector('input')?.focus({ preventScroll: true });
    }
  }, [editing]);

  function cancelEdit() {
    setEditing(null);
    setDraft(emptyDraft());
    setFormError('');
  }

  async function save(event) {
    event.preventDefault();
    const producerNames = draft.producerNames.split(/\r?\n/).map(name => name.trim()).filter(Boolean);
    if (!producerNames.length || producerNames.length > 100 || producerNames.some(name => name.length < 2 || name.length > 200)) {
      setFormError('Informe de 1 a 100 responsáveis, um por linha, com nomes entre 2 e 200 caracteres.');
      return;
    }
    if (editing && !window.confirm('Salvar alterações? A consulta pública será atualizada, inclusive para etiquetas já impressas. O QR Code continuará o mesmo.')) return;
    setBusy(true);
    setFormError('');
    setNotice('');
    try {
      await apiRequest(editing ? `/api/traceability/labels/${editing.publicId}` : '/api/traceability/labels', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'X-Idempotency-Key': draft.key },
        body: JSON.stringify({ productName: draft.productName, propertyName: draft.propertyName, producerNames, harvestDate: draft.harvestDate,
          ...(editing ? { original: editing.original } : {}) }),
      });
      setDraft(emptyDraft());
      setEditing(null);
      clearSearch();
      setOffset(0);
      setRefresh(value => value + 1);
      setNotice(editing ? 'Etiqueta atualizada. O QR Code continua o mesmo.' : 'Etiqueta salva. Use o histórico abaixo para visualizar a consulta ou gerar o QR Code.');
    } catch (error) {
      setFormError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeLabel(label) {
    if (busy || !canDelete || !window.confirm(`Excluir permanentemente a etiqueta de “${label.product_name}”? O QR Code, inclusive em etiquetas já impressas, deixará de abrir as informações. Esta ação não pode ser desfeita.`)) return;
    setBusy(true);
    setHistoryError('');
    setNotice('');
    try {
      await apiRequest(`/api/traceability/labels/${label.public_id}`, { method: 'DELETE' });
      setOffset(current => labels.length === 1 ? Math.max(0, current - PAGE_SIZE) : current);
      setRefresh(value => value + 1);
    } catch (error) {
      setHistoryError(error.message);
    } finally { setBusy(false); }
  }

  return (
    <div className="labels-workspace">
      {notice && <p className="workspace-message is-success" role="status">{notice}</p>}
      {(canCreate || (canEdit && editing)) && (
        <section ref={formSection} className="label-section" aria-labelledby="label-form-title">
          <header className="label-section-heading">
            <span className="label-eyebrow">{editing ? 'EDITAR ETIQUETA' : 'NOVA ETIQUETA'}</span>
            <h2 id="label-form-title">{editing ? 'Corrigir informações da colheita' : 'Informações da colheita'}</h2>
            <p>{editing ? 'Atualize os dados da colheita. Quem ler o QR Code verá as informações corrigidas.' : 'Informe os dados que serão exibidos para quem ler o QR Code. Os nomes dos responsáveis também ficarão visíveis.'}</p>
          </header>
          {unavailable && <p className="workspace-message" role="status">O cadastro de etiquetas está temporariamente indisponível. Tente novamente mais tarde. Seus registros estão preservados.</p>}
          {formError && <p className="workspace-message is-error" role="alert">{formError}</p>}
          <LabelForm draft={draft} busy={busy} canSave={ready && !loading} onChange={changeDraft} onSave={save}
            editing={Boolean(editing)} onCancel={cancelEdit} />
        </section>
      )}

      <section className="label-section" aria-labelledby="label-history-title">
        <header className="label-section-heading label-history-heading">
          <div>
            <span className="label-eyebrow">REGISTROS ANTERIORES</span>
            <h2 id="label-history-title">Histórico de etiquetas</h2>
            <p>Encontre suas etiquetas para consultar, baixar ou imprimir o QR Code.</p>
          </div>
          <button type="button" className="workspace-button subtle" disabled={busy || loading} onClick={() => setRefresh(value => value + 1)}>
            <RefreshCw size={16} aria-hidden="true" /> Atualizar histórico
          </button>
        </header>
        <LabelHistorySearch value={searchInput} onChange={setSearchInput} onSearch={searchHistory}
          onClear={clearSearch} busy={busy || loading} hasSearch={Boolean(search)} />
        {historyError && <p className="workspace-message is-error" role="alert">{historyError}</p>}
        {unavailable && <p className="workspace-message">Não foi possível carregar as etiquetas. Tente novamente mais tarde.</p>}
        {loading ? <p role="status"><LoaderCircle className="spin" size={18} aria-hidden="true" /> Carregando histórico…</p> : ready && !historyError && (
          <>
            <LabelHistory labels={labels} canEdit={canEdit} onEdit={beginEdit} canDelete={canDelete}
              busy={busy || Boolean(editing)} onDelete={removeLabel} filtered={Boolean(search)} />
            <div className="label-pagination">
              <span role="status">{total} {search ? 'resultado(s) para “' + search + '”' : 'registro(s)'}</span>
              <button type="button" className="workspace-button subtle" disabled={busy || offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Anterior</button>
              <button type="button" className="workspace-button subtle" disabled={busy || offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>Próxima</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
