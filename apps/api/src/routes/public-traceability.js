import { Router } from 'express';

export function createPublicTraceabilityRouter({ pool, requireDatabase }) {
  const router = Router();

  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    response.set('X-Robots-Tag', 'noindex, nofollow');
    next();
  });

  router.get('/:publicId', (request, response, next) => {
    if (!/^[a-f0-9]{64}$/.test(request.params.publicId)) {
      return response.status(404).json({ error: { code: 'ORIGIN_NOT_FOUND', message: 'Registro de origem não encontrado.' } });
    }
    next();
  }, requireDatabase(pool), async (request, response) => {
    try {
      const params = [request.params.publicId];
      const label = await pool.query(`
        SELECT l.product_name,l.property_name,l.producer_names,l.harvest_date::text AS harvest_date,l.phone,l.email
        FROM public.traceability_labels l
        JOIN public.companies c ON c.id=l.company_id AND c.archived_at IS NULL
        WHERE l.public_id=$1 LIMIT 1`, params);
      let record = label.rows[0];

      if (!record) {
        const harvest = await pool.query(`
          SELECT h.product_name,h.property_name,h.harvest_date::text AS harvest_date,
            COALESCE((SELECT jsonb_agg(p.producer_name ORDER BY p.producer_name,p.producer_id)
              FROM public.traceability_harvest_producers p
              WHERE p.company_id=h.company_id AND p.harvest_id=h.id),'[]'::jsonb) AS producer_names
          FROM public.traceability_harvests h
          JOIN public.companies c ON c.id=h.company_id AND c.archived_at IS NULL
          WHERE h.public_id=$1 LIMIT 1`, params);
        record = harvest.rows[0];
      }

      if (!record) {
        return response.status(404).json({ error: { code: 'ORIGIN_NOT_FOUND', message: 'Registro de origem não encontrado.' } });
      }

      // Explicit public contract: never return internal records or use SELECT * here.
      return response.json({ harvest: {
        product: record.product_name,
        property: record.property_name,
        producers: record.producer_names,
        harvestDate: record.harvest_date,
        phone: record.phone || '',
        email: record.email || '',
      } });
    } catch (error) {
      console.error('Falha na consulta pública de origem:', error.code || 'UNKNOWN');
      return response.status(503).json({ error: { code: 'ORIGIN_UNAVAILABLE', message: 'Não foi possível consultar a origem agora. Tente novamente em instantes.' } });
    }
  });

  return router;
}
