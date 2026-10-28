// Shared policy schema. The API remains authoritative; UI checks are convenience only.
export const moduleCatalog={
  dashboard:{label:'Visão geral',area:null,actions:['view']},
  company:{label:'Empresa e documentos',area:null,actions:['view','edit']},
  users:{label:'Usuários e permissões',area:null,actions:['view','create','edit','administer','reset']},
  customers:{label:'Clientes',area:'commercial',actions:['view','create','edit','delete','export']},
  catalog:{label:'Produtos e serviços',area:'commercial',actions:['view','create','edit','delete','costs','export']},
  suppliers:{label:'Fornecedores',area:'commercial',actions:['view','create','edit','delete','export']},
  quotes:{label:'Orçamentos',area:'commercial',actions:['view','create','edit','delete','approve','cancel','export']},
  sales:{label:'Vendas',area:'commercial',actions:['view','create','receive','cancel','export']},
  expenses:{label:'Despesas',area:'finance',actions:['view','create','edit','pay','cancel','export']},
  purchases:{label:'Compras',area:'finance',actions:['view','create','export']},
  stock:{label:'Estoque',area:'operations',actions:['view','create','costs','export']},
  orders:{label:'Ordens históricas',area:'operations',actions:['view','create','edit','cancel','export']},
  payables:{label:'Contas a pagar',area:'finance',actions:['view','create','edit','pay','cancel','export']},
  receivables:{label:'Contas a receber',area:'finance',actions:['view','create','edit','receive','cancel','export']},
  finance:{label:'Financeiro',area:'finance',actions:['view','create','edit','pay','receive','cancel','export']},
  receipts:{label:'Recibos',area:'finance',actions:['view','create','export']},
  agenda:{label:'Agenda',area:'operations',actions:['view','create','edit','cancel','delete','export']},
  audit:{label:'Histórico',area:'audit',actions:['view','export']},
  reports:{label:'Relatórios',area:'reports',actions:['view','export']},
};
export const actionLabels={view:'Visualizar',create:'Cadastrar',edit:'Editar',delete:'Excluir',cancel:'Cancelar',approve:'Aprovar',pay:'Pagar',receive:'Receber',costs:'Visualizar custos',export:'Exportar / PDF',administer:'Administrar permissões',reset:'Solicitar recuperação de acesso'};
export function canAction(member,module,action='view'){
  if(member?.role==='owner')return true;
  const definition=moduleCatalog[module];if(!definition||!definition.actions.includes(action))return false;
  const permissions=member?.permissions||{};
  if(permissions.version===2){const grant=permissions.modules?.[module];return grant?.view===true&&grant[action]===true;}
  // Preserve legacy memberships, including their owner-only administrative restrictions.
  if(module==='company')return action==='view';
  if(module==='users')return false;
  return definition.area?permissions[definition.area]!==false:action==='view';
}
export function normalizePolicy(input){
  const modules=Object.fromEntries(Object.entries(moduleCatalog).map(([module,{actions}])=>{
    const grant=input?.modules?.[module]||{};return[module,Object.fromEntries(actions.map(action=>[action,grant.view===true&&grant[action]===true]))];
  }));
  const areas=Object.fromEntries(['commercial','operations','finance','reports','audit'].map(area=>[area,Object.entries(moduleCatalog).some(([module,def])=>def.area===area&&modules[module].view)]));
  return{...areas,version:2,modules};
}
export function legacyToPolicy(member){
  return normalizePolicy({modules:Object.fromEntries(Object.entries(moduleCatalog).map(([module,def])=>[module,Object.fromEntries(def.actions.map(action=>[action,canAction(member,module,action)]))]))});
}
export function emptyPolicy(){return normalizePolicy({});}
