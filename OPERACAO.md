# Operação e recuperação

## Rotina de backup

Execute o backup diariamente e antes de cada alteração de estrutura do banco:

```powershell
npm --prefix apps/api run db:backup
npm --prefix apps/api run db:verify-backup -- caminho\arquivo.json.gz.enc
```

O primeiro comando gera backup criptografado e checksum. Só considere a cópia pronta depois da verificação. Preserve a chave separadamente das cópias. Mantenha uma cópia verificada fora do computador que hospeda a API e defina retenção conforme o volume da operação. A aplicação não apaga backups automaticamente.

Valide periodicamente a restauração em banco separado, com as migrações aplicadas. Nunca aponte a rotina de ensaio para o banco utilizado pelo cliente. O teste automatizado `tests/backup.test.js` já verifica criptografia, chave incorreta, corrupção, restauração e rollback de uma restauração inválida em banco temporário.

A instalação de um agendamento no servidor depende do ambiente de hospedagem e não foi configurada neste trabalho. O projeto fornece os comandos de execução e validação; não há alegação de backup diário automático já ativo.

## Diagnóstico

- `/api/health`: configuração da API, banco e autenticação. Não faz teste de conexão com o banco.
- `/api/health/database`: testa a conexão com o PostgreSQL; use para checagens de disponibilidade com intervalo moderado.
- Respostas recebem `X-Request-Id`. Falhas HTTP 5xx geram registro estruturado com método, rota, código, duração e identificador; não registram corpo, senha ou token.
- O tratamento de falha de renderização mantém a navegação acessível e não apaga o banco local.

Alertas externos e monitoramento contínuo precisam ser conectados à infraestrutura onde a API é publicada. Nenhum serviço externo pago, agendamento local ou envio de mensagens foi criado automaticamente.

## Homologação antes da entrega

Conferir login, saída, renovação de sessão e recuperação de senha com conta real no ambiente final. Preparar e testar o aplicativo instalado em Android e iPhone físicos: venda, despesa, recebimento, PDF, encerramento/reabertura sem rede e sincronização. Os testes de navegador e banco temporário realizados não substituem essa conferência nos aparelhos do cliente.
