import { Router } from 'express';
import { idempotencyGuard, requireAreaPermission, requireCompanyMembership } from '../middleware/neon-auth.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function fail(res,status,message) { return res.status(status).json({error:{message}}); }
function handleError(error,res,action) { console.error(`Falha ao ${action} previsão:`,error.message); if(error.code==='42P01'||error.code==='42703')return fail(res,503,'A atualização de Previsão de Carga ainda não foi instalada no banco de dados.');return fail(res,500,'Não foi possível acessar as previsões.'); }
function validate(body) {
  const {property,producer,date,items,quality,grading,transport,requireFullPercentage=false}=body||{};
  const validDate=typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&!Number.isNaN(Date.parse(date))&&new Date(`${date}T00:00:00Z`).toISOString().slice(0,10)===date;
  const decimal=(v,digits,places)=>typeof v==='string'&&new RegExp(`^\\d{1,${digits}}(?:\\.\\d{1,${places}})?$`).test(v);
  if(typeof property!=='string'||!property.trim()||property.trim().length>200||typeof producer!=='string'||!producer.trim()||producer.trim().length>200||!validDate||!Array.isArray(items)||!items.length||typeof requireFullPercentage!=='boolean')return 'Confira propriedade, produtor, data e itens.';
  for(const item of items){
    if(!item||!uuid.test(item.productId||'')||!['frutas','verduras'].includes(item.category)||!decimal(item.quantity,9,3)||Number(item.quantity)<=0||!decimal(item.unitPrice,9,2)||!decimal(item.weight,9,3))return 'Confira produto, categoria, quantidade, preço, peso em kg e percentuais (0 a 100).';
  }
  if(transport && (!['vehicle','driver','plate'].every(k=>typeof transport[k]==='string'&&transport[k].trim().length<=120) || !(transport.bunches===''||/^\d{1,9}$/.test(transport.bunches))))return 'Confira os dados de transporte e a quantidade de cachos.';
  if(grading){
    const groups=['first','second','third'];
    if(!groups.every(k=>grading[k]&&decimal(grading[k].weight,9,3)&&/^\d{1,9}$/.test(grading[k].boxes)))return 'Informe caixas e peso válidos para cada qualidade.';
    const units=v=>{const [a,b='']=v.split('.');return BigInt(a)*1000n+BigInt((b+'000').slice(0,3));};
    for(const key of groups){const g=grading[key];if(g.weighingsText!=null){if(typeof g.weighingsText!=='string'||g.weighingsText.length>100000)return 'Confira as pesagens individuais.';const lines=g.weighingsText.split(/\r?\n/).map(v=>v.trim()).filter(Boolean);if(lines.length){if(!lines.every(v=>/^\d{1,9}(?:[.,]\d{1,3})?$/.test(v)))return 'Informe pesos individuais válidos, um por linha.';if(BigInt(lines.length)!==BigInt(g.boxes)||lines.reduce((sum,v)=>sum+units(v.replace(',','.')),0n)!==units(g.weight))return 'As caixas e o peso devem corresponder às pesagens individuais.';}}}
    const classified=groups.reduce((sum,k)=>sum+units(grading[k].weight),0n);
    const total=items.reduce((sum,item)=>sum+units(item.weight),0n);
    if(classified!==total||total===0n)return 'A soma dos pesos por qualidade deve ser igual ao peso total da carga e maior que zero.';
    return null;
  }
  if (!quality || typeof quality !== 'object' || !['first','second','third'].every(k=>decimal(quality[k],3,2)&&Number(quality[k])<=100)) return 'Informe os percentuais gerais da carga entre 0 e 100.';
  if(requireFullPercentage){const units=v=>{const [a,b='']=v.split('.');return Number(a)*100+Number((b+'00').slice(0,2));};if(['first','second','third'].reduce((sum,k)=>sum+units(quality[k]),0)!==10000)return 'Os percentuais da carga devem somar 100%.';}
  return null;
}
export function createLoadForecastsRouter({pool,requireAuth,requireDatabase}) {
  const router=Router();router.use(requireAuth,requireDatabase(pool),requireCompanyMembership(pool),requireAreaPermission('commercial'),idempotencyGuard(pool));
  router.param('id',(req,res,next,id)=>uuid.test(id)?next():fail(res,400,'Identificador inválido.'));
  router.get('/',async(req,res)=>{try{const r=await pool.query('SELECT id,property,producer,forecast_date,items,created_at,is_active,revision,require_full_percentage FROM public.load_forecasts WHERE company_id=$1 ORDER BY forecast_date DESC,created_at DESC',[req.company.company_id]);return res.json({forecasts:r.rows});}catch(e){return handleError(e,res,'listar');}});
  async function save(req,res) {
    const error=validate(req.body);if(error)return fail(res,400,error);
    const {property,producer,date,items,quality,grading,transport,requireFullPercentage=false,revision}=req.body;
    if(req.params.id&&(!Number.isInteger(revision)||revision<1))return fail(res,400,'Reabra a previsão antes de editar.');
    try {
      const ids=[...new Set(items.map(item=>item.productId))];
      const result=await pool.query("SELECT id,name,unit FROM public.catalog_items WHERE company_id=$1 AND id=ANY($2::uuid[]) AND item_type='product' AND is_active AND archived_at IS NULL",[req.company.company_id,ids]);
      const byId=new Map(result.rows.map(p=>[p.id,p]));
      if(ids.some(id=>!byId.has(id)))return fail(res,400,'Um produto selecionado não está disponível no catálogo.');
      const saved=items.map(({productId,category,quantity,unitPrice,weight},index)=>({productId,category,quantity,unitPrice,weight,...(index===0?(grading?{loadGrading:grading,...(transport?{loadTransport:transport}:{})}:{loadQuality:{first:quality.first,second:quality.second,third:quality.third}}):{}),name:byId.get(productId).name,unit:byId.get(productId).unit}));
      if(req.params.id){
        const previous=await pool.query('SELECT items FROM public.load_forecasts WHERE id=$1 AND company_id=$2 AND revision=$3',[req.params.id,req.company.company_id,revision]);
        if(!previous.rowCount)return fail(res,409,'A previsão mudou ou foi removida. Atualize a lista.');
        const old=previous.rows[0].items;
        const snapshot=old[0]?.legacyQualitySnapshot || (!old[0]?.loadQuality && !old[0]?.loadGrading ? old.filter(item=>item.first!=null).map(({productId,name,first,second,third})=>({productId,name,first,second,third})) : []);
        if(snapshot.length)saved[0].legacyQualitySnapshot=snapshot;
        if(old[0]?.legacyLoadQuality || old[0]?.loadQuality)saved[0].legacyLoadQuality=old[0].legacyLoadQuality || old[0].loadQuality;
      }
      let r;
      if(req.params.id){r=await pool.query('UPDATE public.load_forecasts SET property=$3,producer=$4,forecast_date=$5,items=$6::jsonb,require_full_percentage=$7,revision=revision+1 WHERE id=$1 AND company_id=$2 AND revision=$8 AND is_active RETURNING *',[req.params.id,req.company.company_id,property.trim(),producer.trim(),date,JSON.stringify(saved),requireFullPercentage,revision]);if(!r.rowCount)return fail(res,409,'A previsão mudou, foi desativada ou removida. Atualize a lista antes de tentar novamente.');}
      else r=await pool.query('INSERT INTO public.load_forecasts (company_id,property,producer,forecast_date,items,require_full_percentage) VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING *',[req.company.company_id,property.trim(),producer.trim(),date,JSON.stringify(saved),requireFullPercentage]);
      return res.status(req.params.id?200:201).json({forecast:r.rows[0]});
    }catch(e){return handleError(e,res,'salvar');}
  }
  router.post('/',save);router.put('/:id',save);
  router.patch('/:id/status',async(req,res)=>{const {isActive,revision}=req.body||{};if(typeof isActive!=='boolean'||!Number.isInteger(revision)||revision<1)return fail(res,400,'Situação inválida.');try{const r=await pool.query('UPDATE public.load_forecasts SET is_active=$3,revision=revision+1 WHERE id=$1 AND company_id=$2 AND revision=$4 RETURNING *',[req.params.id,req.company.company_id,isActive,revision]);if(!r.rowCount)return fail(res,409,'A previsão mudou ou foi removida. Atualize a lista.');return res.json({forecast:r.rows[0]});}catch(e){return handleError(e,res,'alterar');}});
  router.delete('/:id',async(req,res)=>{if(req.company.role!=='owner')return fail(res,403,'Somente o responsável pela empresa pode excluir permanentemente.');const {confirmation,revision}=req.body||{};if(confirmation!=='EXCLUIR'||!Number.isInteger(revision)||revision<1)return fail(res,400,'Confirme a exclusão digitando EXCLUIR.');try{const r=await pool.query('DELETE FROM public.load_forecasts WHERE id=$1 AND company_id=$2 AND revision=$3 RETURNING id',[req.params.id,req.company.company_id,revision]);if(!r.rowCount)return fail(res,409,'A previsão mudou ou foi removida. Atualize a lista.');return res.json({deleted:true});}catch(e){return handleError(e,res,'excluir');}});
  return router;
}
