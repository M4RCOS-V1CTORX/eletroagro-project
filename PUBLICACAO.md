# Endereço publicado e autenticação

Endereço do sistema para a equipe: https://eletroagro-project.vercel.app/app

## Acesso restrito e consulta pública

- A raiz `/` mostra somente a orientação para ler uma etiqueta, sem login nem cadastro.
- `/rastrear/:publicId` permanece público e preserva os links já distribuídos.
- `/app` abre o acesso da equipe. Conhecer esse endereço não concede acesso aos dados.
- O cadastro livre está desabilitado no Neon Auth (`disable_sign_up=true`) e é
  bloqueado também pelo proxy `/neon-auth`. Login e recuperação de senha permanecem ativos.
- Esse bloqueio foi verificado para e-mail e senha. Há um provedor Google
  configurado; a verificação de admissão por esse caminho permanece pendente.
  Não considerar a revisão completa de autenticação concluída até fechar essa pendência.
- Novas contas precisam ser provisionadas pelo administrador no Neon. Depois,
  a pessoa define a senha pelo fluxo de recuperação e aceita o convite da empresa
  com o mesmo e-mail. Não desabilite todo o Neon Auth para fechar o cadastro.
- O convite da empresa autoriza o vínculo e suas permissões; ele não cria uma
  conta de autenticação. Convites expirados, revogados ou destinados a outro e-mail
  continuam sendo recusados pela API.
- A criação de novos espaços exige o e-mail em `COMPANY_CREATION_ALLOWED_EMAILS`,
  variável privada da API, separada por vírgulas. Sem configuração, a API recusa
  essa operação. Nunca use prefixo `VITE_` para essa liberação.
- Links antigos de convite e recuperação na raiz são encaminhados a `/app`
  mantendo os parâmetros. Novos convites e recuperações já usam `/app`.
- O manifesto instalável passa a iniciar em `/app`; atalhos antigos para `/`
  precisam ser atualizados. Não limpe IndexedDB nem dados locais para trocar o atalho.

Provisionamento administrativo pelo CLI já autenticado, sem divulgar credenciais:

```powershell
neon neon-auth user create --project-id flat-heart-79480674 --branch production --email pessoa@example.com --name "Pessoa autorizada"
```

Cada criação exige autorização explícita. Confirme o projeto e o e-mail antes
de executar; a linha acima é um exemplo, não cria uma conta automaticamente.
O responsável da empresa envia o convite pela tela de equipe após essa liberação.
Para conferir o bloqueio de inscrições:

```powershell
neon neon-auth config email-password get --project-id flat-heart-79480674 --branch production
```

Validação isolada: `node tests/qa-access-restrictions.mjs` e
`node tests/qa-public-origin.mjs`. Os testes não utilizam contas reais.

O endereço com hash de implantação, como `eletroagro-project-emjrh4q8p-n4-sh.vercel.app`, é uma prévia. A proteção da Vercel, a lista de origens da API e os domínios confiáveis do Neon são controles diferentes.

## Diagnóstico de 26/10/2026

- Manifesto da prévia: HTTP 302 para `vercel.com/sso-api`, exigindo autenticação Vercel.
- API `/api/health`: HTTP 200, mas sem cabeçalho CORS para a origem de prévia; a origem de produção recebe `Access-Control-Allow-Origin` correspondente.
- Neon sign-in: origem de prévia recebe HTTP 403 `INVALID_ORIGIN`. A origem de produção chega à verificação das credenciais; uma conta fictícia em domínio `.invalid` retorna o esperado HTTP 401 `INVALID_EMAIL_OR_PASSWORD`. Não foi usada conta real.
- Manifesto e consulta anônima de sessão no domínio de produção: HTTP 200.

## Ajustes no código

O link do manifesto usa `crossorigin="use-credentials"`, permitindo enviar a sessão Vercel quando houver autorização para visualizar uma prévia protegida. Isso não torna a prévia pública nem concede acesso a quem não estiver autorizado.

O formulário traduz `INVALID_ORIGIN` para uma orientação em português com o endereço de produção. Não foram alterados os fluxos de senha, criação de conta, validação JWT ou recuperação.

Não libere genericamente `*.vercel.app`, não use CORS `*` para corrigir esse caso e não remova o cabeçalho Origin no proxy de autenticação. Caso uma prévia específica precise de login, sua origem exata precisa ser autorizada separadamente na API (`WEB_ORIGIN`) e no Neon Auth (Trusted Domains), mantendo a proteção de acesso da Vercel conforme o público pretendido.

A conferência com conta real continua necessária para homologar o acesso completo. O domínio público responde corretamente às consultas e à validação do endpoint; isso não comprova uma sessão autenticada de um usuário real.
