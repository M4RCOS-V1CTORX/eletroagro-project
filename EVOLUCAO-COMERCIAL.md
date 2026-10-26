# Evolução comercial e experiência de uso

## Diagnóstico e prioridades

O projeto utiliza React 18/Vite, Express e PostgreSQL, com autenticação Neon, permissões por área, filas offline selecionadas e documentos jsPDF. A navegação principal possui painel, clientes, catálogo, fornecedores, orçamentos, vendas, ordens de serviço, estoque/compras, financeiro, recibos, relatórios, agenda, histórico e configurações. Login, recuperação de senha, criação da empresa e convites completam os fluxos de acesso.

A revisão de estrutura identificou como prioridade a venda agrícola: faltavam transporte, frete próprio, numeração anual, prazo reutilizável e consulta financeira do cliente. O recebimento pelo Financeiro também não atualizava a venda correspondente. Esses problemas afetam cobrança e integridade dos saldos e foram tratados antes dos refinamentos visuais.

O trabalho mantém React, Express, PostgreSQL, a navegação e as cores existentes. A dependência PGlite é exclusiva de desenvolvimento e permite testar SQL e rotas sem credenciais ou banco remoto.

## Implementado

- Atividade Elétrica/Fazenda/Sem atividade definida em vendas, compras e lançamentos financeiros, com filtros e saldo de caixa por atividade no Financeiro. Registros antigos permanecem sem classificação, evitando atribuição incorreta.
- Veículo, placa, motorista e destino na venda e no documento; transportes podem ser salvos, selecionados e removidos sem modificar notas anteriores.
- Frete cobrado somado ao total: subtotal dos itens − desconto + frete. Custo interno do transporte gera conta a pagar distinta, sem aparecer no documento do cliente.
- Numeração por empresa e ano da data da venda. Notas antigas mantêm os números; o contador de cada ano começa acima dos números existentes. A virada de ano inicia uma nova sequência sem redefinir outros documentos.
- Duplicação mantém cliente, itens, valores e transporte para revisão, mas limpa recebimentos, vínculo com orçamento, identidade e numeração. A nova data é a do dia e o vencimento é recalculado.
- Prazo padrão por cliente, importado para venda e conversão de orçamento; alteração do prazo ou da data recalcula o vencimento, que continua ajustável.
- Atalho para banana prata anã de 1ª, 2ª e 3ª em kg. Reutiliza itens compatíveis do catálogo quando disponíveis; os itens avulsos são explicitamente editáveis, sem preços fictícios ou criação automática de cadastros.
- Extrato acessível pelo cadastro de clientes e detalhes da venda: notas paginadas, vencimentos, recebido, saldo e atraso. Cancelamentos são identificados e excluídos do resumo comercial.
- Nota de produtos com número/ano, transporte, vencimento, subtotal, desconto, frete, total, recebimentos, Pix, dados bancários e instruções configuráveis.
- Prévia em PDF, inclusive antes do cadastro, sem consumir número ou criar venda. PDFs longos respeitam margens e continuam nas páginas seguintes.
- Compartilhamento nativo com PDF e mensagem de cobrança. Atalho WhatsApp prepara mensagem; no computador o usuário deve baixar e anexar o PDF. Nenhuma mensagem é enviada automaticamente.
- Recebimentos pelo Financeiro e por Vendas atualizam ambos os históricos dentro da transação. Bloqueios seguem a mesma ordem para evitar disputas entre recebimento e cancelamento.
- Reenvio da mesma venda usa chave de idempotência. Chaves não podem recuperar respostas de outra rota; falhas de servidor liberam a chave para nova tentativa.
- Formulários com textos maiores, campos confortáveis em celular, extrato adaptado a cards, camadas corretas para prévia e modais, foco contido, Escape para fechar e retorno do foco. Preferência de redução de movimento existente preservada.
- Backup e restauração incluem transportes e contadores anuais; restauração de backups anteriores infere o ano e recompõe os contadores.

## Áreas preservadas e limites da revisão

Painel, catálogo, fornecedores, orçamentos, ordens, recibos, relatórios, agenda e histórico mantêm suas regras existentes. Os formulários e diálogos recebem os ajustes compartilhados de leitura e teclado. Referências de vendas em ordens passam a mostrar o ano. Isso não significa homologação exaustiva de todos os fluxos desses módulos: a verificação funcional concentra-se nas integrações afetadas por esta entrega.

Valores financeiros por atividade representam caixa e contas registradas, não lucro contábil ou custo completo da produção. Notas antigas não são renumeradas e a conversão de um orçamento continua limitada a uma venda. Cancelamento com custo de frete já pago é bloqueado para não apagar despesas liquidadas. Alterar a personalização dos documentos afeta PDFs gerados novamente, conforme o modelo atual do sistema.

## Verificação

```powershell
npm test
npm run test:commercial-db
npm run build:web
```

O segundo comando cria um PostgreSQL em memória, aplica as dez migrações e usa as rotas reais para conferir preservação de dados antigos, numeração anual, centavos, prazo, fretes, compras, filtros, pagamento nas duas telas, extrato, idempotência, cancelamento, isolamento empresarial, conversão de orçamento e estoque fracionado com estorno. Não lê DATABASE_URL.

Testes manuais automatizados em navegador local isolado cobriram 1440 px e 390 px: nova venda, prazo do cliente, atalho de banana, transporte salvo, frete, prévia, registro, duplicação, Escape, extrato e filtro financeiro. As imagens e PDFs de validação ficam em `tmp/pdfs/commercial/`, com dados exclusivos de teste. O PDF representativo foi conferido em uma página; o documento extenso foi gerado em seis páginas e a renderização das páginas foi inspecionada.

Para abrir a interface isolada de homologação: `node tests/commercial-integration.mjs --serve`, em seguida acesse `http://127.0.0.1:5188/qa`. Esse modo substitui apenas o cliente HTTP no servidor de testes e não faz parte do build publicado.

## Atualização do ambiente publicado

Após o diagnóstico do erro 500, o usuário autorizou explicitamente backup e migração no Neon usado pela API local. O backup criptografado foi criado em `apps/api/backups/` e validado por checksum; a migração 010 foi aplicada em 26/10/2026. A consulta de resumo foi repetida com sucesso. Nenhuma publicação do frontend foi realizada. Em outros ambientes, faça backup antes de aplicar:

```powershell
npm --prefix apps/api run db:migrate
```

A migração inclui um gatilho de compatibilidade: INSERTs da API anterior que não informam o ano recebem o ano da data de venda e um número do contador anual. Isso permite a coexistência durante a atualização. Os testes isolados verificam esse fluxo. Não reverta apenas o banco depois que notas com numeração anual forem emitidas: números iguais em anos diferentes são válidos no novo modelo.

## Refinamento da visão geral

O painel recebeu um cabeçalho mais organizado, resumo da operação, períodos em botões, indicadores clicáveis, saldo de caixa, lista de prioridades com destino correto por módulo, comparação de entradas e saídas, contas pendentes, atalhos, agenda e histórico. Tipografia e espaçamentos preservam as cores e a navegação originais. O componente foi separado em `OverviewPage.jsx` e seus estilos em `overview.css`.

A API do painel agora calcula contas a receber e a pagar por saldo efetivo, descontando pagamentos parciais sem duplicar lançamentos. Orçamentos vencidos são contados em toda a operação. O resumo diferencia resultados do período de pendências totais. A interface mantém os últimos dados em caso de erro e permite tentar novamente, descartando respostas antigas quando o período muda.

Foram verificados os layouts de 1440 px e 390 px, ausência de rolagem horizontal, seleção dos três períodos, atalhos, atualização, falha simulada e recuperação. Não houve erros JavaScript. A consulta do resumo de vendas também foi incluída na integração isolada.
