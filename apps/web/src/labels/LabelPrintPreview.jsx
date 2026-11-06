import { useEffect, useRef, useState } from 'react';

export default function LabelPrintPreview({ request, onClose }) {
  const frameRef = useRef(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let releaseDocument;
    const preview = frameRef.current.contentWindow;
    setError('');

    async function prepare() {
      try {
        const { prepareLabelPrint } = await import('./printLabel.js');
        if (!active) return;
        const release = await prepareLabelPrint(preview, request);
        if (active) {
          releaseDocument = release;
        } else {
          release();
        }
      } catch (error) {
        if (active) setError(error.message || 'Não foi possível preparar a impressão.');
      }
    }

    prepare();
    return () => {
      active = false;
      releaseDocument?.();
    };
  }, [request]);

  return (
    <section className="label-print-preview" aria-label="Prévia de impressão">
      <button type="button" className="workspace-button subtle" onClick={onClose}>
        Fechar prévia
      </button>
      {error && <p className="workspace-message is-error" role="alert">{error}</p>}
      <iframe ref={frameRef} title="Prévia de impressão das etiquetas" />
    </section>
  );
}
