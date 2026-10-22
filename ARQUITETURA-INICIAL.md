# Arquitetura inicial — Sistema de Gestão para Serviços Elétricos

**Estado:** infraestrutura local inicial criada; Neon Auth escolhido para autenticação; hospedagem pendente  
**Base:** `gabarito do sistema.txt`  
**Data:** 21/10/2026

Este documento transforma o escopo mestre em uma primeira proposta técnica. Não configura serviços externos, não contém credenciais e não representa uma implantação pronta para produção. Decisões ainda não aprovadas estão marcadas como pendentes.

## Estado do projeto

O projeto agora tem uma interface React/Vite, identidade visual aplicada a partir da logo da empresa, API Express, cliente Neon Auth no frontend, validação de JWT via JWKS na API e executor de migrações PostgreSQL. As migrações definem empresas, vínculos de identidades externas, clientes, fornecedores e catálogo de produtos e serviços.

O login e a validação da sessão estão conectados ao Neon Auth. A API cria o espaço empresarial no primeiro acesso e implementa operações de clientes, fornecedores, catálogo, orçamentos, vendas e módulos operacionais, todas protegidas por vínculo ativo e escopo de `company_id`. As vendas geram contas a receber e movimentam produtos com estoque controlado; compras registram entrada, fornecedor e conta a pagar na mesma transação. Recebimentos e pagamentos parciais ficam em tabelas próprias. Ordens de serviço podem ser associadas a orçamentos ou vendas e registrar materiais usados. Agenda, convites de equipe, limite de cinco membros e histórico de atividades também usam o PostgreSQL. Documentos comerciais podem ser baixados ou compartilhados em PDF. A hospedagem continua pendente.

## Arquitetura proposta

- **Frontend:** React + Vite + JavaScript, PWA responsiva.
- **API:** Node.js + Express. O frontend acessa os dados exclusivamente pela API.
- **Persistência central:** PostgreSQL no Neon. O acesso usa conexão privada configurada no backend, com variáveis de ambiente e pool adequado ao serviço escolhido.
- **Separação por empresa:** cada entidade comercial contém `company_id`; a API deriva a empresa autorizada da sessão validada e aplica esse escopo em toda consulta e mutação. Não confiar em `company_id` enviado livremente pelo navegador.
- **Identificadores:** UUID para chaves internas; números comerciais sequenciais por empresa e tipo, gerados no backend dentro de transação e protegidos por restrição única.
- **Valores:** armazenar dinheiro em centavos inteiros ou `NUMERIC` com escala explícita; nunca usar ponto flutuante binário para cálculos financeiros. Regras de arredondamento serão definidas antes do módulo financeiro.
- **Auditoria:** registrar ator, empresa, horário, ação e referência do registro em ações sensíveis. Cancelamentos devem ser estados auditáveis, não exclusões físicas de documentos emitidos.
- **Offline:** banco local no dispositivo é uma fila/cache operacional, não a fonte definitiva compartilhada. Cada mutação pendente terá UUID/idempotency key, estado de sincronização e resultado de conflito. Não habilitar edição offline de operações cujo conflito possa causar efeitos financeiros ou de estoque sem regra explícita.

### Autenticação e hospedagem

Foi escolhido o Managed Better Auth do Neon, usando a URL base derivada do JWKS informado. O frontend obtém o token com o SDK oficial e a API valida assinatura, emissor, audiência e expiração usando a chave pública remota. Não existe segredo de autenticação no frontend. O cadastro atual é uma etapa de desenvolvimento; associação a empresa, convites e limite de contas precisam ser concluídos antes da abertura pública. A hospedagem do frontend e da API permanece em aberto.

## Modelo de dados inicial

Todas as tabelas de negócio devem incluir `id UUID`, `company_id UUID`, `created_at`, `updated_at` e, quando aplicável, `created_by`/`updated_by`. Chaves estrangeiras compostas com `company_id` ou validações equivalentes devem impedir vínculos entre empresas.

| Grupo | Entidades | Notas de integridade |
|---|---|---|
| Empresa e acesso | `companies`, `users` (ou identidade externa), `memberships`, `sessions` (se sessão própria) | Membership associa identidade à empresa; limite de cinco usuários validado no backend e sob concorrência. Não armazenar senha em texto puro. |
| Cadastros | `customers`, `suppliers`, `products`, `services`, `categories` | Arquivamento lógico; documento e contatos opcionais conforme regras de validação. |
| Documentos | `quotes`, `quote_items`, `sales`, `sale_items`, `service_orders`, `service_order_items` | Itens preservam descrição, unidade, quantidade, preço, desconto e total da emissão, mesmo após alteração do cadastro de origem. Documento guarda número, status e datas relevantes. |
| Numeração e conversão | `document_counters`, referências de origem (`source_quote_id`, quando aplicável) | Contador identificado por empresa e tipo; unicidade `(company_id, document_type, number)`. Conversões transacionais e idempotentes. |
| Estoque | `stock_movements`, `purchases`, `purchase_items` | Livro de movimentos; compras registram entradas, vendas e OS registram saídas. Estorno gera movimento compensatório, sem apagar histórico. |
| Financeiro | `financial_entries`, `financial_payments`, `sale_payments` | Receita/despesa/conta a pagar/receber com vencimento, competência, estado e documento vinculado. Pagamentos parciais geram registros rastreáveis. Parcelas programadas e recorrência ainda precisam de decisão e implementação. |
| Operação | `service_orders`, `service_order_items`, `appointments` | Ordens se associam a cliente, venda ou orçamento; agenda associa cliente e OS. Anexos continuam pendentes de decisão de armazenamento. |
| Auditoria e acesso | `audit_logs`, `company_invitations`, `company_memberships` | Registro de ações e convites com código de uso único armazenado como hash. A distribuição dos códigos é manual; e-mail transacional ainda não está conectado. |
| Sincronização | `idempotency_keys`, opcional `sync_changes` | Operações online usam transações. Estratégia offline com chave de idempotência, fila de alterações e resolução de conflito ainda está pendente. |

### Regras relacionais obrigatórias

1. Toda FK entre dados da empresa deve garantir o mesmo `company_id`.
2. Documentos emitidos guardam snapshots dos itens e dos dados do cliente necessários para leitura histórica.
3. Restrições únicas cobrem números de documentos, códigos internos não vazios quando definidos e chaves de idempotência.
4. Valores, quantidades e descontos têm limites e precisão definidos pela regra de negócio; o servidor recalcula totais.
5. Exclusão lógica é padrão para cadastros referenciados; exclusão física fica restrita a dados sem dependências e operações administrativas controladas.
6. Criação de documento, contador, itens e efeitos financeiros/estoque relacionados deve ser uma transação única quando fizer parte do mesmo comando comercial.
7. Índices iniciais devem cobrir `(company_id, status)`, datas de busca, FKs e campos usados em pesquisa. Índices serão refinados com consultas reais.

## Riscos e decisões antes da implementação

- Validar recuperação de acesso, expiração de sessão e limites do Neon Auth; escolher e documentar a hospedagem da aplicação.
- Definir estados/transições permitidos para orçamento, venda, ordem de serviço, conta financeira e cancelamento.
- Definir precisão e arredondamento de dinheiro, desconto, impostos (se aplicáveis) e parcelamento.
- Definir quais operações são permitidas offline e como resolver edição concorrente e exclusão/arquivamento.
- Definir política de backup e restauração e retenção de auditoria.
- Confirmar se compras e entradas de estoque fazem parte da primeira entrega ou de fase posterior.

## Próxima etapa sugerida

Configurar uma conexão de desenvolvimento ao PostgreSQL e aplicar a migração inicial; depois, validar o primeiro acesso empresarial e o fluxo completo do cadastro de clientes. A conexão real exige uma URL de desenvolvimento configurada somente em `apps/api/.env`, nunca incluída no repositório.
