# EletroAgro

Sistema de gestão para serviços elétricos. Projeto em desenvolvimento incremental. Consulte primeiro `gabarito do sistema.txt` e `ARQUITETURA-INICIAL.md`.

## Estrutura atual

- `apps/web`: interface React + Vite.
- `apps/api`: API Node.js + Express; conexão PostgreSQL somente quando `DATABASE_URL` estiver configurada.
- `apps/api/src/db/migrations`: migrações SQL versionadas do PostgreSQL.
- `apps/api/src/routes`: rotas de empresa, clientes, catálogo, fornecedores, orçamentos, vendas, operações, estoque e financeiro, protegidas por autenticação e vínculo empresarial.
- `apps/web/src/authClient.js`: cliente do Neon Auth.
- `apps/web/src/CustomersPage.jsx`: primeiro módulo comercial (empresa e clientes).
- `apps/web/src/CatalogPage.jsx`: cadastro de produtos e serviços.
- `apps/web/src/QuotesPage.jsx`: criação, consulta e acompanhamento de orçamentos, duplicação de propostas, cadastro rápido de clientes e geração/compartilhamento de PDF.
- `apps/web/src/SalesPage.jsx`: registro de vendas avulsas, conversão de orçamentos aprovados, filtros por período, alertas de atraso, comprovante PDF e recebimentos parciais.
- `apps/web/src/OperationsPages.jsx`: painel com dados reais, contas a receber e pagar, ordens de serviço, agenda semanal, compras integradas ao estoque e histórico de atividades.
- `apps/web/public/logo-eletroagro.jpeg`: logo usada na identidade visual do sistema.
- `gabarito do sistema.txt`: documento mestre de requisitos.
- `ARQUITETURA-INICIAL.md`: proposta técnica e modelo de dados para revisão.

## Pré-requisitos

- Node.js 20 ou superior.
- npm.
- Banco PostgreSQL de desenvolvimento é opcional para abrir a interface e verificar a API; necessário para operações que consultem dados.

## Executar localmente

Instale as dependências a partir das pastas dos aplicativos:

```powershell
cd apps/api
npm install
cd ../web
npm install
```

Depois, na raiz do projeto, execute em terminais separados:

```powershell
npm run dev:api
npm run dev:web
```

Frontend: `http://localhost:5173`  
API: `http://localhost:3000/api/health`

Os arquivos locais `apps/api/.env` e `apps/web/.env` guardam as configurações de desenvolvimento. Não compartilhe nem versione arquivos `.env`. Para Neon PostgreSQL, `DATABASE_SSL=true` exige TLS com validação de certificado.

O formulário local oferece cadastro e login via Neon Auth; a API valida assinatura EdDSA, emissor, audiência e validade do JWT usando o JWKS. O cadastro está aberto somente para desenvolvimento; não publique antes de concluir vínculo da conta à empresa e fluxo de convites.

Depois de configurar uma URL PostgreSQL de desenvolvimento, aplique as migrações a partir da raiz com `npm --prefix apps/api run db:migrate`. A migração `008_operations_finance_audit.sql` acrescenta contas, pagamentos parciais, ordens de serviço, agenda, estoque, compras, convites de equipe e auditoria; ela também cria os recebíveis das vendas que já existiam. Não execute em banco de produção nesta etapa.

## Estado e limites conhecidos

- O painel inicial consulta vendas, recebimentos, despesas, orçamentos, agenda e pendências reais da API.
- A API já inclui operações de listar, pesquisar, consultar, cadastrar, editar, restaurar e excluir permanentemente clientes e itens do catálogo. Orçamentos podem ser editados com histórico de versões e excluídos permanentemente. Exclusões de clientes e itens preservam os snapshots que já estão nos orçamentos.
- Em Configurações, o responsável pode editar os dados da empresa ou apagar permanentemente a empresa e todos os dados de negócio vinculados após confirmação pelo nome exato.
- As migrações preparam empresas, vínculos de usuários, clientes e catálogo. O catálogo permite cadastrar, pesquisar, editar, ativar/desativar e arquivar produtos e serviços.
- Orçamentos recebem numeração sequencial por empresa, preservam os dados do cliente e snapshots dos itens, calculam os totais na API e permitem acompanhar as transições de status.
- Vendas recebem numeração sequencial por empresa, podem ser registradas diretamente ou convertidas de orçamentos aprovados, preservam os itens e clientes como snapshots, acompanham recebimentos parciais e geram comprovante PDF. Vendas e compras alimentam o Financeiro; compras e vendas movimentam saldos de estoque quando o produto está sendo controlado.
- O Financeiro acompanha receitas e despesas, vencimentos, pagamentos parciais, saldos pendentes e exportação CSV. Ele não substitui contabilidade, conciliação bancária ou emissão fiscal.
- Ordens de serviço podem partir de orçamento aprovado ou venda, acompanhar prioridade e situação, registrar materiais usados com baixa de estoque e gerar PDF. A agenda organiza compromissos por semana e associa clientes e ordens.
- O responsável pode gerar códigos de convite de equipe com validade de sete dias, suspender ou restaurar acessos e consultar ações auditadas. O código precisa ser compartilhado manualmente; não há envio automático de e-mail.
- O cadastro Neon Auth ainda está em modo de desenvolvimento. Fluxo de recuperação de conta, publicação, backup e revisão de permissões ainda precisam ser definidos antes de uma implantação pública.
- O aplicativo ainda exige conexão para consultar ou gravar dados; instalação PWA com edição offline e sincronização entre dispositivos continua pendente.
- Não conectar um banco de produção nesta fase.
- A hospedagem, as regras comerciais e a estratégia offline continuam pendentes de decisão conforme o documento mestre.
