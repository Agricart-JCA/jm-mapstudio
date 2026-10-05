-- ================================================================
-- Portal do Cliente: papel 'cliente' + tabela de arquivos entregues
-- ================================================================
-- Rodar no SQL Editor do Supabase (projeto zzjizqiafnnuqmrkhjqj).
-- Pré-requisito: public.is_admin() já existe (migration-cadastro.sql).
-- ================================================================

-- 1. Adiciona 'cliente' aos papéis permitidos em profiles.role
-- (acha o nome real do constraint em vez de assumir 'profiles_role_check',
--  já que supabase-schema.sql:11 cria o check inline, sem nome explícito)
do $$
declare
  v_nome text;
begin
  select conname into v_nome
  from pg_constraint
  where conrelid = 'public.profiles'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%role%';

  if v_nome is not null then
    execute format('alter table public.profiles drop constraint %I', v_nome);
  end if;

  alter table public.profiles add constraint profiles_role_check
    check (role in ('admin', 'operador', 'visualizador', 'cliente'));
end $$;

-- 2. Helper is_staff() — admin ou operador (evita recursão RLS, mesmo padrão de is_admin())
create or replace function public.is_staff()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'operador')
  );
$$;

-- 3. Tabela de arquivos entregues a cada cliente
create table if not exists public.cliente_arquivos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.profiles(id) on delete cascade,
  criado_por uuid not null references public.profiles(id),
  titulo text not null,
  tipo text not null check (tipo in ('memorial', 'planta', 'relatorio', 'kml', 'outro')),
  url text not null,
  storage_path text,
  created_at timestamptz not null default now()
);

create index if not exists idx_cliente_arquivos_cliente on public.cliente_arquivos (cliente_id);

alter table public.cliente_arquivos enable row level security;

drop policy if exists cliente_arquivos_select_own on public.cliente_arquivos;
create policy cliente_arquivos_select_own on public.cliente_arquivos
  for select using (cliente_id = auth.uid());

drop policy if exists cliente_arquivos_staff_all on public.cliente_arquivos;
create policy cliente_arquivos_staff_all on public.cliente_arquivos
  for all using (public.is_staff()) with check (public.is_staff());

-- Cliente nunca escreve/edita/apaga diretamente (sem policy de insert/update/delete pra ele;
-- toda escrita passa pela edge function upload-cliente-arquivo com service_role).
