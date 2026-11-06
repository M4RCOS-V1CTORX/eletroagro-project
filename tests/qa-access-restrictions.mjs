// Browser verification with fictitious authentication; never uses a real account.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url));
const apiRequire = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { createServer } = await import(pathToFileURL(webRequire.resolve('vite')));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH
  || 'C:/Users/USER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const express = apiRequire('express');

let server;
let vite;
let browser;
try {
  const app = express();
  app.get('/api/health', (_request, response) => response.json({ database: 'configured' }));
  app.get('/api/session', (_request, response) => response.json({ user: {
    issuer: 'test', subject: 'authorized', email: 'authorized@example.com', name: 'Pessoa autorizada',
  } }));
  app.get('/api/company/me', (_request, response) => response.json({ company: null, canCreateCompany: false }));
  app.get('/api/public/traceability/:id', (_request, response) => response.json({ harvest: {
    product: 'Produto de teste', property: 'Propriedade de teste', producers: ['Responsável'],
    harvestDate: '2026-11-06', phone: '(77) 99999-1234', email: 'contato@example.com',
  } }));
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  vite = await createServer({
    root: fileURLToPath(new URL('../apps/web/', import.meta.url)),
    configFile: fileURLToPath(new URL('../apps/web/vite.config.js', import.meta.url)),
    server: { middlewareMode: true, hmr: false },
    define: { 'import.meta.env.VITE_API_URL': JSON.stringify(base) },
    plugins: [{
      name: 'fictitious-auth-for-access-tests',
      enforce: 'pre',
      transform(_code, id) {
        if (!id.endsWith('/src/authClient.js')) return;
        return `
          let signedIn = false;
          export const authClient = {
            getSession: async () => ({ data: signedIn
              ? {session:{token:'fictitious'},user:{email:'authorized@example.com'}}
              : {session:null,user:null} }),
            signIn: {email: async () => { signedIn=true; return {}; }},
            signOut: async () => { signedIn=false; return {}; },
            requestPasswordReset: async (input) => {globalThis.__recovery=input;return {};},
          };
          export async function getAuthAccessToken() { return 'fictitious'; }
        `;
      },
    }],
  });
  app.use(vite.middlewares);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext();
  await context.route('**/*', route => {
    if (route.request().url().startsWith(base)) return route.continue();
    return route.abort();
  });
  const page = await context.newPage();
  const requests = [];
  const errors = [];
  page.on('request', request => requests.push(request.url()));
  page.on('pageerror', error => errors.push(error.message));

  await page.goto(base);
  await page.getByRole('heading', { name: 'Consulte a origem do produto' }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'E-mail', exact: true }).count(), 0);
  assert.equal(requests.some(url => url.includes('/src/App.jsx') || url.includes('/src/authClient.js')), false);
  assert.equal(requests.some(url => url.includes('/neon-auth') || url.includes('/api/company')), false);
  await page.goto(`${base}/rastrear/${'a'.repeat(64)}`);
  await page.getByText('Produto de teste', { exact: true }).waitFor();
  assert.equal(await page.locator('dd').count(), 6);
  await page.goto(`${base}/rastrear`);
  await page.getByRole('heading', { name: 'Registro não encontrado' }).waitFor();
  assert.equal(await page.getByRole('button', { name: /Criar conta/ }).count(), 0);

  await page.goto(`${base}/app`);
  await page.getByRole('heading', { name: 'Bem-vindo de volta' }).waitFor();
  assert.equal(await page.getByRole('button', { name: /Criar.*conta/ }).count(), 0);
  await page.getByRole('button', { name: 'Esqueci minha senha' }).click();
  await page.getByLabel('E-mail', { exact: true }).fill('authorized@example.com');
  await page.getByRole('button', { name: 'Enviar recuperação' }).click();
  await page.waitForFunction(() => Boolean(globalThis.__recovery));
  assert.equal(await page.evaluate(() => new URL(globalThis.__recovery.redirectTo).pathname), '/app');
  await page.getByRole('button', { name: 'Voltar para entrar' }).click();
  await page.getByLabel('E-mail', { exact: true }).fill('authorized@example.com');
  await page.getByLabel('Senha', { exact: true }).fill('fictitious-password');
  await page.getByRole('button', { name: 'Entrar na minha conta' }).click();
  await page.getByRole('heading', { name: 'Entre com seu convite' }).waitFor();
  assert.equal(await page.getByRole('button', { name: /Criar.*espaço/ }).count(), 0);
  await page.getByRole('textbox', { name: 'Código de convite' }).waitFor();
  assert.deepEqual(errors, []);
  await page.goto(`${base}/?invite=${'a'.repeat(40)}`);
  await page.waitForURL('**/app?invite=*');
  await page.getByRole('heading', { name: 'Bem-vindo de volta' }).waitFor();
  console.log('PASS: public root and QR contain no login; restricted app login, recovery and old invitation redirect remain usable.');
} finally {
  await browser?.close();
  await vite?.close();
  if (server) await new Promise(resolve => server.close(resolve));
}
