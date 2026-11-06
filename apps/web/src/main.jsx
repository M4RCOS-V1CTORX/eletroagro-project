import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { entryRoute } from './entryRoute.js';

const route = entryRoute(new URL(window.location.href), { development: import.meta.env.DEV });
const App = React.lazy(() => import('./App.jsx'));
const HarvestOriginPreview = React.lazy(() => import('./traceability-preview/HarvestOriginPreview.jsx'));
const PublicHarvestPage = React.lazy(() => import('./traceability-public/PublicHarvestPage.jsx'));
const PublicOriginHome = React.lazy(() => import('./traceability-public/PublicOriginHome.jsx'));

function EntryPage() {
  switch (route.page) {
    case 'application':
      return <App />;
    case 'public-record':
      return <PublicHarvestPage publicId={route.publicId} />;
    case 'preview':
      return <HarvestOriginPreview />;
    default:
      return <PublicOriginHome />;
  }
}

if (route.page === 'redirect') {
  window.location.replace(route.destination);
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <React.Suspense fallback={<p role="status">Carregando página…</p>}>
      <EntryPage />
    </React.Suspense>
  </React.StrictMode>,
);

if (route.page === 'application' && 'serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch((error) => console.error('Falha ao ativar modo instalável:', error)));
}
