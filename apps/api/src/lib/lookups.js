export async function operationLookups(db,company,access){
  const allowed=access.operations||access.finance;
  const customers=allowed?await db.query('SELECT id,name FROM public.customers WHERE company_id=$1 AND archived_at IS NULL ORDER BY name LIMIT 20001',[company]):{rows:[]};
  const catalog=allowed?await db.query("SELECT id,name,code,unit,item_type,is_active,minimum_stock FROM public.catalog_items WHERE company_id=$1 AND item_type='product' AND is_active AND archived_at IS NULL ORDER BY name LIMIT 20001",[company]):{rows:[]};
  const suppliers=access.finance?await db.query('SELECT id,name FROM public.suppliers WHERE company_id=$1 AND is_active AND archived_at IS NULL ORDER BY name LIMIT 20001',[company]):{rows:[]};
  if([customers,catalog,suppliers].some(result=>result.rows.length>20000))throw new Error('O volume de cadastros exige uma preparação por etapas.');
  return{access,customers:customers.rows,catalog:catalog.rows,suppliers:suppliers.rows};
}
