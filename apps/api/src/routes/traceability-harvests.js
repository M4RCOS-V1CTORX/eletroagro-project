import { randomBytes } from 'node:crypto';
import { Router } from 'express';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01') return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function fail(error, res) {
  if (error.code === '42P01') return res.status(503).json({ error: { code: 'TRACEABILITY_NOT_READY', message: 'O cadastro de colheitas ainda não foi habilitado neste ambiente.' } });
  console.error('Falha no cadastro de colheita:', error.code || 'UNKNOWN');
  return res.status(500).json({ error: { message: 'Não foi possível concluir a operação da colheita.' } });
}

// Mounted after the traceability router's authentication, permissions and idempotency.
export function createHarvestsRouter({ pool }) {
  const router = Router();
  router.get('/harvest-products', async (req, res) => {
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    try {
      const items = await pool.query("SELECT id,name FROM public.catalog_items WHERE company_id=$1 AND item_type='product' AND is_active AND archived_at IS NULL ORDER BY lower(name),id LIMIT 100 OFFSET $2", [req.company.company_id, offset]);
      const count = await pool.query("SELECT count(*)::int AS total FROM public.catalog_items WHERE company_id=$1 AND item_type='product' AND is_active AND archived_at IS NULL", [req.company.company_id]);
      return res.json({ products: items.rows, pagination: { total: count.rows[0].total } });
    } catch (error) { return fail(error, res); }
  });
  router.get('/harvests', async (req, res) => {
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    try {
      const result = await pool.query(`SELECT h.*, COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.producer_id,'name',p.producer_name) ORDER BY p.producer_name,p.producer_id) FROM public.traceability_harvest_producers p WHERE p.company_id=h.company_id AND p.harvest_id=h.id),'[]'::jsonb) AS producers
        FROM public.traceability_harvests h WHERE h.company_id=$1 ORDER BY h.harvest_date DESC,h.created_at DESC,h.id LIMIT 25 OFFSET $2`, [req.company.company_id, offset]);
      const count = await pool.query('SELECT count(*)::int AS total FROM public.traceability_harvests WHERE company_id=$1', [req.company.company_id]);
      return res.json({ harvests: result.rows, pagination: { total: count.rows[0].total } });
    } catch (error) { return fail(error, res); }
  });
  router.post('/harvests', async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || !uuid.test(body.productId || '') || !uuid.test(body.propertyId || '') || !validDate(body.harvestDate)
      || !Array.isArray(body.producerIds) || !body.producerIds.length || body.producerIds.length > 100 || body.producerIds.some(id => typeof id !== 'string' || !uuid.test(id))) {
      return res.status(400).json({ error: { message: 'Selecione produto, propriedade, responsáveis e uma data da colheita válida.' } });
    }
    const companyId = req.company.company_id;
    const producerIds = [...new Set(body.producerIds.map(id => id.toLowerCase()))];
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const property = await client.query('SELECT id,name FROM public.traceability_properties WHERE company_id=$1 AND id=$2 FOR SHARE', [companyId, body.propertyId]);
      const product = await client.query("SELECT id,name FROM public.catalog_items WHERE company_id=$1 AND id=$2 AND item_type='product' AND is_active AND archived_at IS NULL FOR SHARE", [companyId, body.productId]);
      const producers = await client.query(`SELECT p.id,p.name FROM public.traceability_producers p JOIN public.traceability_property_producers link ON link.company_id=p.company_id AND link.producer_id=p.id
        WHERE p.company_id=$1 AND link.property_id=$2 AND p.id=ANY($3::uuid[]) ORDER BY p.id FOR SHARE OF p,link`, [companyId, body.propertyId, producerIds]);
      if (!property.rows.length || !product.rows.length || producers.rows.length !== producerIds.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: { message: 'Confira o produto ativo, a propriedade e os responsáveis vinculados a ela nesta empresa.' } });
      }
      const result = await client.query(`INSERT INTO public.traceability_harvests(company_id,product_id,product_name,property_id,property_name,harvest_date,public_id)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [companyId, product.rows[0].id, product.rows[0].name, property.rows[0].id, property.rows[0].name, body.harvestDate, randomBytes(32).toString('hex')]);
      const harvest = result.rows[0];
      for (const producer of producers.rows) await client.query('INSERT INTO public.traceability_harvest_producers(company_id,harvest_id,producer_id,producer_name) VALUES($1,$2,$3,$4)', [companyId, harvest.id, producer.id, producer.name]);
      await client.query("INSERT INTO public.audit_logs(company_id,actor_subject,action,entity_type,entity_id,summary) VALUES($1,$2,'created','traceability_harvest',$3,$4::jsonb)", [companyId, req.auth.subject, harvest.id, JSON.stringify({ name: harvest.product_name, harvestDate: body.harvestDate })]);
      await client.query('COMMIT');
      return res.status(201).json({ harvest: { ...harvest, producers: producers.rows } });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return fail(error, res);
    } finally { client?.release(); }
  });
  return router;
}
