import { getAuthAccessToken } from './authClient.js';
import { apiUrl } from './apiUrl.js';

const databaseName = 'eletroagro-offline-safe';
const storeName = 'pending-requests';
const queueablePaths = [/^\/api\/customers/, /^\/api\/catalog/, /^\/api\/suppliers/, /^\/api\/operations\/(finance|appointments|stock)/];

function openQueue() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, action) {
  if (!('indexedDB' in window)) return undefined;
  const database = await openQueue();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
    transaction.oncomplete = () => { const result = request?.result; database.close(); resolve(result); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
  });
}

export async function offlineQueueCount() {
  return Number(await withStore('readonly', (store) => store.count()) || 0);
}

async function announceQueue() {
  window.dispatchEvent(new CustomEvent('eletroagro:offline-queue', { detail: { count: await offlineQueueCount() } }));
}

async function enqueue(path, options) {
  const id = crypto.randomUUID();
  await withStore('readwrite', (store) => store.add({ id, path, method: options.method || 'POST', body: options.body || null, headers: Object.fromEntries(Object.entries(options.headers || {}).filter(([key]) => key.toLowerCase() !== 'authorization')), createdAt: Date.now() }));
  await announceQueue();
  return { queued: true, offline: true, queueId: id, message: 'Operação salva neste aparelho. Ela será enviada quando a conexão voltar.' };
}

async function send(path, options, token) {
  return fetch(`${apiUrl}${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
}

export async function apiRequest(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const token = await getAuthAccessToken();
  let response;
  try {
    response = await send(path, options, token);
  } catch (error) {
    if (!['GET', 'HEAD'].includes(method) && queueablePaths.some((pattern) => pattern.test(path))) return enqueue(path, options);
    throw new Error(navigator.onLine ? 'Não foi possível conectar ao servidor.' : 'Você está sem internet. Reconecte para carregar esta tela.');
  }
  if (response.status === 401) {
    const fresh = await getAuthAccessToken(undefined, { forceRefresh: true }).catch(() => null);
    if (fresh && fresh !== token) response = await send(path, options, fresh);
  }
  const body = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || 'Não foi possível concluir a operação.');
  return body;
}

export async function flushOfflineQueue() {
  if (!navigator.onLine || !('indexedDB' in window)) return { sent: 0, remaining: await offlineQueueCount() };
  const rows = (await withStore('readonly', (store) => store.getAll()) || []).sort((a, b) => a.createdAt - b.createdAt);
  let sent = 0;
  for (const row of rows) {
    try {
      const token = await getAuthAccessToken(undefined, { forceRefresh: true });
      const response = await send(row.path, { method: row.method, body: row.body, headers: { ...row.headers, 'X-Idempotency-Key': row.id } }, token);
      if (response.ok || (response.status >= 400 && response.status < 500 && ![401, 408, 429].includes(response.status))) {
        await withStore('readwrite', (store) => store.delete(row.id));
        sent += 1;
      } else break;
    } catch { break; }
  }
  await announceQueue();
  return { sent, remaining: await offlineQueueCount() };
}
