# Endereço publicado e autenticação

Endereço para o cliente: https://eletroagro-project.vercel.app/

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
