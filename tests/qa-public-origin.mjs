// Isolated UI + API + disposable database. Never uses a production connection.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createTraceabilityRouter } from '../apps/api/src/routes/traceability.js';
import { createPublicTraceabilityRouter } from '../apps/api/src/routes/public-traceability.js';
import { createRequestPool } from '../apps/api/src/lib/request-pool.js';
import { requireDatabase } from '../apps/api/src/middleware/neon-auth.js';

const require = createRequire(import.meta.url);
const apiRequire = createRequire(new URL('../apps/api/package.json', import.meta.url));
const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url));
const express = apiRequire('express');
const { createServer } = await import(pathToFileURL(webRequire.resolve('vite')));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH
  || 'C:/Users/USER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const db = new PGlite();
let server;
let vite;
let browser;

try {
  for (const name of (await readdir(new URL('../apps/api/src/db/migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(`../apps/api/src/db/migrations/${name}`, import.meta.url), 'utf8'));
  }
  const company = (await db.query("INSERT INTO companies(name) VALUES('Empresa QA isolada') RETURNING id")).rows[0].id;
  await db.query("INSERT INTO company_memberships(company_id,auth_issuer,auth_subject,role) VALUES($1,'qa','owner','owner')", [company]);
  const query = async (...args) => {
    const result = await db.query(...args);
    return { ...result, rowCount: result.rows.length || result.affectedRows || 0 };
  };
  const pool = createRequestPool({ query, connect: async () => ({ query, release() {} }) });
  const app = express();
  app.use(express.json());
  app.use('/api/public/traceability', createPublicTraceabilityRouter({ pool, requireDatabase }));
  app.use('/api/traceability', createTraceabilityRouter({
    pool, requireDatabase,
    requireAuth: (request, _response, next) => { request.auth = { issuer: 'qa', subject: 'owner' }; next(); },
  }));
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  vite = await createServer({
    root: fileURLToPath(new URL('../apps/web/', import.meta.url)),
    configFile: fileURLToPath(new URL('../apps/web/vite.config.js', import.meta.url)),
    server: { middlewareMode: true },
    optimizeDeps: { include: ['qrcode-generator'] },
    define: { 'import.meta.env.VITE_API_URL': JSON.stringify(base), 'import.meta.env.VITE_PUBLIC_SITE_URL': JSON.stringify(base) },
    plugins: [{
      name: 'public-origin-isolated-fixture', enforce: 'pre',
      resolveId(source, importer) {
        if (source === './App.jsx' && importer?.endsWith('/src/main.jsx')) return '\0qa-private-app';
      },
      load(id) {
        if (id === '\0qa-private-app') return `
          import React from 'react';
          import QRCodePage from '/src/QRCodePage.jsx';
          export default function App() {
            return React.createElement('div', {style:{maxWidth:1100,margin:'auto',padding:20}},
              React.createElement(QRCodePage, {company:{role:'owner'}}));
          }
        `;
      },
      transform(code, id) {
        if (id.endsWith('/src/apiClient.js')) return `
          export async function apiRequest(path, options={}) {
            const response=await fetch(path,{...options,headers:{'Content-Type':'application/json',...options.headers}});
            const body=await response.json();
            if(!response.ok)throw new Error(body.error?.message||'Falha na API isolada');
            return body;
          }
        `;
      },
    }],
  });
  app.use(vite.middlewares);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const externalRequests = [];
  await context.route('**/*', route => {
    if (route.request().url().startsWith(base)) return route.continue();
    externalRequests.push(route.request().url());
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.getByRole('button', { name: 'Salvar etiqueta', exact: true }).waitFor().catch(async error => {
    console.error({ errors, body: await page.locator('body').innerText() });
    throw error;
  });
  await page.getByLabel('Produto', { exact: true }).fill('Manga QA');
  await page.getByLabel('Propriedade', { exact: true }).fill('Sítio QA');
  await page.getByLabel('Responsáveis pela colheita', { exact: true }).fill('Ana QA\nBruno QA');
  await page.getByLabel('Data da colheita', { exact: true }).fill('2026-11-05');
  await page.getByLabel('Telefone', { exact: true }).fill('(77) 99999-1234');
  await page.getByLabel('E-mail', { exact: true }).fill('contato@fazenda.com.br');
  await page.getByRole('button', { name: 'Salvar etiqueta', exact: true }).click();
  const record = page.getByRole('article', { name: 'Etiqueta de Manga QA', exact: true });
  await record.waitFor();
  const searchInput = page.getByRole('searchbox', { name: 'Buscar no histórico' });
  await searchInput.fill('bruno');
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '1 resultado(s)' }).waitFor();
  await record.waitFor();
  await searchInput.fill('nao-existe');
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await page.getByText('Nenhuma etiqueta encontrada', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Limpar busca', exact: true }).click();
  await record.waitFor();
  const publicUrl = await record.getByRole('link', { name: 'Visualizar', exact: true }).getAttribute('href');
  assert.match(publicUrl, new RegExp(`^${base}/rastrear/[a-f0-9]{64}$`));
  await record.getByRole('button', { name: 'Editar etiqueta de Manga QA' }).click();
  assert.equal(await page.getByLabel('Produto', { exact: true }).inputValue(), 'Manga QA');
  await page.getByLabel('Produto', { exact: true }).fill('Descartar alteração');
  await page.getByRole('button', { name: 'Cancelar edição', exact: true }).click();
  await record.getByRole('button', { name: 'Editar etiqueta de Manga QA' }).click();
  assert.equal(await page.getByLabel('Produto', { exact: true }).inputValue(), 'Manga QA');
  assert.equal(await page.getByLabel('Telefone', { exact: true }).inputValue(), '(77) 99999-1234');
  assert.equal(await page.getByLabel('E-mail', { exact: true }).inputValue(), 'contato@fazenda.com.br');
  await page.getByLabel('Telefone', { exact: true }).fill('+55 77 98888-4321');
  await page.getByLabel('E-mail', { exact: true }).fill('novo@fazenda.com.br');
  await page.getByLabel('Propriedade', { exact: true }).fill('Sítio corrigido QA');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await record.getByText('Sítio corrigido QA', { exact: true }).waitFor();
  assert.equal(await record.getByRole('link', { name: 'Visualizar', exact: true }).getAttribute('href'), publicUrl);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (process.env.QA_SCREENSHOT_DIR) {
      await mkdir(process.env.QA_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: join(process.env.QA_SCREENSHOT_DIR, `qrcode-${width}.png`), fullPage: true });
    }
  }
  assert.equal(await page.getByText('Os nomes dos responsáveis, o telefone e o e-mail informados ficarão públicos.', { exact: false }).count(), 1);

  await record.getByRole('button', { name: 'Gerar QR Code', exact: true }).click();
  await record.getByRole('img', { name: 'QR Code de origem de Manga QA' }).waitFor();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    record.getByRole('button', { name: 'Baixar QR Code', exact: true }).click(),
  ]);
  assert.match(download.suggestedFilename(), /^origem-[a-f0-9]{12}\.png$/);
  const downloadedPath = await download.path();
  const png = await readFile(downloadedPath);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  await record.getByRole('button', { name: 'Imprimir', exact: true }).click();
  await record.getByLabel('Quantidade de etiquetas').fill('3');
  await page.evaluate(() => { window.open = () => null; });
  await record.getByRole('button', { name: 'Abrir prévia de impressão', exact: true }).click();
  const previewElement = await record.getByTitle('Prévia de impressão das etiquetas').elementHandle();
  const printPreview = await previewElement.contentFrame();
  await printPreview.getByRole('button', { name: 'Imprimir etiquetas', exact: true }).waitFor();
  await printPreview.getByRole('heading', { name: 'Impressão de etiquetas', exact: true }).waitFor();
  await printPreview.waitForFunction(() => !document.querySelector('button').disabled);
  await printPreview.getByTitle('PDF das etiquetas').waitFor();
  const [pdfDownload] = await Promise.all([
    page.waitForEvent('download'),
    printPreview.getByRole('link', { name: 'Baixar PDF', exact: true }).click(),
  ]);
  assert.match(pdfDownload.suggestedFilename(), /^etiquetas-[a-f0-9]{12}\.pdf$/);
  const pdfBytes = await readFile(await pdfDownload.path());
  assert.equal(pdfBytes.subarray(0, 5).toString(), '%PDF-');
  if (process.env.QA_PRINT_PDF_PATH) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(process.env.QA_PRINT_PDF_PATH, pdfBytes);
  }
  await printPreview.evaluate(() => {
    const frame = document.querySelector('iframe');
    frame.contentWindow.print = () => { window.printRequested = true; };
  });
  await printPreview.getByRole('button', { name: 'Imprimir etiquetas', exact: true }).click();
  assert.equal(await printPreview.evaluate(() => window.printRequested), true);
  await record.getByRole('button', { name: 'Fechar prévia', exact: true }).click();
  if (process.env.QR_DECODER_PATH) {
    const decode = require(process.env.QR_DECODER_PATH);
    const sharp = require(process.env.SHARP_MODULE_PATH
      || 'C:/Users/USER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const result = decode(new Uint8ClampedArray(data), info.width, info.height);
    assert.equal(result?.data, publicUrl);
    console.log('PASS: leitor independente decodificou o PNG com o endereço público exato.');
  }

  const publicPage = await context.newPage();
  publicPage.on('pageerror', error => errors.push(error.message));
  const publicRequestHeaders = [];
  publicPage.on('request', request => {
    if (request.url().includes('/api/public/traceability/')) publicRequestHeaders.push(request.headers());
  });
  await context.addCookies([{ name: 'private-session-test', value: 'not-for-public-api', url: base }]);
  await publicPage.goto(publicUrl);
  await publicPage.getByText('Manga QA', { exact: true }).waitFor();
  await publicPage.getByText('Sítio corrigido QA', { exact: true }).waitFor();
  await publicPage.getByText('Ana QA e Bruno QA', { exact: true }).waitFor();
  await publicPage.getByText('+55 77 98888-4321', { exact: true }).waitFor();
  await publicPage.getByText('novo@fazenda.com.br', { exact: true }).waitFor();
  assert.equal(await publicPage.locator('dd').count(), 6);
  assert(publicRequestHeaders.every(headers => !headers.authorization && !headers.cookie));
  for (const width of [1440, 390]) {
    await publicPage.setViewportSize({ width, height: 1000 });
    assert.equal(await publicPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }

  await publicPage.goto(`${base}/rastrear/${'f'.repeat(64)}`);
  await publicPage.getByRole('heading', { name: 'Registro não encontrado', exact: true }).waitFor();
  assert.equal(await publicPage.locator('dd').count(), 0);
  const offlineRoute = route => route.abort('internetdisconnected');
  await publicPage.route('**/api/public/traceability/*', offlineRoute);
  await publicPage.goto(publicUrl);
  await publicPage.getByRole('button', { name: 'Tentar novamente', exact: true }).waitFor();
  await publicPage.unroute('**/api/public/traceability/*', offlineRoute);
  await publicPage.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await publicPage.getByText('Manga QA', { exact: true }).waitFor();
  page.once('dialog', dialog => dialog.dismiss());
  await record.getByRole('button', { name: 'Excluir etiqueta de Manga QA' }).click();
  await record.waitFor();
  page.once('dialog', dialog => dialog.accept());
  await record.getByRole('button', { name: 'Excluir etiqueta de Manga QA' }).click();
  await record.waitFor({ state: 'detached' });
  await page.getByText('Nenhuma etiqueta salva', { exact: true }).waitFor();
  await publicPage.reload();
  await publicPage.getByRole('heading', { name: 'Registro não encontrado', exact: true }).waitFor();
  assert.equal((await db.query('SELECT count(*)::int AS total FROM traceability_labels')).rows[0].total, 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, []);
  console.log('PASS: formulário → banco isolado → QR Code → consulta pública sem login; edição de contatos, download PNG, impressão, seis campos, código inexistente, falha de rede/retentativa, mobile e exclusão com confirmação/revogação do link.');
} finally {
  await browser?.close();
  await vite?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await db.close();
}
