-- ================================================================
-- JM MapStudio — CORREÇÃO CRÍTICA DE SEGURANÇA RLS  (Tarefa 1)
-- Rodar no Supabase → SQL Editor → colar TUDO → Run
--
-- Fecha 2 furos confirmados em teste ao vivo (jul/2026):
--   1) profiles: usuário comum ativava a própria assinatura editando
--      status / trial_expires_at / plan_name via API (bypass do paywall).
--   2) plantas:  usuário inseria planta já com status='aprovado',
--      burlando a moderação.
--
-- PRINCÍPIO: o cliente NUNCA escreve campo de privilégio/pagamento.
-- Só o Stripe webhook e a função activate-trial (ambos service_role,
-- que ignora RLS e privilégios de coluna) alteram esses campos.
--
-- ⚠ ORDEM OBRIGATÓRIA — rode esta migração SOMENTE DEPOIS de:
--    (a) deploy do frontend que parou de enviar 'status' no cadastro;
--    (b) deploy da activate-trial já usando service_role no UPDATE.
--    Caso contrário, cadastro e trial quebram para novos usuários.
-- ================================================================

-- 1) PROFILES — congela colunas de acesso/cobrança no update do PRÓPRIO perfil.
--    O usuário continua editando name, phone e must_change_password.
drop policy if exists "proprio_perfil_update" on public.profiles;
create policy "proprio_perfil_update" on public.profiles
  for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and role               is not distinct from (select p.role               from public.profiles p where p.id = auth.uid())
    and status             is not distinct from (select p.status             from public.profiles p where p.id = auth.uid())
    and trial_expires_at   is not distinct from (select p.trial_expires_at   from public.profiles p where p.id = auth.uid())
    and plan_name          is not distinct from (select p.plan_name          from public.profiles p where p.id = auth.uid())
    and stripe_customer_id is not distinct from (select p.stripe_customer_id from public.profiles p where p.id = auth.uid())
    and subscribed_at      is not distinct from (select p.subscribed_at      from public.profiles p where p.id = auth.uid())
    and email              is not distinct from (select p.email              from public.profiles p where p.id = auth.uid())
  );

-- 2) PROFILES — trava NATIVA de coluna (defesa em profundidade).
--    'role' NÃO entra: o admin troca papéis pelo frontend (RLS admin_perfis_update).
--    'email' NÃO entra: coberto pelo with-check acima; simplifica.
--    Estas 5 colunas só o service_role escreve (webhook / activate-trial):
revoke update (status, plan_name, trial_expires_at, stripe_customer_id, subscribed_at)
  on public.profiles from authenticated, anon;

-- 3) PLANTAS — o INSERT do cliente só entra como 'pendente' e sem moderação.
--    (O upload real passa pela Edge Function upload-planta, que usa service_role
--     e não é afetada por esta política.)
drop policy if exists "plantas_insert" on public.plantas;
create policy "plantas_insert" on public.plantas
  for insert
  with check (
    auth.uid() = contribuidor_id
    and status = 'pendente'
    and moderado_por is null
    and moderado_em  is null
  );

-- 4) Limpeza dos artefatos criados durante os testes de segurança
--    (plantas de teste que ficaram públicas indevidamente).
delete from public.plantas where titulo in ('RLSTEST','SECTEST');

-- ================================================================
-- VERIFICAÇÃO (esperado APÓS aplicar):
--   • UPDATE do próprio profiles com status/trial/plan → erro RLS/permissão
--   • UPDATE do próprio profiles com role='admin'      → erro RLS
--   • INSERT/UPDATE em subscriptions pelo cliente       → erro RLS
--   • INSERT em plantas com status='aprovado'           → erro RLS
--   • Editar name/phone do próprio perfil               → OK
--   • Botão "Testar grátis" (activate-trial)            → OK (via service_role)
-- Rode: node tests/rls-paywall.mjs  → as 4 tentativas devem FALHAR.
-- ================================================================
