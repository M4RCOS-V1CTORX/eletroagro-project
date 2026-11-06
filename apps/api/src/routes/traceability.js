import { Router } from 'express';
import { createHarvestsRouter } from './traceability-harvests.js';
import { createLabelsRouter } from './traceability-labels.js';
import { idempotencyGuard, requireAreaPermission, requireCompanyMembership } from '../middleware/neon-auth.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseRegistration(body, property, editing) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Envie um cadastro válido.' };
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length < 2 || name.length > 200) return { error: 'Informe um nome entre 2 e 200 caracteres.' };
  if (editing && (!Number.isSafeInteger(body.revision) || body.revision < 1)) return { error: 'Reabra o cadastro antes de editar.' };
  if (property && (!Array.isArray(body.producerIds) || !body.producerIds.length || body.producerIds.length > 100 || body.producerIds.some(id => typeof id !== 'string' || !uuid.test(id)))) {
    return { error: 'Selecione entre 1 e 100 produtores vinculados à propriedade.' };
  }
  return { name, producerIds: property ? [...new Set(body.producerIds.map(id => id.toLowerCase()))] : [] };
}

function fail(error, res) {
  if (error.code === '42P01') return res.status(503).json({ error: { code: 'TRACEABILITY_NOT_READY', message: 'Os cadastros de rastreamento ainda não foram habilitados neste ambiente.' } });
  console.error('Falha no cadastro de rastreamento:', error.code || 'UNKNOWN');
  return res.status(500).json({ error: { code: 'TRACEABILITY_FAILED', message: 'Não foi possível concluir o cadastro de rastreamento.' } });
}

export function createTraceabilityRouter({ pool, requireAuth, requireDatabase }) {
  const router = Router();
  router.use(requireAuth, requireDatabase(pool), requireCompanyMembership(pool), requireAreaPermission('operations'), idempotencyGuard(pool));

  for (const resource of ['producers', 'properties']) {
    const property = resource === 'properties';
    // Resource names come exclusively from the constant list above, never user input.
    const table = `public.traceability_${resource}`;
    router.get(`/${resource}`, async (req, res) => {
      const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 25, 1), 100);
      const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
      const query = String(req.query.q || '').trim().slice(0, 200);
      const params = [req.company.company_id, query];
      try {
        const where = `WHERE r.company_id=$1 AND ($2='' OR r.name ILIKE '%'||$2||'%')`;
        const result = await pool.query(`SELECT r.* ${property ? ", ARRAY(SELECT p.producer_id FROM public.traceability_property_producers p WHERE p.company_id=r.company_id AND p.property_id=r.id ORDER BY p.producer_id) AS producer_ids" : ''} FROM ${table} r ${where} ORDER BY lower(r.name),r.id LIMIT $3 OFFSET $4`, [...params, limit, offset]);
        const count = await pool.query(`SELECT COUNT(*)::int AS total FROM ${table} r ${where}`, params);
        return res.json({ [resource]: result.rows, pagination: { limit, offset, total: count.rows[0].total } });
      } catch (error) { return fail(error, res); }
    });

    async function save(req, res) {
      const editing = req.method === 'PATCH';
      if (editing && !uuid.test(req.params.id)) return res.status(400).json({ error: { message: 'Identificador de cadastro inválido.' } });
      const parsed = parseRegistration(req.body, property, editing);
      if (parsed.error) return res.status(400).json({ error: { message: parsed.error } });
      const companyId = req.company.company_id;
      let client;
      try {
        client = await pool.connect();
        await client.query('BEGIN');
        if (property) {
          const producers = await client.query('SELECT id FROM public.traceability_producers WHERE company_id=$1 AND id=ANY($2::uuid[]) FOR KEY SHARE', [companyId, parsed.producerIds]);
          if (producers.rows.length !== parsed.producerIds.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: { message: 'Selecione somente produtores cadastrados nesta empresa.' } });
          }
        }
        const result = editing
          ? await client.query(`UPDATE ${table} SET name=$3,revision=revision+1,updated_at=now() WHERE company_id=$1 AND id=$2 AND revision=$4 RETURNING *`, [companyId, req.params.id, parsed.name, req.body.revision])
          : await client.query(`INSERT INTO ${table}(company_id,name) VALUES($1,$2) RETURNING *`, [companyId, parsed.name]);
        if (!result.rows.length) {
          const exists = await client.query(`SELECT id FROM ${table} WHERE company_id=$1 AND id=$2`, [companyId, req.params.id]);
          await client.query('ROLLBACK');
          return res.status(exists.rows.length ? 409 : 404).json({ error: { message: exists.rows.length ? 'Este cadastro foi alterado. Atualize a lista e reabra a edição.' : 'Cadastro não encontrado.' } });
        }
        const record = result.rows[0];
        if (property) {
          await client.query('DELETE FROM public.traceability_property_producers WHERE company_id=$1 AND property_id=$2', [companyId, record.id]);
          for (const producerId of parsed.producerIds) await client.query('INSERT INTO public.traceability_property_producers(company_id,property_id,producer_id) VALUES($1,$2,$3)', [companyId, record.id, producerId]);
          record.producer_ids = parsed.producerIds;
        }
        await client.query("INSERT INTO public.audit_logs(company_id,actor_subject,action,entity_type,entity_id,summary) VALUES($1,$2,$3,$4,$5,$6::jsonb)", [companyId, req.auth.subject, editing ? 'updated' : 'created', property ? 'traceability_property' : 'traceability_producer', record.id, JSON.stringify({ name: record.name })]);
        await client.query('COMMIT');
        return res.status(editing ? 200 : 201).json({ [property ? 'property' : 'producer']: record });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        return fail(error, res);
      } finally { client?.release(); }
    }
    router.post(`/${resource}`, save);
    router.patch(`/${resource}/:id`, save);
  }
  router.use(createHarvestsRouter({ pool }));
  router.use(createLabelsRouter({ pool }));
  return router;
}
