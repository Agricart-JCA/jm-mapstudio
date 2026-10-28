# MELHORIAS — fora de escopo (anotado, não executado)

Itens notados durante o trabalho que **não são escopo agora**. Não mexer sem combinar.

## Higiene / infra
- **Pasta `functions/` na raiz é duplicata morta** de `supabase/functions/` e os arquivos **diferem**. A que deploya é `supabase/functions/`. Apagar a `functions/` da raiz pra ninguém editar/deployar a errada. (Rastreada no git.)
- **`APP_URL` do stripe-webhook** tem default stale: `https://agricart-jca.github.io/jm-mapstudio`. Os links dos e-mails de acesso saem errados se o env `APP_URL` não estiver setado. Setar `APP_URL` pro domínio real (hoje `https://jm-saas.vercel.app`, depois `app.jmtopografiaeng.com` / `fazendascan.com.br`).
- **CDNs sem versão fixa** (ex.: shpjs em `@latest`) — dependência que muda sozinha em produção. Pinar versão (Tarefa 7).
- **Repo ainda se chama `jm-mapstudio`** e o Vercel é `jm-saas` — infra, pode ficar; só o produto virou FazendaScan.

## Marca / domínio (FazendaScan)
- **Registrar `fazendascan.com.br`** (registro.br) e `fazendascan.com` — estavam livres em 2026-10.
- **Checar/registrar marca no INPI** (classe 9 e 42) antes de gastar em logo/anúncio.
- Quando `fazendascan.com.br` estiver apontando pro app, trocar o crédito de exportação no `index.html` (hoje `jmtopografiaeng.com`) e o `APP_URL`.
- **Landing da scratchpad (artifact) é separada** da `jm-saas/landing.html` do repo. Se usar a artifact em anúncio, renomear lá também.

## Dados
- **SIGEF só cobre RJ.** Generalizar pra nacional (ver [docs/roadmap-dadosfazenda.md](docs/roadmap-dadosfazenda.md), Fase 1 — conecta com a Tarefa 6 de cache de dados gov).

## Limpeza de teste
- Usuários de teste criados nas auditorias de segurança (`rlstest-*`, `trialtest-*` em Auth) podem ser apagados. As plantas de teste já foram removidas pela migração.
