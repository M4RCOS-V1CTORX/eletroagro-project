const configuredApiUrl = import.meta.env.VITE_API_URL?.trim().replace(/\/+$/, '');
const localApiUrl = /^https?:\/\/localhost(?::\d+)?$/i.test(configuredApiUrl || '');

// Vercel must never ship a browser bundle that calls the user's own localhost.
export const apiUrl = import.meta.env.PROD && (!configuredApiUrl || localApiUrl)
  ? 'https://eletroagro-project-ew3q.vercel.app'
  : configuredApiUrl || 'http://localhost:3000';
