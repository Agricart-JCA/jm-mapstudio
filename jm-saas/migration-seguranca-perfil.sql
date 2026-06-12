-- ================================================================
-- JM MapStudio — CORREÇÃO CRÍTICA DE SEGURANÇA (assinatura)
-- Execute no Supabase: SQL Editor → New query → cole tudo → Run
--
-- PROBLEMA (confirmado em teste ao vivo em 2026-06-12):
--   Qualquer usuário logado conseguia liberar acesso grátis vitalício
--   editando o PRÓPRIO perfil via API:
--     PATCH /profiles?id=eq.<seu_id>  { "status":"active",
--                                        "trial_expires_at":"2099-12-31" }
--   A política antiga só travava a coluna "role"; deixava status,
--   trial_expires_at, plan_name e stripe_customer_id livres — que são
--   exatamente as colunas que o sistema usa pra liberar o acesso.
--
-- CORREÇÃO:
--   O usuário continua podendo editar name, phone e must_change_password,
--   mas TODAS as colunas que controlam acesso/cobrança ficam congeladas.
--   Só o Stripe webhook e os admins (que usam service_role, o qual ignora
--   RLS) podem alterá-las.
-- ================================================================

drop policy if exists "proprio_perfil_update" on public.profiles;

create policy "proprio_perfil_update" on public.profiles
  for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    -- Colunas que o usuário NÃO pode mudar (devem permanecer iguais ao valor atual):
    and role               is not distinct from (select p.role               from public.profiles p where p.id = auth.uid())
    and status             is not distinct from (select p.status             from public.profiles p where p.id = auth.uid())
    and trial_expires_at   is not distinct from (select p.trial_expires_at   from public.profiles p where p.id = auth.uid())
    and plan_name          is not distinct from (select p.plan_name          from public.profiles p where p.id = auth.uid())
    and stripe_customer_id is not distinct from (select p.stripe_customer_id from public.profiles p where p.id = auth.uid())
    and subscribed_at      is not distinct from (select p.subscribed_at      from public.profiles p where p.id = auth.uid())
    and email              is not distinct from (select p.email              from public.profiles p where p.id = auth.uid())
  );

-- ================================================================
-- TESTE DE VERIFICAÇÃO (rode depois, deve dar erro de RLS):
--   Logue como usuário comum e tente:
--   PATCH /profiles?id=eq.<id>  { "status":"active" }
--   Resultado esperado: "new row violates row-level security policy"
--
-- Enquanto isso, editar nome/telefone deve continuar funcionando:
--   PATCH /profiles?id=eq.<id>  { "name":"Novo Nome" }  → OK
-- ================================================================
