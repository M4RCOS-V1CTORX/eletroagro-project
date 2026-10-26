# Despesas

A tela substitui Ordens de serviço na navegação de computador e celular, utiliza a permissão Financeiro e compartilha os mesmos lançamentos e pagamentos. Nenhum registro antigo de serviço foi removido. A migração 011 adiciona o campo opcional de categoria. Ela foi aplicada ao Neon em 26/10/2026 após autorização e backup criptografado verificado; registros e somas financeiras foram conferidos.

## Funcionalidades

- Cadastro avulso, pago ou pendente, com competência, vencimento, fornecedor, atividade, observações, parcelas e repetições existentes no Financeiro.
- Pesquisa por descrição/fornecedor; período, atividade, categoria, status e forma de pagamento combináveis; limpeza de filtros; ordenação; páginas de 25 registros.
- Total não cancelado, valores pagos (incluindo parciais), saldo pendente e saldo vencido calculados sobre TODOS os registros filtrados, antes da paginação. O período considera vencimento ou competência quando não houver vencimento. O filtro de forma encontra despesas com pelo menos um pagamento naquela forma; os detalhes exibem o histórico.
- Consulta detalhada, pagamentos parciais/totais, exportação CSV da página com proteção contra fórmulas.
- Edição de despesas avulsas pendentes e sem pagamentos, preservando campos omitidos. Versão de atualização impede sobrescrever mudanças de outro aparelho.
- Cancelamento com confirmação pela descrição exata; histórico preservado. Não há exclusão definitiva de documentos financeiros.
- Despesas liquidadas, parcialmente pagas ou geradas por compra/frete não podem ser editadas ou canceladas por esta tela. Integrações permanecem protegidas na origem.
- Categorias próprias e editáveis, digitadas livremente e reutilizadas a partir das categorias já usadas pela empresa. Ex.: Combustível, Manutenção ou Energia. A origem (avulsa, compra ou frete) e a atividade (Elétrica/Fazenda) continuam independentes. Registros anteriores aparecem como Sem categoria.
- A ação Categoria também classifica despesas pagas ou integradas, sem modificar pagamentos, valores ou a origem. A atualização é auditada e protegida contra sobrescrita concorrente.

## Offline

Depois de preparar o aparelho com conexão, a tela consulta/lista/filtra/pagina dados locais, cadastra despesas e registra pagamentos pela fila existente. Pendências são identificadas como aguardando sincronização. Edição, classificação e cancelamento exigem conexão e confirmação do estado atual do servidor; falhas preservam o formulário. Não limpe os dados do navegador enquanto houver lançamentos pendentes.

## Implementação

- `apps/web/src/ExpensesPage.jsx`, `expenses.css`: tela e adaptação móvel.
- `FinanceForms.jsx`, `WorkspaceUI.jsx`: componentes extraídos e compartilhados com o Financeiro, preservando sua lógica.
- `expenseData.js`, `offlineRead.js`, `offlineModel.js`: filtros e indicadores locais e forma de pagamento atualizada.
- `App.jsx`, `OverviewPage.jsx`: navegação, permissões e atalhos para Despesas.
- `apps/api/src/routes/expenses.js`: listagem, detalhes, edição protegida e cancelamento; integrado ao roteador de Operações existente.

Rotas novas sob a autenticação, vínculo empresarial, permissão Financeiro e proteção de idempotência existentes:

- GET `/api/operations/finance/expenses`
- GET/PATCH `/api/operations/finance/expenses/:id`
- POST `/api/operations/finance/expenses/:id/cancel`
- PATCH `/api/operations/finance/expenses/:id/category`

Criação e pagamentos reutilizam POST `/api/operations/finance` e POST `/api/operations/finance/:id/payments`.

## Verificação

`npm test`: 30 testes aprovados no momento da implementação. A integração comercial isolada inclui os filtros combinados, indicadores, paginação, detalhe, edição com preservação, versão antiga recusada, cancelamento, pagamentos e isolamento/permissões. O teste usa PGlite e não consulta o banco remoto.

Navegador local: cadastro, edição, observações preservadas, detalhe, pagamento parcial, confirmação e cancelamento; 28 despesas para conferir duas páginas e totais; cadastro e pagamento sem rede com reconexão sem duplicação; telas de 1440 e 390 px, sem erro JavaScript ou transbordamento da página. Evidências locais em `tmp/pdfs/despesas/`.

O usuário autorizou novamente o envio ao GitHub e autorizou separadamente a migração 011. O backup da migração fica somente no diretório ignorado `apps/api/backups/`. Nenhuma publicação de frontend foi executada nesta retomada.
