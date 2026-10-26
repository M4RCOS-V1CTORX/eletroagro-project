# Ponto de continuidade — 26/10/2026

Trabalho interrompido a pedido do usuário para envio ao GitHub.

Implementado: evolução comercial (transporte, frete, numeração anual), painel, armazenamento offline e PDFs no aparelho, sincronização idempotente e correção de conflitos, autenticação carregando .env antes das rotas, restauração criptografada transacional e diagnóstico de falhas HTTP 5xx, proteção de renderização dos módulos.

Verificado nesta sessão: build web; 27 testes anteriores e teste novo de restauração isolada; integração comercial isolada; middleware JWT com assinatura real temporária (token válido, inválido, expirado, emissor/audiência); navegador offline criando cadastros, venda, recebimento, recibo, compra, despesa, agenda e PDF; reabertura sem rede; perda de resposta após confirmação no servidor sem duplicação; falta de espaço sem gravação parcial; conflito real de estoque retido, corrigido e sincronizado; isolamento de fila por conta e saída offline.

Pendente: concluir revisão visual dos 14 módulos e PDFs; roteiro automatizado de telas precisa corrigir seletor de navegação (botões/links); homologar login completo com conta real; Android/iPhone físicos; documentação completa e rotina externa de backup/monitoramento; limites offline de orçamentos, ordens, exclusões e configurações. Não houve publicação ou restauração no banco real nesta sessão. Arquivos temporários e entrega/ existentes permanecem locais.
