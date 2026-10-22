import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pg from 'pg';
import { requireNeonAuth, requireDatabase } from './middleware/neon-auth.js';
import { createCompaniesRouter } from './routes/companies.js';
import { createCustomersRouter } from './routes/customers.js';
import { createCatalogRouter } from './routes/catalog.js';
import { createQuotesRouter } from './routes/quotes.js';
import { createSuppliersRouter } from './routes/suppliers.js';
import { createSalesRouter } from './routes/sales.js';
import { createOperationsRouter } from './routes/operations.js';

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 3000);
const allowedOrigin = process.env.WEB_ORIGIN || 'http://localhost:5173';
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })
  : null;

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    const isVercelDeployment = typeof origin === 'string' && /^https:\/\/[a-z0-9-]+(?:-[a-z0-9-]+)*\.vercel\.app$/i.test(origin);
    callback(null, !origin || origin === allowedOrigin || origin === 'http://localhost:5173' || isVercelDeployment);
  },
}));
app.use(express.json({ limit: '100kb' }));

app.get('/api/health', (_request, response) => {
  response.json({
    status: 'ok',
    service: 'eletroagro-api',
    database: pool ? 'configured' : 'not_configured',
  });
});

app.get('/api/health/database', async (_request, response) => {
  if (!pool) {
    return response.status(503).json({ status: 'unavailable', message: 'DATABASE_URL não configurada.' });
  }

  try {
    await pool.query('SELECT 1');
    return response.json({ status: 'ok' });
  } catch (error) {
    console.error('Falha ao verificar PostgreSQL:', error.message);
    return response.status(503).json({ status: 'unavailable', message: 'Não foi possível conectar ao banco.' });
  }
});

app.get('/api/session', requireNeonAuth, (request, response) => {
  response.json({ user: request.auth });
});

app.use('/api/company', createCompaniesRouter({ pool, requireAuth: requireNeonAuth }));
app.use('/api/customers', createCustomersRouter({
  pool,
  requireAuth: requireNeonAuth,
  requireDatabase,
}));
app.use('/api/catalog', createCatalogRouter({
  pool,
  requireAuth: requireNeonAuth,
  requireDatabase,
}));
app.use('/api/quotes', createQuotesRouter({
  pool,
  requireAuth: requireNeonAuth,
  requireDatabase,
}));
app.use('/api/suppliers', createSuppliersRouter({ pool, requireAuth: requireNeonAuth, requireDatabase }));
app.use('/api/sales', createSalesRouter({ pool, requireAuth: requireNeonAuth, requireDatabase }));
app.use('/api/operations', createOperationsRouter({ pool, requireAuth: requireNeonAuth, requireDatabase }));

app.use((_request, response) => {
  response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Rota não encontrada.' } });
});

app.use((error, _request, response, _next) => {
  console.error('Erro não tratado na API:', error.message);
  response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno do servidor.' } });
});

const server = app.listen(port, () => {
  console.log(`API EletroAgro disponível em http://localhost:${port}`);
});

async function shutdown(signal) {
  console.log(`${signal} recebido; encerrando API...`);
  server.close(async () => {
    await pool?.end();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
