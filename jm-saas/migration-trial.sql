-- ================================================================
-- JM MapStudio — Migração: trial gratuito
-- Execute no Supabase: SQL Editor → New query → Run
-- ================================================================

-- 1. Adicionar coluna trial_expires_at
alter table public.profiles
  add column if not exists trial_expires_at timestamptz default null;

-- 2. Atualizar check constraint de status para incluir 'trial'
alter table public.profiles
  drop constraint if exists profiles_status_check;
alter table public.profiles
  add constraint profiles_status_check
  check (status in ('pending', 'active', 'inactive', 'trial'));

-- 3. Verificar resultado
select id, name, email, status, trial_expires_at
from public.profiles
order by created_at desc
limit 10;

-- ================================================================
-- RESULTADO ESPERADO:
-- profiles agora tem coluna trial_expires_at (timestamptz, nullable)
-- status aceita: pending | active | inactive | trial
-- ================================================================
