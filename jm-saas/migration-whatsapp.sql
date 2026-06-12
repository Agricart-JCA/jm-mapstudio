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
-- RESULTADO ESPERADO:
-- Tabela whatsapp_logs criada, com unique em wa_message_id (dedup).
-- ================================================================
