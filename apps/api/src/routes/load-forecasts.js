import { Router } from 'express';
import { idempotencyGuard, requireAreaPermission, requireCompanyMembership } from '../middleware/neon-auth.js';

function handleError(error, res, action) {
  console.error('Falha ao ' + action + ' previsão:', error.message);
  if (error.code === '42P01' && /load_forecasts/i.test(error.message)) return res.status(503).json({ error: { code: 'LOAD_FORECASTS_NOT_INITIALIZED', message: 'A Previsão de Carga ainda não foi instalada no banco de dados. Contate o administrador do sistema.' } });
  return res.status(500).json({ error: { code: 'LOAD_FORECASTS_ERROR', message: 'Não foi possível acessar as previsões.' } });
}

export function createLoadForecastsRouter({ pool, requireAuth, requireDatabase }) {
  const router = Router();
  router.use(requireAuth, requireDatabase(pool), requireCompanyMembership(pool), requireAreaPermission('commercial'), idempotencyGuard(pool));
  router.get('/', async (req, res) => {
    try {
      const result = await pool.query('SELECT id, property, producer, forecast_date, items, created_at FROM public.load_forecasts WHERE company_id = $1 ORDER BY forecast_date DESC, created_at DESC', [req.company.company_id]);
      res.json({ forecasts: result.rows });
    } catch (error) { return handleError(error, res, 'listar'); }
  });
  router.post('/', async (req, res) => {
    const { property, producer, date, items, requireFullPercentage = false } = req.body || {};
    const validDate = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
    const decimal = (value, digits, max) => typeof value === 'string' && new RegExp(`^\\d{1,${digits}}(?:\\.\\d{1,${max}})?$`).test(value);
    if (typeof property !== 'string' || !property.trim() || property.trim().length > 200 || typeof producer !== 'string' || !producer.trim() || producer.trim().length > 200 || !validDate || !Array.isArray(items) || !items.length) return res.status(400).json({ error: { message: 'Confira propriedade, produtor, data e itens.' } });
    if (typeof requireFullPercentage !== 'boolean') return res.status(400).json({ error: { message: 'Selecione uma regra válida para os percentuais.' } });
    for (const item of items) {
      if (!item || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.productId || '') || !['frutas', 'verduras'].includes(item.category) || !decimal(item.quantity, 9, 3) || Number(item.quantity) <= 0 || !decimal(item.unitPrice, 9, 2) || !['first', 'second', 'third'].every(k => decimal(item[k], 3, 2) && Number(item[k]) <= 100)) return res.status(400).json({ error: { message: 'Confira produto, categoria, quantidade, preço e percentuais (0 a 100).' } });
      if (requireFullPercentage) {
        const hundredths = value => { const [whole, fraction = ''] = value.split('.'); return Number(whole) * 100 + Number((fraction + '00').slice(0, 2)); };
        if (['first', 'second', 'third'].reduce((sum, key) => sum + hundredths(item[key]), 0) !== 10000) return res.status(400).json({ error: { message: 'Os percentuais de cada produto devem somar 100%.' } });
      }
    }
    try {
      const ids = [...new Set(items.map(item => item.productId))];
      const products = await pool.query("SELECT id, name, unit FROM public.catalog_items WHERE company_id = $1 AND id = ANY($2::uuid[]) AND item_type = 'product' AND is_active AND archived_at IS NULL", [req.company.company_id, ids]);
      const byId = new Map(products.rows.map(p => [p.id, p]));
      if (ids.some(id => !byId.has(id))) return res.status(400).json({ error: { message: 'Um produto selecionado não está disponível no catálogo.' } });
      const savedItems = items.map(item => ({ ...item, name: byId.get(item.productId).name, unit: byId.get(item.productId).unit }));
      const result = await pool.query('INSERT INTO public.load_forecasts (company_id, property, producer, forecast_date, items) VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING *', [req.company.company_id, property.trim(), producer.trim(), date, JSON.stringify(savedItems)]);
      res.status(201).json({ forecast: result.rows[0] });
    } catch (error) { return handleError(error, res, 'salvar'); }
  });
  return router;
}
