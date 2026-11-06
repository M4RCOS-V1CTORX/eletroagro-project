import { Sprout } from 'lucide-react';
import '../traceability/document-tokens.css';
import './harvest-origin.css';

export default function PublicOriginHome() {
  return (
    <main className="harvest-origin-preview traceability-document">
      <header className="harvest-origin-header">
        <span className="harvest-origin-brand">
          <Sprout size={23} aria-hidden="true" /> EletroAgro
        </span>
        <span className="harvest-origin-context">ORIGEM DO PRODUTO</span>
      </header>
      <section className="harvest-origin-panel" aria-labelledby="public-origin-title">
        <header className="harvest-origin-panel-heading">
          <h1 id="public-origin-title">Consulte a origem do produto</h1>
          <p>Leia o QR Code da etiqueta com a câmera do seu celular para abrir as informações da colheita.</p>
        </header>
        <p className="harvest-origin-note">Cada etiqueta possui um endereço próprio de consulta.</p>
      </section>
    </main>
  );
}
