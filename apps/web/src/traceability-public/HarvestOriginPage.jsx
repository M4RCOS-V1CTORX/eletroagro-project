import { useEffect } from 'react';
import { Sprout } from 'lucide-react';
import HarvestOriginDetails from './HarvestOriginDetails.jsx';
import '../traceability/document-tokens.css';
import './harvest-origin.css';

export default function HarvestOriginPage({ harvest, isPreview = false, loading = false, error = '', notFound = false, onRetry }) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Consulta de origem · EletroAgro';
    return () => { document.title = previousTitle; };
  }, []);

  return (
    <main className="harvest-origin-preview traceability-document">
      <div className="harvest-origin-backdrop" aria-hidden="true" />

      <header className="harvest-origin-header">
        <span className="harvest-origin-brand">
          <Sprout size={23} strokeWidth={1.5} aria-hidden="true" />
          EletroAgro
        </span>
        <span className="harvest-origin-context">ORIGEM DO PRODUTO</span>
      </header>

      <section className="harvest-origin-panel" aria-labelledby="harvest-origin-title">
        <header className="harvest-origin-panel-heading">
          <div className="harvest-origin-document-meta">
            <span className="harvest-origin-document-label">CONSULTA DE ORIGEM</span>
            <span className="harvest-origin-preview-label">{isPreview ? 'Dados demonstrativos' : 'Consulta pública'}</span>
          </div>
          <h1 id="harvest-origin-title">{notFound ? 'Registro não encontrado' : 'Informações da colheita'}</h1>
          <p>Consulte os dados registrados para esta colheita.</p>
        </header>

        <div aria-live="polite" aria-busy={loading}>
          {loading && <p className="harvest-origin-state" role="status">Carregando informações da colheita…</p>}
          {!loading && error && (
            <div className="harvest-origin-state" role="alert">
              <p>{error}</p>
              {!notFound && <button type="button" onClick={onRetry}>Tentar novamente</button>}
            </div>
          )}
          {!loading && !error && harvest && <HarvestOriginDetails harvest={harvest} />}
        </div>

        <p className="harvest-origin-note">
          {isPreview ? 'Prévia de interface. As informações apresentadas são fictícias.' : 'Informações de origem fornecidas pelo responsável pelo registro.'}
        </p>
      </section>

      <footer className="harvest-origin-footer">
        <span>EletroAgro</span>
        <span>Consulta de origem{isPreview ? ' · Prévia visual' : ''}</span>
      </footer>
    </main>
  );
}
