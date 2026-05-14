-- ================================================================
-- JM MapStudio — Migração: suporte ao fluxo de cadastro antes do pagamento
-- Execute no Supabase: SQL Editor → New query → Run
-- ================================================================

-- 1. Adicionar colunas em profiles (se ainda não existirem)
alter table public.profiles
  add column if not exists phone        text,
  add column if not exists status       text default 'pending',
  add column if not exists plan_name    text,
  add column if not exists subscribed_at timestamptz,
  add column if not exists email        text;  -- cópia do email para facilitar queries admin

-- 2. Atualizar check constraint do status
alter table public.profiles
  drop constraint if exists profiles_status_check;
alter table public.profiles
  add constraint profiles_status_check
  check (status in ('pending', 'active', 'inactive'));

-- 3. Índices para performance
create index if not exists idx_profiles_stripe  on public.profiles (stripe_customer_id);
create index if not exists idx_profiles_status  on public.profiles (status);
create index if not exists idx_subs_user        on public.subscriptions (user_id);
create index if not exists idx_subs_status      on public.subscriptions (status);

-- 4. Função is_admin() para evitar recursão RLS
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- 5. Recriar políticas RLS sem recursão
-- Remover antigas
drop policy if exists "proprio_perfil_select"  on public.profiles;
drop policy if exists "proprio_perfil_update"  on public.profiles;
drop policy if exists "admin_perfis_select"    on public.profiles;
drop policy if exists "admin_perfis_update"    on public.profiles;
drop policy if exists "proprio_sub_select"     on public.subscriptions;
drop policy if exists "admin_subs_select"      on public.subscriptions;

-- Profiles: usuário lê/atualiza próprio perfil
create policy "proprio_perfil_select" on public.profiles
  for select using (auth.uid() = id);

-- Profiles: usuário pode atualizar próprio perfil, mas NÃO pode mudar role
create policy "proprio_perfil_update" on public.profiles
  for update using (auth.uid() = id)
  with check (
    auth.uid() = id
    and role = (select p.role from public.profiles p where p.id = auth.uid())
  );

-- Profiles: admin lê todos (via função SECURITY DEFINER, sem recursão)
create policy "admin_perfis_select" on public.profiles
  for select using (public.is_admin());

-- Profiles: admin atualiza qualquer perfil
create policy "admin_perfis_update" on public.profiles
  for update using (public.is_admin());

-- Subscriptions: usuário lê própria assinatura
create policy "proprio_sub_select" on public.subscriptions
  for select using (auth.uid() = user_id);

-- Subscriptions: admin lê todas
create policy "admin_subs_select" on public.subscriptions
  for select using (public.is_admin());

-- 6. Atualizar trigger para salvar phone no cadastro
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, email, phone, role, status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    coalesce(new.raw_user_meta_data->>'phone', null),
    coalesce(new.raw_user_meta_data->>'role', 'operador'),
    'pending'
  )
  on conflict (id) do update set
    email  = excluded.email,
    phone  = coalesce(excluded.phone, public.profiles.phone),
    name   = coalesce(excluded.name,  public.profiles.name);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 7. Garantir que o admin Juan tem role correto
update public.profiles set role = 'admin', status = 'active'
where email = 'juancarlos.agricart@gmail.com';

-- ================================================================
-- RESULTADO ESPERADO:
-- profiles tem: id, name, email, phone, role, status,
--               plan_name, subscribed_at, stripe_customer_id,
--               created_at, updated_at
-- RLS sem recursão usando is_admin()
-- Trigger salva phone e email automaticamente no signup
-- ================================================================
