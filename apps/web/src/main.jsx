import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const isOriginPreview = import.meta.env.DEV && window.location.pathname === '/previa-rastreamento';
const isPublicOrigin = window.location.pathname === '/rastrear' || window.location.pathname.startsWith('/rastrear/');
const publicId = window.location.pathname === '/rastrear' ? '' : window.location.pathname.slice('/rastrear/'.length);
const App = React.lazy(() => import('./App.jsx'));
const HarvestOriginPreview = React.lazy(() => import('./traceability-preview/HarvestOriginPreview.jsx'));
const PublicHarvestPage = React.lazy(() => import('./traceability-public/PublicHarvestPage.jsx'));

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <React.Suspense fallback={<p role="status">Carregando página…</p>}>
      {isPublicOrigin ? <PublicHarvestPage publicId={publicId} />
        : isOriginPreview ? <HarvestOriginPreview /> : <App />}
    </React.Suspense>
  </React.StrictMode>,
);

if (!isPublicOrigin && 'serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch((error) => console.error('Falha ao ativar modo instalável:', error)));
}
