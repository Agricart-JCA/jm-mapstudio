-- ================================================================
-- JM MapStudio — Migração: must_change_password
-- Execute no Supabase: SQL Editor → New query → Run
-- Objetivo: controlar se o usuário precisa definir senha no 1º acesso
-- ================================================================

-- 1. Adicionar coluna (idempotente — não quebra se já existir)
alter table public.profiles
  add column if not exists must_change_password boolean default false;

-- 2. Atualizar RLS: usuário pode ler própria flag de troca de senha
--    (já coberto pela policy "proprio_perfil_select" existente)

-- 3. Atualizar policy de update para permitir que o usuário limpe a flag
--    (já coberto pela "proprio_perfil_update" existente)
--    Mas precisamos garantir que o usuário possa setar must_change_password = false

-- Recriar a policy de update para incluir must_change_password
drop policy if exists "proprio_perfil_update" on public.profiles;
create policy "proprio_perfil_update" on public.profiles
  for update using (auth.uid() = id)
  with check (
    auth.uid() = id
    -- Usuário pode mudar qualquer campo EXCETO role (role permanece o mesmo)
    and role = (select p.role from public.profiles p where p.id = auth.uid())
  );

-- 4. Trigger: ao criar usuário via admin (webhook), o trigger já copia
--    name/email/phone. O webhook fará upsert posterior com must_change_password=true.
--    Mas para cobrir o caso do trigger rodando antes do upsert do webhook:
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, email, phone, role, status, must_change_password)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    coalesce(new.raw_user_meta_data->>'phone', null),
    coalesce(new.raw_user_meta_data->>'role', 'operador'),
    'pending',
    false  -- o webhook fará upsert com must_change_password=true para usuários novos
  )
  on conflict (id) do update set
    email               = excluded.email,
    phone               = coalesce(excluded.phone, public.profiles.phone),
    name                = coalesce(excluded.name,  public.profiles.name),
    must_change_password = public.profiles.must_change_password; -- preserva o valor existente
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 5. Garantir que usuários existentes não precisem trocar senha
update public.profiles set must_change_password = false
where must_change_password is null;

-- 6. Verificar resultado
select id, name, email, role, status, must_change_password
from public.profiles
order by created_at desc
limit 20;

-- ================================================================
-- RESULTADO ESPERADO:
-- profiles agora tem coluna must_change_password (boolean, default false)
-- Novos usuários criados pelo webhook terão must_change_password = true
-- Quando usuário troca a senha, o frontend seta must_change_password = false
-- ================================================================
