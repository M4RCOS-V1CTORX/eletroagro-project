import { canAction } from '../../../../shared/access-policy.js';
import { Router } from 'express';
import { idempotencyGuard, requireAreaPermission, requireCompanyMembership } from '../middleware/neon-auth.js';

const fields = {
  itemType: { column: 'item_type', type: 'enum', values: ['product', 'service'] },
  code: { column: 'code', type: 'text', max: 40 },
  name: { column: 'name', type: 'text', max: 180, required: true },
  description: { column: 'description', type: 'text', max: 3000 },
  category: { column: 'category', type: 'text', max: 100 },
  unit: { column: 'unit', type: 'text', max: 20 },
  costPrice: { column: 'cost_price', type: 'number' },
  salePrice: { column: 'sale_price', type: 'number' },
  minimumStock: { column: 'minimum_stock', type: 'number' },
  estimatedMinutes: { column: 'estimated_minutes', type: 'integer' },
  isActive: { column: 'is_active', type: 'boolean' },
};

function parseInput(input, { partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Envie os dados do item em formato válido.' };
  const output = {};
  for (const [key, rule] of Object.entries(fields)) {
    if (!Object.hasOwn(input, key)) continue;
    const raw = input[key];
    if (rule.type === 'boolean') {
      if (typeof raw !== 'boolean') return { error: 'A situação do item é inválida.' };
      output[rule.column] = raw;
      continue;
    }
    if (rule.type === 'number' || rule.type === 'integer') {
      if (raw === null && rule.type === 'integer') {
        output[rule.column] = null;
        continue;
      }
      const value = raw === '' || raw === null ? 0 : Number(raw);
      if (!Number.isFinite(value) || value < 0 || (rule.type === 'integer' && !Number.isInteger(value))) {
        return { error: 'Preços, estoque e tempo devem ser números válidos e não negativos.' };
      }
      output[rule.column] = value;
      continue;
    }
    if (raw !== null && typeof raw !== 'string') return { error: 'Os dados do item contêm um campo inválido.' };
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (rule.required && value.length < 2) return { error: 'Informe um nome com pelo menos 2 caracteres.' };
    if (value.length > (rule.max || 30)) return { error: `Um campo do item excede o limite de ${rule.max} caracteres.` };
    if (rule.values && !rule.values.includes(value)) return { error: 'Selecione produtos ou serviços para o item.' };
    output[rule.column] = value || null;
  }
  if (!partial) {
    if (!output.item_type) return { error: 'Selecione se o item é um produto ou serviço.' };
    if (!output.name) return { error: 'Informe o nome do item.' };
    if (!Object.hasOwn(output, 'unit')) output.unit = 'un';
  }
  if (partial && !Object.keys(output).length) return { error: 'Informe ao menos um campo para atualizar.' };
  return { value: output };
}

function handleError(error, response, action) {
  if (error.code === '23505') return response.status(409).json({ error: { code: 'CATALOG_CODE_EXISTS', message: 'Já existe um item ativo com esse código.' } });
  console.error(`Falha ao ${action} item do catálogo:`, error.message);
  return response.status(500).json({ error: { code: 'CATALOG_OPERATION_FAILED', message: `Não foi possível ${action} o item.` } });
}

export function createCatalogRouter({ pool, requireAuth, requireDatabase }) {
  const router = Router();
  router.use(requireAuth, requireDatabase(pool), requireCompanyMembership(pool), requireAreaPermission('commercial'), idempotencyGuard(pool));
  router.param('id', (request, response, next, id) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      return response.status(400).json({ error: { code: 'INVALID_CATALOG_ID', message: 'Identificador de item inválido.' } });
    }
    return next();
  });

  router.get('/', async (request, response) => {
    const type = ['product', 'service'].includes(request.query.type) ? request.query.type : '';
    const status = ['active', 'inactive', 'archived', 'all'].includes(request.query.status) ? request.query.status : 'active';
    const query = typeof request.query.q === 'string' ? request.query.q.trim().slice(0, 120) : '';
    const offset = Math.max(0, Math.min(Number.parseInt(request.query.offset, 10) || 0, 2147483647));
    try {
      const result = await pool.query(
        `SELECT id, item_type, code, name, description, category, unit, cost_price, sale_price,
                minimum_stock, estimated_minutes, is_active, created_at, updated_at, archived_at,
                count(*) OVER()::int AS total_count
         FROM public.catalog_items
         WHERE company_id = $1
           AND ($2 = '' OR item_type = $2)
           AND ($3 = 'all' OR ($3 = 'archived' AND archived_at IS NOT NULL)
             OR ($3 = 'active' AND archived_at IS NULL AND is_active)
             OR ($3 = 'inactive' AND archived_at IS NULL AND NOT is_active))
           AND ($4 = '' OR name ILIKE '%' || $4 || '%' OR COALESCE(code, '') ILIKE '%' || $4 || '%'
             OR COALESCE(category, '') ILIKE '%' || $4 || '%')
         ORDER BY lower(name), id
         LIMIT 100 OFFSET $5`,
        [request.company.company_id, type, status, query, offset],
      );
      return response.json({ items: result.rows.map(({ total_count, ...item }) => item), total: result.rowCount ? result.rows[0].total_count : 0 });
    } catch (error) {
      return handleError(error, response, 'listar');
    }
  });

  router.post('/', async (request, response) => {
    const parsed = parseInput(request.body);
    if (parsed.error) return response.status(400).json({ error: { code: 'INVALID_CATALOG_ITEM', message: parsed.error } });
    const raw=request.body.initialStock === '' ? '0' : (request.body.initialStock ?? '0');
    const value=String(raw);
    if(!/^\d{1,9}(?:\.\d{1,3})?$/.test(value)) return response.status(400).json({error:{code:'INVALID_INITIAL_STOCK',message:'Informe um estoque inicial não negativo com até três casas decimais.'}});
    const [whole,fraction='']=value.split('.');const amount=BigInt(whole)*1000n+BigInt((fraction+'000').slice(0,3));
    if(amount>999999999999n || (parsed.value.item_type!=='product' && amount>0n))return response.status(400).json({error:{code:'INVALID_INITIAL_STOCK',message:'Estoque inicial só pode ser informado para produtos.'}});
    if(amount>0n&&!canAction(request.company,'stock','create'))return response.status(403).json({error:{code:'STOCK_FORBIDDEN',message:'Seu perfil não permite registrar estoque inicial.'}});
    const entries=Object.entries(parsed.value);let client;
    try {
      client=await pool.connect();await client.query('BEGIN');
      const result=await client.query(`INSERT INTO public.catalog_items (company_id, ${entries.map(([column])=>column).join(', ')}) VALUES ($1, ${entries.map((_,index)=>`$${index+2}`).join(', ')}) RETURNING *`,[request.company.company_id,...entries.map(([,v])=>v)]);
      if(amount>0n){
        await client.query(`INSERT INTO public.stock_movements(company_id,catalog_item_id,direction,quantity,reason,source_type,created_by_subject) VALUES($1,$2,'in',$3,'Estoque inicial','manual',$4)`,[request.company.company_id,result.rows[0].id,value,request.auth.subject]);
        await client.query(`INSERT INTO public.audit_logs(company_id,actor_subject,action,entity_type,entity_id,summary) VALUES($1,$2,'stock_movement','catalog_item',$3,$4::jsonb)`,[request.company.company_id,request.auth.subject,result.rows[0].id,JSON.stringify({direction:'in',quantity:value,reason:'Estoque inicial'})]);
      }
      await client.query('COMMIT');return response.status(201).json({item:result.rows[0]});
    }catch(error){if(client)await client.query('ROLLBACK').catch(()=>{});return handleError(error,response,'cadastrar');}finally{client?.release();}
  });

  router.patch('/:id', async (request, response) => {
    if (Object.hasOwn(request.body || {}, 'initialStock')) return response.status(400).json({error:{code:'INITIAL_STOCK_CREATE_ONLY',message:'Para alterar o saldo, registre uma movimentação em Estoque.'}});
    const parsed = parseInput(request.body, { partial: true });
    if (parsed.error) return response.status(400).json({ error: { code: 'INVALID_CATALOG_ITEM', message: parsed.error } });
    const entries = Object.entries(parsed.value);
    try {
      const result = await pool.query(
        `UPDATE public.catalog_items SET ${entries.map(([column], index) => `${column} = $${index + 3}`).join(', ')}, updated_at = now()
         WHERE id = $1 AND company_id = $2 RETURNING *`,
        [request.params.id, request.company.company_id, ...entries.map(([, value]) => value)],
      );
      if (!result.rowCount) return response.status(404).json({ error: { code: 'CATALOG_ITEM_NOT_FOUND', message: 'Item não encontrado.' } });
      return response.json({ item: result.rows[0] });
    } catch (error) {
      return handleError(error, response, 'atualizar');
    }
  });

  router.patch('/:id/restore', async (request, response) => {
    if (request.company.role !== 'owner') return response.status(403).json({ error: { code: 'OWNER_REQUIRED', message: 'Somente o responsável da empresa pode restaurar itens.' } });
    try {
      const result = await pool.query(
        `UPDATE public.catalog_items SET archived_at = NULL, updated_at = now()
         WHERE id = $1 AND company_id = $2 AND archived_at IS NOT NULL RETURNING id`,
        [request.params.id, request.company.company_id],
      );
      if (!result.rowCount) return response.status(404).json({ error: { code: 'CATALOG_ITEM_NOT_FOUND', message: 'Item arquivado não encontrado.' } });
      return response.json({ restored: true, id: result.rows[0].id });
    } catch (error) {
      if (error.code === '23505') return response.status(409).json({ error: { code: 'CATALOG_CODE_EXISTS', message: 'Não foi possível restaurar: já existe um item ativo com esse código.' } });
      return handleError(error, response, 'restaurar');
    }
  });

  router.delete('/:id', async (request, response) => {
    if (request.company.role !== 'owner') return response.status(403).json({ error: { code: 'OWNER_REQUIRED', message: 'Somente o responsável da empresa pode excluir itens permanentemente.' } });
    try {
      const result = await pool.query(
        `DELETE FROM public.catalog_items
         WHERE id = $1 AND company_id = $2 RETURNING id`,
        [request.params.id, request.company.company_id],
      );
      if (!result.rowCount) return response.status(404).json({ error: { code: 'CATALOG_ITEM_NOT_FOUND', message: 'Item não encontrado.' } });
      return response.json({ deleted: true, id: result.rows[0].id });
    } catch (error) {
      return handleError(error, response, 'excluir');
    }
  });
  return router;
}
