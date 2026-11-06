import { randomBytes } from 'node:crypto';
import { Router } from 'express';

function validName(value) {
  return typeof value === 'string' && value.trim().length >= 2 && value.trim().length <= 200;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01') return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validLabel(body) {
  return body && validName(body.productName) && validName(body.propertyName) && validDate(body.harvestDate)
    && Array.isArray(body.producerNames) && body.producerNames.length > 0 && body.producerNames.length <= 100
    && body.producerNames.every(validName);
}

function fail(error, response) {
  if (error.code === '42P01') {
    return response.status(503).json({ error: {
      code: 'TRACEABILITY_NOT_READY',
      message: 'O formulário simplificado de etiquetas ainda não foi habilitado neste ambiente.',
    } });
  }
  console.error('Falha na etiqueta de origem:', error.code || 'UNKNOWN');
  return response.status(500).json({ error: { message: 'Não foi possível concluir a operação da etiqueta.' } });
}

// Inherits authentication, company isolation, permissions and idempotency from its parent router.
export function createLabelsRouter({ pool }) {
  const router = Router();

  router.get('/labels', async (request, response) => {
    const offset = Number(request.query.offset || 0);
    const search = request.query.q ?? '';
    if (typeof search !== 'string' || search.length > 200) {
      return response.status(400).json({ error: { message: 'A busca deve ter até 200 caracteres.' } });
    }
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 2147483647) {
      return response.status(400).json({ error: { message: 'Página de histórico inválida.' } });
    }
    try {
      // The old harvest records remain visible without migrating or rewriting their contents.
      const filteredRecords = `
        SELECT * FROM (
          SELECT l.id,l.product_name,l.property_name,l.harvest_date,l.public_id,l.created_at,true AS editable,
            (SELECT jsonb_agg(jsonb_build_object('name',p.name) ORDER BY p.position)
              FROM jsonb_array_elements_text(l.producer_names) WITH ORDINALITY AS p(name,position)) AS producers
          FROM public.traceability_labels l WHERE l.company_id=$1
          UNION ALL
          SELECT h.id,h.product_name,h.property_name,h.harvest_date,h.public_id,h.created_at,false AS editable,
            COALESCE((SELECT jsonb_agg(jsonb_build_object('name',p.producer_name) ORDER BY p.producer_name,p.producer_id)
              FROM public.traceability_harvest_producers p
              WHERE p.company_id=h.company_id AND p.harvest_id=h.id),'[]'::jsonb) AS producers
          FROM public.traceability_harvests h WHERE h.company_id=$1
        ) records
        WHERE $2='' OR strpos(lower(product_name),lower($2))>0
          OR strpos(lower(property_name),lower($2))>0
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(producers) AS producer
            WHERE strpos(lower(producer->>'name'),lower($2))>0)`;
      const params = [request.company.company_id, search.trim()];
      const history = await pool.query(`${filteredRecords} ORDER BY created_at DESC,id LIMIT 25 OFFSET $3`, [...params, offset]);
      const count = await pool.query(`SELECT count(*)::int AS total FROM (${filteredRecords}) matched`, params);
      return response.json({ labels: history.rows, pagination: { total: count.rows[0].total } });
    } catch (error) { return fail(error, response); }
  });

  router.post('/labels', async (request, response) => {
    const body = request.body;
    if (!validLabel(body)) {
      return response.status(400).json({ error: { message: 'Preencha produto, propriedade, um ou mais responsáveis e uma data da colheita válida. Nomes devem ter entre 2 e 200 caracteres.' } });
    }
    const producerNames = [...new Set(body.producerNames.map(name => name.trim()))];
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const result = await client.query(`INSERT INTO public.traceability_labels
        (company_id,product_name,property_name,producer_names,harvest_date,public_id)
        VALUES($1,$2,$3,$4::jsonb,$5,$6) RETURNING *`, [
        request.company.company_id, body.productName.trim(), body.propertyName.trim(),
        JSON.stringify(producerNames), body.harvestDate, randomBytes(32).toString('hex'),
      ]);
      const label = result.rows[0];
      await client.query(`INSERT INTO public.audit_logs(company_id,actor_subject,action,entity_type,entity_id,summary)
        VALUES($1,$2,'created','traceability_label',$3,$4::jsonb)`, [request.company.company_id, request.auth.subject, label.id,
        JSON.stringify({ name: label.product_name, harvestDate: body.harvestDate })]);
      await client.query('COMMIT');
      return response.status(201).json({ label: { ...label, producers: producerNames.map(name => ({ name })) } });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return fail(error, response);
    } finally { client?.release(); }
  });

  router.patch('/labels/:publicId', async (request, response) => {
    const body = request.body;
    if (!/^[a-f0-9]{64}$/.test(request.params.publicId) || !validLabel(body) || !validLabel(body.original)) {
      return response.status(400).json({ error: { message: 'Confira os quatro campos e reabra a etiqueta antes de editar.' } });
    }
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const params = [request.company.company_id, request.params.publicId];
      const current = (await client.query(`SELECT id,product_name,property_name,producer_names,harvest_date::text AS harvest_date
        FROM public.traceability_labels WHERE company_id=$1 AND public_id=$2 FOR UPDATE`, params)).rows[0];
      if (!current) {
        await client.query('ROLLBACK');
        return response.status(404).json({ error: { message: 'Etiqueta não encontrada ou da versão anterior. Atualize o histórico.' } });
      }
      const original = body.original;
      if (current.product_name !== original.productName || current.property_name !== original.propertyName
        || current.harvest_date !== original.harvestDate || JSON.stringify(current.producer_names) !== JSON.stringify(original.producerNames)) {
        await client.query('ROLLBACK');
        return response.status(409).json({ error: { message: 'Esta etiqueta foi alterada por outra pessoa. Cancele a edição, atualize o histórico e abra novamente.' } });
      }
      await client.query(`UPDATE public.traceability_labels SET product_name=$3,property_name=$4,producer_names=$5::jsonb,harvest_date=$6
        WHERE company_id=$1 AND public_id=$2`, [...params, body.productName.trim(), body.propertyName.trim(),
        JSON.stringify([...new Set(body.producerNames.map(name => name.trim()))]), body.harvestDate]);
      await client.query(`INSERT INTO public.audit_logs(company_id,actor_subject,action,entity_type,entity_id,summary)
        VALUES($1,$2,'updated','traceability_label',$3,$4::jsonb)`, [request.company.company_id, request.auth.subject,
        current.id, JSON.stringify({ name: body.productName.trim(), harvestDate: body.harvestDate })]);
      await client.query('COMMIT');
      return response.json({ updated: true, id: current.id });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return fail(error, response);
    } finally { client?.release(); }
  });

  router.delete('/labels/:publicId', async (request, response) => {
    if (!/^[a-f0-9]{64}$/.test(request.params.publicId)) {
      return response.status(400).json({ error: { message: 'Identificador de etiqueta inválido.' } });
    }
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const params = [request.company.company_id, request.params.publicId];
      const label = await client.query(`DELETE FROM public.traceability_labels
        WHERE company_id=$1 AND public_id=$2 RETURNING id,product_name`, params);
      // Legacy harvests are also labels in the combined history. Their responsible
      // snapshots cascade, while producer, property and catalog registrations remain.
      const record = label.rows[0] || (await client.query(`DELETE FROM public.traceability_harvests
        WHERE company_id=$1 AND public_id=$2 RETURNING id,product_name`, params)).rows[0];
      if (!record) {
        await client.query('ROLLBACK');
        return response.status(404).json({ error: { message: 'Etiqueta não encontrada. Atualize o histórico.' } });
      }
      await client.query(`INSERT INTO public.audit_logs(company_id,actor_subject,action,entity_type,entity_id,summary)
        VALUES($1,$2,'deleted','traceability_label',$3,$4::jsonb)`, [
        request.company.company_id, request.auth.subject, record.id, JSON.stringify({ name: record.product_name }),
      ]);
      await client.query('COMMIT');
      return response.json({ deleted: true, id: record.id });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return fail(error, response);
    } finally { client?.release(); }
  });

  return router;
}
