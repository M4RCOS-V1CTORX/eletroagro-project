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

### Mudar para outro PostgreSQL

1. Gere e verifique um backup recente no banco atual. Guarde o `.json.gz.enc`, o `.sha256` e a chave `BACKUP_ENCRYPTION_KEY` em locais seguros e separados.
2. Crie um PostgreSQL vazio e compatível. Configure temporariamente `DATABASE_URL` para o **novo** banco, mantendo a mesma chave de criptografia. Confira o destino antes de qualquer comando de restauração.
3. Rode `npm --prefix apps/api run db:migrate` para criar o esquema completo no novo banco.
4. Rode `npm --prefix apps/api run db:restore -- caminho\arquivo.json.gz.enc --confirm=RESTORE`. Esse comando substitui os dados das tabelas da aplicação no banco apontado por `DATABASE_URL`; use somente o novo banco vazio e mantenha o antigo intacto durante a validação.
5. Compare contagens e totais de vendas, lançamentos, pagamentos e estoque. Teste login, consultas, PDFs e sincronização offline. Só então atualize a `DATABASE_URL` do ambiente de produção e reinicie a API.

O backup da aplicação cobre as tabelas listadas em `src/lib/backup.js`; a estrutura vem das migrações. Ele não exporta automaticamente usuários/credenciais geridos pelo serviço **Neon Auth**. Para manter os mesmos logins, preserve a instância de autenticação e sua configuração `NEON_AUTH_ISSUER` / `NEON_AUTH_JWKS_URL`, ou planeje uma migração separada do serviço de identidade. Registros locais ainda não sincronizados precisam ser enviados antes da troca, pois não estão no PostgreSQL.

## Diagnóstico

- `/api/health`: configuração da API, banco e autenticação. Não faz teste de conexão com o banco.
- `/api/health/database`: testa a conexão com o PostgreSQL; use para checagens de disponibilidade com intervalo moderado.
- Respostas recebem `X-Request-Id`. Falhas HTTP 5xx geram registro estruturado com método, rota, código, duração e identificador; não registram corpo, senha ou token.
- O tratamento de falha de renderização mantém a navegação acessível e não apaga o banco local.

Alertas externos e monitoramento contínuo precisam ser conectados à infraestrutura onde a API é publicada. Nenhum serviço externo pago, agendamento local ou envio de mensagens foi criado automaticamente.

## Homologação antes da entrega

Conferir login, saída, renovação de sessão e recuperação de senha com conta real no ambiente final. Preparar e testar o aplicativo instalado em Android e iPhone físicos: venda, despesa, recebimento, PDF, encerramento/reabertura sem rede e sincronização. Os testes de navegador e banco temporário realizados não substituem essa conferência nos aparelhos do cliente.
