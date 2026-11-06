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

## Onde colocar cada responsabilidade

A organização abaixo descreve os caminhos existentes. Antes de criar uma pasta ou
mover arquivos, confira os módulos relacionados e reutilize o padrão atual.

| Responsabilidade | Local e exemplos |
| --- | --- |
| Inicialização e navegação da interface | `apps/web/src/main.jsx` e `apps/web/src/App.jsx` |
| Páginas e componentes React | `apps/web/src/*Page.jsx`, `OperationsPages.jsx`, `WorkspaceUI.jsx` e componentes relacionados |
| Hooks (funções que reutilizam comportamento do React) | `apps/web/src/useDialogAccessibility.js` e `useSyncRefresh.js` |
| Comunicação com a API e autenticação | `apps/web/src/apiClient.js`, `apiUrl.js` e `authClient.js` |
| Armazenamento e sincronização offline | `apps/web/src/offline*.js` e `OfflineTools.jsx` |
| PDFs e exportações | `apps/web/src/*Pdf.js`, `pdfDesign.js` e `csv.js` |
| Estilos da interface | `apps/web/src/styles.css` e arquivos CSS específicos dos módulos |
| Recursos públicos e instalação PWA | `apps/web/public/` |
| Rotas HTTP do servidor | `apps/api/src/routes/` |
| Validação de acesso às requisições | `apps/api/src/middleware/` |
| Serviços e funções de apoio do servidor | `apps/api/src/services/` e `apps/api/src/lib/` |
| Migrações e ferramentas do banco | `apps/api/src/db/` |
| Regras compartilhadas entre interface e servidor | `shared/` |
| Testes automatizados e verificações locais | `tests/` |

Os arquivos em `tmp/` e `entrega/` são locais e ignorados pelo Git. Não coloque
código, testes ou documentação permanente nessas pastas. Os documentos existentes
na raiz e o relatório técnico em `output/` continuam nos caminhos atuais.
PDFs gerados em `output/pdf/` ficam apenas no computador. A logo usada pelo
aplicativo é `apps/web/public/logo-eletroagro.jpeg`; a cópia `logo.jpeg` da raiz
também fica apenas no computador.

### Documentação por assunto

- Requisitos e arquitetura: `gabarito do sistema.txt` e `ARQUITETURA-INICIAL.md`.
- Operação e despesas: `OPERACAO.md` e `DESPESAS.md`.
- Modo offline: `GUIA-OFFLINE.md`.
- Publicação e autenticação: `PUBLICACAO.md`.
- Histórico técnico e continuidade: `EVOLUCAO-COMERCIAL.md`, `CONTINUIDADE.md` e `ENTREGA-REVISAO-28-10-2026.md`.

## Pré-requisitos

- Node.js 20 ou superior.
- npm.
- Banco PostgreSQL de desenvolvimento é opcional para abrir a interface e verificar a API; necessário para operações que consultem dados.

## QR Code: formulário e histórico de etiquetas

A tela apresenta um único formulário: produto, propriedade, responsáveis pela
colheita (um nome por linha), data da colheita, telefone e e-mail. Os contatos são
opcionais e, quando informados, aparecem no histórico e na consulta pública.
O formulário avisa que esses dados serão divulgados. Os nomes são digitados diretamente,
sem cadastros prévios nem vínculos obrigatórios. Os dados exigem conexão e ficam
isolados por empresa. Não há cadastro de lote.

O histórico na mesma página reúne as novas etiquetas e as colheitas registradas
na versão anterior, preservando os quatro dados originais. Após salvar, o histórico
permite visualizar a consulta pública, gerar o QR Code e baixar a imagem PNG.
O código contém o endereço da consulta; as informações não são enviadas a serviços
externos de geração. A impressão permite de 1 a 100 etiquetas de 50 × 50 mm,
em duas colunas separadas por 2 mm, com prévia e orientação para a Zetex Z50X.
O alinhamento e a leitura na bobina precisam de conferência na impressora física.
A prévia visual local continua demonstrativa e separada da consulta real.

- Página: `apps/web/src/QRCodePage.jsx`.
- Interface organizada em `apps/web/src/labels/`: formulário, histórico e coordenação.
- API: `/api/traceability/labels` (cadastro e histórico paginado).
- Edição: `PATCH /api/traceability/labels/:publicId` corrige os dados da colheita e os contatos, mantendo o identificador e o QR Code. Verifica permissão de editar, empresa e dados originais, incluindo contatos, para recusar sobrescritas desatualizadas (409); alteração e auditoria são transacionais. Etiquetas legadas permanecem disponíveis para consulta e exclusão, com edição indisponível.
- Consulta sem login: `/rastrear/:publicId`, com API em `/api/public/traceability/:publicId`. Retorna exclusivamente produto, propriedade, nomes dos responsáveis, data da colheita, telefone e e-mail. Não lista registros e não consulta empresas arquivadas. Contatos vazios não são exibidos na página.
- Banco: `018_traceability_labels.sql` cria uma tabela independente, sem modificar as tabelas anteriores.
- Contatos: `019_traceability_label_contacts.sql` adiciona telefone e e-mail à tabela de etiquetas, com valores vazios por padrão, preservando registros existentes. A API continua aceitando cadastros sem contatos; backup e restauração incluem as novas colunas.
- Compatibilidade: as rotas e tabelas das migrações 016 e 017 permanecem preservadas.
- Permissões: utiliza o módulo de rastreamento já existente, com visualizar e cadastrar.
- Testes: `npm test` valida nomes livres, histórico unificado, isolamento, permissões, reenvio, paginação e recuperação pelo backup.

### Endereço das etiquetas e teste público

O endereço padrão de produção das etiquetas é
`https://eletroagro-project.vercel.app/rastrear/IDENTIFICADOR`.
Ele permanece fixo mesmo quando a aplicação é aberta por um endereço de prévia.
Configure `VITE_PUBLIC_SITE_URL` no frontend para substituir esse domínio. Use apenas a origem, por exemplo
`https://origem.example`, sem caminhos. Em produção, a geração exige HTTPS e recusa
endereços localhost. Sem essa variável, tanto o desenvolvimento quanto a produção
usam o domínio fixo acima, independentemente do endereço aberto no navegador.
Não imprima etiquetas definitivas antes de confirmar um domínio permanente.

Testes isolados podem definir explicitamente `VITE_PUBLIC_SITE_URL` com um endereço
local. Não distribua etiquetas geradas com essa configuração: localhost só abre no
próprio computador. Registros criados em banco descartável não existem em produção.
A consulta pública exige internet e um registro salvo no banco da API publicada.
O frontend inclui uma regra de reescrita da Vercel para abrir `/rastrear/:publicId`
diretamente. Publicação e configuração do domínio exigem autorização separada.

`node tests/qa-public-origin.mjs` testa formulário, API, banco descartável, geração,
download e consulta pública. Usa Playwright no runtime local ou em
`PLAYWRIGHT_MODULE_PATH`. Para também decodificar o PNG com um leitor independente,
defina `QR_DECODER_PATH` com o módulo de teste `jsqr` e, quando necessário,
`SHARP_MODULE_PATH` com `sharp`. Esses leitores não são dependências do aplicativo.

Antes de habilitar em produção, gere e verifique um backup com o banco no estado
atual. A rotina de backup tolera a ausência das novas tabelas antes da migração.
Aplique a migração somente com autorização, valide os cadastros e gere um novo
backup que inclua essas tabelas. Para recuar após o início de uso, desative o acesso
ao módulo e preserve as tabelas e seus dados. Não remova as tabelas nem restaure um
backup antigo sobre dados novos sem um plano específico de recuperação.

Na ausência da migração, a API informa que os cadastros ainda não foram habilitados.
Não publique o frontend antes de preparar o banco e a API correspondente.

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

Sistema da equipe: `http://localhost:5173/app`
Consulta pública: `http://localhost:5173/`
API: `http://localhost:3000/api/health`

Os arquivos locais `apps/api/.env` e `apps/web/.env` guardam as configurações de desenvolvimento. Não compartilhe nem versione arquivos `.env`. Para Neon PostgreSQL, `DATABASE_SSL=true` exige TLS com validação de certificado. Em produção, configure `WEB_ORIGIN` na API com a origem exata do frontend; origens múltiplas podem ser separadas por vírgula.

O login usa Neon Auth; a API valida assinatura EdDSA, emissor, audiência e validade do JWT usando o JWKS. O cadastro público está fechado. Novas contas são provisionadas pelo administrador; a criação de empresa exige liberação privada na API, e o responsável pode convidar até quatro pessoas autorizadas. O acesso aos dados exige vínculo ativo com a empresa. Consulte `PUBLICACAO.md` para provisionamento e links de acesso.

Depois de configurar uma URL PostgreSQL de desenvolvimento, aplique as migrações a partir da raiz com `npm --prefix apps/api run db:migrate`. Em produção, faça backup e confirme o estado do banco antes de aplicar qualquer migração.

## Estado e limites conhecidos

- O painel inicial consulta vendas, recebimentos, despesas, orçamentos, agenda e pendências reais da API.
- A visão geral apresenta períodos selecionáveis, indicadores clicáveis, comparação de entradas e saídas, saldos pendentes e prioridades por módulo, com layout para computador e celular. Os testes comerciais isolados podem ser executados com `npm run test:commercial-db`, sem acessar o banco remoto.
- A API já inclui operações de listar, pesquisar, consultar, cadastrar, editar, restaurar e excluir permanentemente clientes e itens do catálogo. Orçamentos podem ser editados com histórico de versões e excluídos permanentemente. Exclusões de clientes e itens preservam os snapshots que já estão nos orçamentos.
- Em Configurações, o responsável pode editar os dados da empresa ou apagar permanentemente a empresa e todos os dados de negócio vinculados após confirmação pelo nome exato.
- As migrações preparam empresas, vínculos de usuários, clientes e catálogo. O catálogo permite cadastrar, pesquisar, editar, ativar/desativar e arquivar produtos e serviços.
- Orçamentos recebem numeração sequencial por empresa, preservam os dados do cliente e snapshots dos itens, calculam os totais na API e permitem acompanhar as transições de status.
- Vendas recebem numeração sequencial por empresa, podem ser registradas diretamente ou convertidas de orçamentos aprovados, preservam os itens e clientes como snapshots, acompanham recebimentos parciais e geram comprovante PDF. Vendas e compras alimentam o Financeiro; compras e vendas movimentam saldos de estoque quando o produto está sendo controlado.
- O Financeiro acompanha receitas e despesas, vencimentos, pagamentos parciais, saldos pendentes e exportação CSV. Ele não substitui contabilidade, conciliação bancária ou emissão fiscal.
- A tela Despesas substitui Ordens de serviço no menu do cliente. Acompanha contas, categorias próprias, filtros, indicadores, pagamentos e cancelamento protegido; compartilha os lançamentos do Financeiro. Dados de ordens anteriores são preservados. Consulte `DESPESAS.md`. A agenda continua disponível.
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
- Vendas, recebimentos, recibos, despesas e outras operações habilitadas podem ser registrados offline após preparar o aparelho. Documentos locais permanecem provisórios até a confirmação. Edição/classificação/cancelamento de despesas, configurações e exclusões exigem conexão. Consulte `GUIA-OFFLINE.md`.
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

## Retomada de 26/10/2026

Categorias próprias de despesas exigem a migração `011_expense_categories.sql`, aplicada no Neon autorizado após backup verificado. Em outro ambiente, faça backup antes de migrar. Todos os PDFs numerados usam Nº; documentos já baixados devem ser gerados novamente.

Verificação isolada: `npm test`, `npm run test:commercial-db`, `node tests/auth-integration.mjs` e `npm run build:web`. A integração comercial utiliza banco descartável e não usa DATABASE_URL. O teste de autenticação usa assinatura temporária e JWKS local, sem conta Neon.

A homologação completa do login com conta real e de Android/iPhone físicos permanece pendente. Consulte `CONTINUIDADE.md` para o alcance e os limites da verificação.
