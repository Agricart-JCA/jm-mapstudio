-- ================================================================
-- JM MapStudio — Supabase Schema
-- Execute este SQL no painel do Supabase: SQL Editor → New query
-- ================================================================

-- Tabela de perfis (complementa auth.users)
create table if not exists public.profiles (
  id               uuid references auth.users on delete cascade primary key,
  name             text not null default 'Usuário',
  role             text not null default 'operador'
                   check (role in ('admin', 'operador', 'visualizador')),
  stripe_customer_id text unique,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- Tabela de assinaturas (espelha dados do Stripe)
create table if not exists public.subscriptions (
  id                    text primary key,  -- ID da assinatura no Stripe
  user_id               uuid references auth.users on delete cascade not null,
  status                text not null,     -- active, trialing, past_due, canceled, etc.
  price_id              text not null,
  plan_name             text not null default 'mensal',  -- mensal ou anual
  current_period_start  timestamptz,
  current_period_end    timestamptz,
  cancel_at_period_end  boolean default false,
  stripe_customer_id    text,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

-- ── Row Level Security ──────────────────────────────────────────
alter table public.profiles      enable row level security;
alter table public.subscriptions enable row level security;

-- Usuário lê/atualiza próprio perfil
create policy "proprio_perfil_select" on public.profiles
  for select using (auth.uid() = id);

create policy "proprio_perfil_update" on public.profiles
  for update using (auth.uid() = id);

-- Admin lê todos os perfis
create policy "admin_perfis_select" on public.profiles
  for select using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- Admin atualiza qualquer perfil (mudar roles)
create policy "admin_perfis_update" on public.profiles
  for update using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- Usuário lê própria assinatura
create policy "proprio_sub_select" on public.subscriptions
  for select using (auth.uid() = user_id);

-- Admin lê todas as assinaturas
create policy "admin_subs_select" on public.subscriptions
  for select using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- ── Trigger: criar perfil automaticamente ao criar usuário ──────
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'operador')
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── Admin inicial ───────────────────────────────────────────────
-- ATENÇÃO: Após criar sua conta no Supabase Auth, rode o comando
-- abaixo substituindo o email pelo seu (isso te dá role admin):
--
-- update public.profiles set role = 'admin'
-- where id = (select id from auth.users where email = 'juancarlos.agricart@gmail.com');
