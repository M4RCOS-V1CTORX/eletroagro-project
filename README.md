# EletroAgro

Sistema web de gestão para serviços elétricos. O frontend e a API estão publicados na Vercel e usam Neon Auth e PostgreSQL. Este documento descreve o estado real do produto e o que ainda falta antes de tratá-lo como pronto para uso crítico.

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

Os arquivos locais `apps/api/.env` e `apps/web/.env` guardam as configurações de desenvolvimento. Não compartilhe nem versione arquivos `.env`. Para Neon PostgreSQL, `DATABASE_SSL=true` exige TLS com validação de certificado. Em produção, configure `WEB_ORIGIN` na API com a origem exata do frontend; origens múltiplas podem ser separadas por vírgula.

O login e cadastro usam Neon Auth; a API valida assinatura EdDSA, emissor, audiência e validade do JWT usando o JWKS. O primeiro usuário pode criar a empresa e convidar até quatro pessoas. O acesso aos dados exige vínculo ativo com a empresa.

Depois de configurar uma URL PostgreSQL de desenvolvimento, aplique as migrações a partir da raiz com `npm --prefix apps/api run db:migrate`. Em produção, faça backup e confirme o estado do banco antes de aplicar qualquer migração.

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
- O sistema inclui recuperação de senha pelo Neon Auth, PWA instalável, indicador de conexão e fila segura no IndexedDB para operações selecionadas de cadastros, agenda, estoque e financeiro. A fila armazena somente rota e conteúdo da operação; tokens de sessão não são persistidos.
- Relatórios gerenciais consolidam vendas, receitas, despesas, aprovação de orçamentos, serviços, estoque baixo, principais clientes e atividade por usuário, com exportação CSV e PDF.
- O Financeiro permite lançamentos únicos, parcelas e recorrências semanais ou mensais. Pagamentos podem gerar recibos numerados em PDF.
- Ordens de serviço aceitam fotos e PDFs de até 2 MB por arquivo. Estes anexos ficam no PostgreSQL; acompanhe o consumo de armazenamento do plano contratado.
- A equipe possui permissões separadas para Comercial, Operação, Financeiro, Relatórios e Histórico. O responsável mantém acesso total.
- Convites podem ser enviados automaticamente quando `RESEND_API_KEY`, `EMAIL_FROM` e `APP_URL` estiverem configurados. Sem essas variáveis, o código continua disponível para envio manual.
- Lembretes usam a API de notificações do navegador quando autorizados e o aplicativo está aberto. Notificação remota com o aplicativo totalmente fechado exige um serviço de push externo.
- A aparência dos PDFs pode ser personalizada em Configurações, incluindo cor, rodapé e campo de assinatura.
- A API limita CORS às origens exatas definidas em `WEB_ORIGIN` (mais localhost para desenvolvimento). Mantenha essa variável alinhada ao domínio do frontend.
- Documentos financeiros e alterações críticas continuam exigindo conexão atualizada. Isso evita conflitos silenciosos de estoque, numeração ou pagamentos entre dispositivos.
- O Financeiro é um controle gerencial; não substitui contabilidade, conciliação bancária ou emissão fiscal.
- A suíte automatizada valida datas, dinheiro, quantidades, parcelas, permissões, segurança do PWA e migrações. `npm run test:db` valida os novos recursos diretamente no PostgreSQL dentro de uma transação revertida.
- A especificação completa de requisitos está em `gabarito do sistema.txt`; itens descritos nela que não aparecem como implementados acima ainda são escopo pendente.

## Backup e recuperação

Configure `BACKUP_ENCRYPTION_KEY` com uma frase secreta longa. Ela não deve ser guardada junto dos arquivos de backup.

```powershell
npm --prefix apps/api run db:backup
npm --prefix apps/api run db:verify-backup -- caminho\backup.json.gz.enc
```

Os backups usam AES-256-GCM, checksum SHA-256 e ficam em `apps/api/backups`, pasta ignorada pelo Git. A restauração é transacional e exige confirmação explícita:

```powershell
npm --prefix apps/api run db:restore -- caminho\backup.json.gz.enc --confirm=RESTORE
```

Execute restauração primeiro em um banco de homologação. Em produção, crie também um branch ou snapshot no Neon antes da operação.

## Validação da entrega

```powershell
npm test
npm run test:db
npm run build:web
```
