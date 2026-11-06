import { ArrowUpRight, Eye } from 'lucide-react';
import { canAction } from '../../../shared/access-policy.js';
import LabelsWorkspace from './labels/LabelsWorkspace.jsx';
import './traceability/document-tokens.css';
import './traceability/preview-link.css';
import './labels/labels-workspace.css';

export default function QRCodePage({ company }) {
  const canCreate = canAction(company, 'traceability', 'create');

  return (
    <section className="workspace-page qrcode-registrations traceability-document">
      <header className="workspace-heading workspace-heading-green">
        <div>
          <span className="workspace-eyebrow">ORIGEM DO PRODUTO</span>
          <h1>QR Code</h1>
          <p>Crie etiquetas com QR Code para compartilhar a origem dos seus produtos.</p>
        </div>
        {import.meta.env.DEV && (
          <a className="qrcode-preview-link" href="/previa-rastreamento" target="_blank" rel="noopener noreferrer">
            <Eye size={16} aria-hidden="true" /> Visualizar prévia <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        )}
      </header>
      <LabelsWorkspace canCreate={canCreate} canEdit={canAction(company, 'traceability', 'edit')} canDelete={canAction(company, 'traceability', 'delete')} />
    </section>
  );
}
