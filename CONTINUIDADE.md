# Continuidade e verificação — 26/10/2026

## Concluído nesta retomada

- Ordens de serviço substituídas por Despesas no menu e nos atalhos, preservando os dados antigos.
- Tela de Despesas com filtros combinados, paginação, indicadores dos resultados completos, cadastro, edição protegida, detalhes, pagamentos parciais/totais e cancelamento com confirmação.
- Categorias próprias no cadastro/edição e classificação de registros pagos ou integrados sem alterar valores. Filtro e armazenamento offline mantêm a categoria.
- Formulários e componentes visuais compartilhados com o Financeiro. Sem reconstrução de telas existentes.
- Nº em notas, orçamentos, recibos e PDFs operacionais antigos, inclusive páginas de continuação e referências. Correções de rodapé/assinaturas de orçamento e campos longos de cliente/responsável na OS preservada.
- Documentação do offline e das despesas atualizada.

## Testes executados

- 30 testes aprovados, incluindo backup/restauração isolada e filtros financeiros offline em centavos.
- Integração comercial e de despesas em PostgreSQL temporário: filtros, indicadores, paginação, edição com preservação, versão antiga recusada, pagamentos, cancelamento, categorias e isolamento entre empresas/perfis.
- JWT real com chave temporária/JWKS local: ausência, corrupção, expiração, emissor e audiência inválidos bloqueados. Não substitui homologação do login com conta Neon real.
- Navegador: todos os 14 módulos em 1440 e 390 px; sem erros JavaScript, falhas de consulta ou rolagem horizontal da página.
- Fluxo da nova tela: cadastro, edição, detalhes, pagamento parcial, classificação, cancelamento e filtros. Paginação com 28 despesas mantém totais do conjunto inteiro.
- Despesa e pagamento pela interface sem internet, com confirmação única na reconexão e categoria preservada.
- Ciclo offline completo: cadastros, venda, recebimento, recibo, despesa, compra, agenda, PDF, fechamento/reabertura sem rede e perda de resposta após gravação sem duplicar.
- Falta de espaço reverte fila e snapshot juntos; conflito real de estoque é retido, corrigido e sincronizado; isolamento de contas e saída offline.
- PDFs de nota, nota extensa, orçamento, OS histórica, recibo e relatório renderizados e inspecionados. Evidências de teste permanecem em tmp/pdfs/ e não contêm dados do cliente.

## Banco e autorização

O usuário autorizou backup e migração 011. Backup AES-GCM e checksum verificados em apps/api/backups/eletroagro-2026-10-26T21-14-57Z.json.gz.enc (ignorado pelo Git). Aplicação exclusiva da 011 conferiu a nova coluna e preservação das contagens e somas financeiras. Não houve restauração de dados reais ou publicação de frontend nesta retomada. O envio ao GitHub foi novamente autorizado pelo usuário.

## Limites que dependem de ambiente ou aparelho

- Testar login completo, saída, recuperação de senha e renovação Neon com conta real no ambiente final.
- Homologar Android e iPhone físicos, armazenamento/persistência e abertura pela instalação publicada em HTTPS.
- Criação/edição de orçamentos, edição/classificação/cancelamento de despesas e configurações/exclusões exigem conexão; o modo offline não promete todas as ações administrativas.
- A cópia de recuperação offline exporta dados, mas ainda não oferece importação automática nem inclui blobs dos anexos.
- Diagnóstico 5xx e endpoints de saúde estão implementados; agenda externa de backups e alertas do provedor dependem da infraestrutura de publicação.
- A nota comercial não é emissão de NF-e/NFC-e.

Arquivos preexistentes entrega/ e temporários foram preservados. Nenhuma limpeza destrutiva foi realizada.
