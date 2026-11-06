import { useState } from 'react';
import { ArrowUpRight, Download, Printer, QrCode } from 'lucide-react';
import { isLocalOrigin, publicOriginUrl } from './publicOrigin.js';
import LabelPrintPreview from './LabelPrintPreview.jsx';

export default function LabelCodeActions({ label }) {
  const [image, setImage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [printing, setPrinting] = useState(false);
  const [quantity, setQuantity] = useState(2);
  const [printRequest, setPrintRequest] = useState(null);
  let publicUrl;
  let configurationError;
  try { publicUrl = publicOriginUrl(label.public_id); }
  catch (error) { configurationError = error.message; }

  async function generate() {
    setBusy(true);
    setError('');
    try {
      const { createLabelQrPng } = await import('./generateLabelQr.js');
      setImage(createLabelQrPng(publicUrl));
    } catch (error) {
      setError(error.message);
    } finally { setBusy(false); }
  }

  async function download() {
    setBusy(true);
    setError('');
    try {
      const { createLabelQrPng, downloadLabelQr } = await import('./generateLabelQr.js');
      const dataUrl = image || createLabelQrPng(publicUrl);
      setImage(dataUrl);
      downloadLabelQr(dataUrl, label.public_id);
    } catch (error) {
      setError(error.message);
    } finally { setBusy(false); }
  }

  function previewPrint(event) {
    event.preventDefault();
    setError('');
    setPrintRequest(previous => ({
      label,
      publicUrl,
      quantity: Number(quantity),
      revision: (previous?.revision || 0) + 1,
    }));
  }

  return (
    <div className="label-code-actions">
      {publicUrl ? (
        <>
          <div className="label-code-buttons">
            <a className="workspace-button subtle" href={publicUrl} target="_blank" rel="noopener noreferrer">
              Visualizar <ArrowUpRight size={14} aria-hidden="true" />
            </a>
            <button type="button" className="workspace-button primary" disabled={busy} onClick={generate}>
              <QrCode size={15} aria-hidden="true" /> {busy ? 'Preparando…' : 'Gerar QR Code'}
            </button>
            <button type="button" className="workspace-button subtle" disabled={busy} onClick={download}>
              <Download size={15} aria-hidden="true" /> Baixar QR Code
            </button>
            <button type="button" className="workspace-button subtle" disabled={busy} aria-expanded={printing} onClick={() => setPrinting(value => !value)}>
              <Printer size={15} aria-hidden="true" /> Imprimir
            </button>
          </div>
          {printing && (
            <form className="label-print-settings" onSubmit={previewPrint}>
              <label>Quantidade de etiquetas
                <input type="number" min="1" max="100" step="1" required value={quantity} disabled={busy}
                  onChange={event => setQuantity(event.target.value)} />
              </label>
              <p className="label-code-note">Etiquetas de 50 × 50 mm, em duas colunas, com 2 mm de espaço entre elas. O PDF já inclui o tamanho da página e as margens internas.</p>
              <button type="submit" className="workspace-button primary" disabled={busy}>Abrir prévia de impressão</button>
            </form>
          )}
          {image && (
            <figure className="label-code-image">
              <img src={image} alt={`QR Code de origem de ${label.product_name}`} width="224" height="224" />
              <figcaption>Leia o código para consultar as informações da colheita.</figcaption>
            </figure>
          )}
          {printRequest && (
            <LabelPrintPreview key={printRequest.revision} request={printRequest} onClose={() => setPrintRequest(null)} />
          )}
          {isLocalOrigin(publicUrl) && <p className="label-code-note">Este QR Code abre apenas neste computador. Use o endereço público do sistema antes de distribuir ou imprimir etiquetas.</p>}
        </>
      ) : <p className="label-code-note" role="status">{configurationError}</p>}
      {error && <p className="workspace-message is-error" role="alert">{error}</p>}
    </div>
  );
}
