# EletroAgro — validação offline e candidato à publicação

Data: 30/10/2026. Publicação não executada. Nenhum commit, push, alteração de credenciais, configuração de produção, esquema ou dado de produção.

## Resultado

68 testes automatizados passaram; a integração comercial com SQL real em PGlite isolado passou; 25 cenários no Microsoft Edge 156.0.4314.50 passaram. Build de produção e revisão de whitespace do diff passaram. A inicialização e os testes ocorreram fora do sandbox após comprovar que ele bloqueava o loopback/perfil temporário do navegador. Não foram desativadas proteções do sistema nem usado o perfil pessoal do usuário.

O modo offline continua parcial por desenho: operações suportadas funcionam após preparação. Administração, alterações de orçamento, certas alterações de despesas e relatórios novos continuam dependendo da rede. Sincronização usa aplicativo aberto, reconexão, retorno à janela e botão manual; não foi introduzida sincronização com aplicativo fechado nem repetição periódica ilimitada.

## Correções do produto

| Arquivo | Correção |
|---|---|
| `apps/web/src/apiClient.js:45` | Resultado da gravação local concluída não é convertido em falha pela atualização do indicador. Escritas com transporte incerto preservam a chave de idempotência e a conta original. |
| `apps/web/src/apiClient.js:9` | Contexto capturado e revalidado nas requisições, fila, recuperação, preparação, revisão e retorno de sincronização. Respostas antigas não são entregues à conta nova. |
| `apps/web/src/App.jsx:315` | Interface encerra sessão antes da espera remota. Novo envio de autenticação aguarda o término do logout, evitando que uma saída atrasada invalide uma entrada nova. Fila, snapshots e arquivos permanecem guardados. |
| `apps/web/src/App.jsx:117` | Retentativa ao voltar à janela, com conexão, usando a fila existente e suas proteções de concorrência e idempotência. Recusas não são reenviadas automaticamente. |
| `apps/web/src/offlineShell.js:1` | Preparação exige confirmação do worker de que o shell, a entrada atual e os recursos listados estão em cache. Falta de suporte/cache gera erro explícito. |
| `apps/web/public/service-worker.js:1` | Instalação incompleta não ativa o worker; handshake verifica recursos; navegação recupera cache em HTTP 5xx. API e autenticação continuam excluídas do cache. |
| `apps/web/vite.config.js:11` | Cache do worker recebe identificação derivada do código e arquivos do build. Atualizações entre builds instalam recursos novos sem alterar IndexedDB. |

Nenhuma alteração em `offlineStore.js`, versão do IndexedDB, formato dos registros, migrations ou rotas do backend. Arquivos e alterações preexistentes do usuário foram preservados.

## Matriz no navegador

| Grupo | Evidência aprovada |
|---|---|
| Preparação | Shell controlado e cache completo; manifesto indisponível impede declarar preparo pronto; recuperação posterior funciona. |
| Operações offline | Cadastro pela interface; venda, recebimento, recibo, despesa, compra, estoque e agenda. Mais 10 operações de edição/pagamento suportadas foram persistidas, recarregadas e sincronizadas. Ação não suportada foi recusada. |
| Persistência | Fechar/reabrir aba preservou 8 pendências, valores e arquivo. Encerrar e reiniciar o processo do Edge com perfil de teste em disco preservou exatamente snapshot, ID da pendência e arquivo. |
| Documentos | PDF real gerado sem rede, arquivado em IndexedDB e preservado após reload. |
| Quota | Falha injetada em gravação de snapshot não deixou fila ou saldo parcialmente alterados. |
| Reconexão | HTTP 503 manteve a fila; evento de foco recuperou o envio. |
| Idempotência | Resposta perdida após COMMIT produziu duas tentativas com a mesma chave e uma venda no banco isolado. COMMIT antes do logout também foi recuperado sem duplicar cadastro. |
| Conflitos | Recusa preservada sem reenvio automático; revisão e sincronização posteriores passaram. A integração comercial também validou regras e concorrência com SQL real. |
| Sessões | Logout durante token pendente não enviou a operação. Respostas de leitura/escrita atrasadas foram bloqueadas após troca de conta. Conta B não consultou nem enviou a fila de A. Logout remoto pendente ocultou dados e bloqueou novo envio de autenticação. |
| Retornos locais | Troca durante gravação do snapshot não entregou a preparação à sessão nova; recuperação/exportação não entregou dados da conta anterior. |
| Autenticação/rede | Falha de transporte com `navigator.onLine=true` usou snapshot. Sessão expirada permaneceu erro de autenticação e não foi convertida em confirmação de escrita offline. |
| Atualizações | Dois builds distintos, v1 e v2, atualizaram worker/cache, preservaram fila, snapshot e arquivo, reabriram a v2 offline e sincronizaram depois. |
| Navegação | HTTP 503 na página recuperou shell e sessão local. Perfil móvel 390×844 reabriu offline. |
| Candidato real | Build sem bridge de QA, com SDK Neon real, abriu offline usando dados fictícios no formato IndexedDB 3, cadastrou pela interface e preservou a pendência após reload. Chamadas externas foram bloqueadas antes da transmissão. |

Total: 10 cenários na matriz principal, 13 na matriz de fronteiras, 1 de reinício completo e 1 do candidato sem instrumentação. Todos passaram na execução final. As falhas intermediárias de infraestrutura e de espera do teste foram investigadas e corrigidas; não foram removidas assertions para obter aprovação.

## Evidências e reprodução

- `tmp/offline-20261030/browser-results.json`: matriz principal e ausência de erros não tratados da aplicação.
- `tmp/offline-20261030/browser-boundaries.json`: fronteiras e atualização entre builds. Cada contexto também verifica ausência de erros não tratados.
- `tmp/offline-20261030/browser-restart.json`: reinício completo do Edge.
- `tmp/offline-20261030/release-smoke.json`: candidato sem instrumentos de QA.
- `tmp/offline-20261030/release-integrity.json`: 43 arquivos, 37 recursos listados, ausência de código fictício e SHA-256 de cada arquivo.
- Capturas: `release-offline.png`, `updated-offline.png`, `full-browser-restart.png`, `mobile-offline.png`, na mesma pasta.

Comandos: `npm test`; `node tests/commercial-integration.mjs`; iniciar `node tests/qa-isolated-server.mjs` e, enquanto ele estiver ativo, executar `qa-offline-production.cjs`, `qa-offline-boundaries.cjs`, `qa-offline-restart.cjs` e `qa-release-smoke.cjs` em `tests/`. Servidor e Edge devem compartilhar o mesmo ambiente de rede. A matriz principal assume um banco fictício recém-inicializado. O script histórico `qa-auth-cache-diagnostic.cjs` documenta a investigação do endpoint fictício anterior e não integra a suíte final.

Na simulação inicial, `/qa/session` passava pelo service worker, impedindo que o bloqueio da página representasse a falha de autenticação pretendida. A infraestrutura passou a usar `/neon-auth/get-session`, como o caminho excluído de cache em produção, mantendo a assertion de fallback. A coleta anterior está em `auth-cache-diagnostic.json`.

## Limites e riscos residuais

- API, regras e transações testadas são as do projeto; banco é PGlite local em memória e identidades são fictícias. Não é uma homologação do PostgreSQL/Neon de produção.
- Login real, renovação real de JWT, cookies/domínios Neon e recuperação de senha não foram exercitados com credenciais reais. O SDK real foi incluído no build candidato e seu caminho offline foi testado, sem autenticar no serviço externo.
- Perfil móvel no Edge não equivale a Android ou iPhone físico; Safari/iOS e limites de armazenamento nesses dispositivos ainda precisam de homologação.
- O navegador de teste não confirmou armazenamento persistente. Os dados sobreviveram ao reinício, mas limpeza de dados, perda do dispositivo ou política de descarte do navegador continuam podendo remover dados não sincronizados.
- Dados locais não foram apagados nem passou a existir criptografia do IndexedDB. A proteção implementada separa identidades no aplicativo; não substitui a proteção do aparelho/perfil do navegador. Revogação remota de acesso não pode ser descoberta enquanto o dispositivo está desconectado.

## Publicação e rollback propostos — não executados

1. Revisar estes cinco arquivos do produto, testes e evidências; obter autorização explícita do usuário.
2. Publicar somente o projeto frontend existente, a partir de `apps/web`, preservando domínio, backend, variáveis, função de proxy de autenticação e rewrites atuais. O candidato estático está em `tmp/offline-20261030/release-final`; ele não contém a função serverless e não deve ser tratado como substituto completo do projeto frontend.
3. Não executar migration, limpeza de IndexedDB/fila nem solicitação de apagar dados do navegador. Conferir o login real e uma preparação/reabertura com conta de homologação autorizada, além dos recursos públicos do novo deployment.
4. Em regressão, promover a implantação anterior do frontend. Manter o backend e os dados locais intactos. O formato de banco local e das pendências não mudou, permitindo leitura pela versão anterior. Não usar limpeza de cache/dados como procedimento de rollback.

O cache do candidato final é `eletroagro-shell-034e3c4e7410e25a`. Nenhuma falha funcional conhecida permanece aberta nos cenários executados. A aprovação de publicação deve considerar os limites de homologação acima.
