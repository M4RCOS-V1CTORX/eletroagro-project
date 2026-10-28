# Revisão empresarial do EletroAgro — 28/10/2026

## Implementado

- Empresa: endereço completo editável e recuperado; inclusão nos documentos com cabeçalho compartilhado e orçamento.
- Vendas: atividade Fornecedor; despesas: novo formulário com Fornecedor/Fazenda; compras: Compra/Venda. Valores antigos continuam válidos e não foram reclassificados.
- Contas a pagar e receber: tela sobre `financial_entries` e `financial_payments` existentes, evitando criar um segundo lançamento para a mesma venda ou compra.
- Relatórios: oito categorias reais, filtros aplicáveis por período/atividade/categoria, PDFs separados, paginação, nome/endereço da empresa e autorização de exportação no servidor.
- Segurança: perfis compartilhados, permissões por módulo/ação, proteção nas APIs, revogação efetiva na requisição seguinte, menor privilégio em novos convites e restrição de dados em painel e snapshot offline.
- Agenda: visualizações dia/semana/mês/lista, pesquisa, filtros, prioridade, responsável, fornecedor, edição, cancelamento e exclusão lógica com histórico; verificação de conflito por responsável.
- Histórico: busca, filtros por ação/tipo/período, paginação e detalhes. Configurações agrupadas por assunto. Indicador técnico “API conectada” removido da interface; falhas funcionais continuam visíveis.
- Financeiro: recebimentos/pagamentos em período calculados pela data efetiva do pagamento, mesmo quando o vencimento pertence a outro mês. Cancelamento de venda com recebimento confirmado exige regularização prévia.
- Backup: rotina criptografada corrigida para uma transação consistente; verificação de checksum e descriptografia disponível.

## Banco de dados

Migrações 012 e 013 aplicadas no Neon após backup criptografado verificado. Contagens, valores financeiros e movimentos de estoque conferidos sem divergência. Backup manual adicional da rotina corrigida: `apps/api/backups/eletroagro-2026-10-28T15-58-59Z.json.gz.enc`, verificado com 30 tabelas. Nenhuma troca de banco foi feita. Backups e chaves são ignorados pelo Git.

## Validação executada

- 31 testes unitários aprovados; integração comercial em PostgreSQL isolado aprovada, incluindo saldo, idempotência, relatórios, permissões, revogação, agenda e isolamento de empresas.
- 15 telas conferidas nas larguras 1440 px e 390 px, sem erros de JavaScript, falhas de API nem transbordamento horizontal na navegação testada.
- Oito PDFs categorizados gerados com dados isolados; abertura, extração de texto, categoria e endereço verificados. PDFs comerciais longos renderizados e inspecionados.
- Ciclo offline em navegador: preparação, cadastro, venda, recebimento, recibo, despesa, compra, agenda, reabertura sem rede e reenvio idempotente após perda de resposta.
- Compilação web aprovada após as alterações.

## Limitações operacionais

- Backups diários automáticos e cópia externa precisam ser configurados no ambiente de operação. A restauração deve ser ensaiada periodicamente em banco separado.
- O teste offline foi feito em navegador emulado no computador; a instalação e o armazenamento em aparelho físico Android/iOS dependem de validação no dispositivo do cliente.
- O serviço Neon Auth e seus usuários não fazem parte do backup SQL da aplicação. Uma eventual troca de provedor de identidade exigirá plano próprio.
- A publicação na Vercel e os acessos com contas reais do cliente exigem verificação após o deploy; os testes citados usaram dados controlados.
