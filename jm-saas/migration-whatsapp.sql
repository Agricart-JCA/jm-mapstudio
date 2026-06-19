-- ================================================================
-- JM MapStudio — Integração WhatsApp: tabela de logs
-- Execute no Supabase: SQL Editor → New query → Run
--
-- Serve para: idempotência (não reprocessar reentregas do Meta),
-- rate limit (anti-flood) e auditoria das consultas.
-- ================================================================

create table if not exists public.whatsapp_logs (
  id             uuid        default gen_random_uuid() primary key,
  wa_message_id  text        unique not null,   -- id da mensagem no WhatsApp (dedup)
  from_phone     text        not null,          -- número do remetente
  tipo           text,                          -- location | text | ...
  conteudo       text,                          -- resumo (até 280 chars)
  created_at     timestamptz default now()
);

create index if not exists idx_walogs_phone on public.whatsapp_logs (from_phone, created_at desc);
create index if not exists idx_walogs_created on public.whatsapp_logs (created_at desc);

-- RLS: ninguém lê pelo cliente; só a Edge Function (service_role) escreve/lê.
alter table public.whatsapp_logs enable row level security;
-- (sem policies = nenhum acesso via anon/authenticated; service_role ignora RLS)

-- Limpeza opcional: apaga logs com mais de 90 dias (rode manualmente ou via cron)
-- delete from public.whatsapp_logs where created_at < now() - interval '90 days';

-- ================================================================
-- Sessões do WhatsApp: estado da conversa (menu guiado) + cota grátis
-- ================================================================
create table if not exists public.whatsapp_sessions (
  phone        text        primary key,        -- número do cliente (somente dígitos)
  estado       text        default '',          -- intenção pendente: aguard_car | aguard_sigef | aguard_municipio
  consultas    integer     default 0,           -- nº de consultas já feitas (cota grátis)
  assinante    boolean     default false,       -- cache: vinculado a assinante ativo
  primeiro_em  timestamptz default now(),
  ultimo_em    timestamptz default now()
);

create index if not exists idx_wasess_ultimo on public.whatsapp_sessions (ultimo_em desc);

alter table public.whatsapp_sessions enable row level security;
-- (sem policies; só service_role acessa)

-- Incrementa consultas de forma atômica e devolve o total (para a cota grátis)
create or replace function public.wa_inc_consulta(p_phone text)
returns integer
language plpgsql security definer as $$
declare v_total integer;
begin
  insert into public.whatsapp_sessions (phone, consultas, ultimo_em)
  values (p_phone, 1, now())
  on conflict (phone) do update
    set consultas = public.whatsapp_sessions.consultas + 1,
        ultimo_em = now()
  returning consultas into v_total;
  return v_total;
end;
$$;

-- ================================================================
-- RESULTADO ESPERADO:
-- whatsapp_logs (dedup) + whatsapp_sessions (estado + cota) + wa_inc_consulta().
-- ================================================================
