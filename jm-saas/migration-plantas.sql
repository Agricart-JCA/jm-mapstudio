-- ================================================================
-- JM MapStudio — Biblioteca de Plantas Colaborativa
-- Execute no Supabase: SQL Editor → New query → Run
-- ================================================================

-- 1. Tabela principal de plantas
create table if not exists public.plantas (
  id              uuid        default gen_random_uuid() primary key,
  titulo          text        not null,
  descricao       text,
  municipio       text        not null,
  bairro          text,
  uf              text        default 'RJ',
  data_aproximada text,        -- ex: "1965", "Década de 70"
  tipo            text        default 'planta',
                               -- planta | mapa | croqui | levantamento | foto_aerea
  pdf_url         text,        -- URL pública (storage ou externa)
  storage_path    text,        -- path interno no Supabase Storage
  thumb_url       text,        -- miniatura (opcional)
  contribuidor_id uuid        references public.profiles(id) on delete set null,
  status          text        default 'pendente',
                               -- pendente | aprovado | rejeitado
  moderado_por    uuid        references public.profiles(id) on delete set null,
  moderado_em     timestamptz,
  rejeicao_motivo text,
  downloads       integer     default 0,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- 2. Índices
create index if not exists idx_plantas_municipio on public.plantas (municipio);
create index if not exists idx_plantas_status    on public.plantas (status);
create index if not exists idx_plantas_contrib   on public.plantas (contribuidor_id);

-- 3. Tabela de recompensas por contribuição
create table if not exists public.recompensas (
  id              uuid        default gen_random_uuid() primary key,
  user_id         uuid        not null references public.profiles(id) on delete cascade,
  planta_id       uuid        references public.plantas(id) on delete set null,
  tipo            text        not null,
    -- '1_mes' | '3_meses' | 'vitalicio' | 'desconto_50'
  descricao       text,
  aplicada        boolean     default false,
  aplicada_em     timestamptz,
  expires_at      timestamptz,
  created_at      timestamptz default now()
);

create index if not exists idx_recompensas_user on public.recompensas (user_id);

-- 4. RLS — plantas
alter table public.plantas   enable row level security;
alter table public.recompensas enable row level security;

-- Qualquer um (autenticado ou não) pode ver plantas aprovadas
drop policy if exists "plantas_aprovadas_select"  on public.plantas;
create policy "plantas_aprovadas_select" on public.plantas
  for select using (status = 'aprovado');

-- Contribuidor pode ver suas próprias plantas (qualquer status)
drop policy if exists "plantas_proprias_select"   on public.plantas;
create policy "plantas_proprias_select" on public.plantas
  for select using (auth.uid() = contribuidor_id);

-- Usuário autenticado pode inserir (contribuir)
drop policy if exists "plantas_insert"            on public.plantas;
create policy "plantas_insert" on public.plantas
  for insert with check (auth.uid() = contribuidor_id);

-- Admin pode tudo
drop policy if exists "plantas_admin_all"         on public.plantas;
create policy "plantas_admin_all" on public.plantas
  using (public.is_admin());

-- RLS — recompensas
drop policy if exists "recomp_propria_select"     on public.recompensas;
create policy "recomp_propria_select" on public.recompensas
  for select using (auth.uid() = user_id);

drop policy if exists "recomp_admin_all"          on public.recompensas;
create policy "recomp_admin_all" on public.recompensas
  using (public.is_admin());

-- 5. Trigger: updated_at automático
create or replace function public.set_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists plantas_updated_at on public.plantas;
create trigger plantas_updated_at
  before update on public.plantas
  for each row execute function public.set_updated_at();

-- 6. Função: aprovar planta + recompensa automática (exceto vitalício)
-- REGRA:
--   1 planta  → 1 mês grátis  (automático)
--   5 plantas → 3 meses grátis (automático)
--   10+ plantas → solicita vitalício para avaliação humana do ADM
-- 1 argumento; o admin é identificado por auth.uid() (não dá pra spoofar).
drop function if exists public.aprovar_planta(uuid, uuid);
drop function if exists public.aprovar_planta(uuid);
create or replace function public.aprovar_planta(planta_uuid uuid)
returns jsonb
language plpgsql security definer as $$
declare
  v_contrib     uuid;
  v_total       integer;
  v_tipo_rec    text;
  v_desc        text;
  v_expires     timestamptz;
  v_vitalicio   boolean := false;
  v_admin       uuid := auth.uid();
begin
  -- SEGURANÇA: só admin aprova (senão qualquer um aprova a própria planta e ganha acesso grátis)
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'msg', 'Acesso negado');
  end if;

  select contribuidor_id into v_contrib
  from public.plantas where id = planta_uuid;

  if v_contrib is null then
    return jsonb_build_object('ok', false, 'msg', 'Planta sem contribuidor');
  end if;

  -- Aprova a planta
  update public.plantas set
    status       = 'aprovado',
    moderado_por = v_admin,
    moderado_em  = now()
  where id = planta_uuid;

  -- Conta plantas aprovadas do contribuidor (inclui a que acabou de aprovar)
  select count(*) into v_total
  from public.plantas
  where contribuidor_id = v_contrib and status = 'aprovado';

  if v_total >= 10 then
    -- Vitalício: APENAS cria solicitação pendente para avaliação humana
    v_vitalicio := true;
    insert into public.recompensas (user_id, planta_id, tipo, descricao, aplicada)
    values (v_contrib, planta_uuid,
            'vitalicio_pendente',
            format('Elegível para vitalício — %s plantas aprovadas. Aguarda aprovação do ADM.', v_total),
            false);

  elsif v_total >= 5 then
    v_tipo_rec := '3_meses';
    v_desc     := format('3 meses gratuitos — %s plantas aprovadas', v_total);
    v_expires  := now() + interval '90 days';

  else
    v_tipo_rec := '1_mes';
    v_desc     := '1 mês gratuito pela contribuição aprovada';
    v_expires  := now() + interval '30 days';
  end if;

  -- Aplica recompensa automática (não vitalício)
  if not v_vitalicio then
    insert into public.recompensas (user_id, planta_id, tipo, descricao, expires_at, aplicada)
    values (v_contrib, planta_uuid, v_tipo_rec, v_desc, v_expires, true);

    update public.profiles set
      status           = 'active',
      trial_expires_at = greatest(coalesce(trial_expires_at, now()), now()) + (v_expires - now()),
      plan_name        = case
        when v_tipo_rec = '3_meses' then 'Contribuidor 3 Meses'
        else coalesce(plan_name, 'Contribuidor 1 Mês')
      end
  where id = v_contrib;

  return jsonb_build_object(
    'ok',           true,
    'contribuidor', v_contrib,
    'total_plantas', v_total,
    'recompensa',   coalesce(v_tipo_rec, 'vitalicio_pendente'),
    'vitalicio_pendente', v_vitalicio
  );
end;
$$;

-- 7. Função: conceder vitalício manualmente pelo ADM
-- 1 argumento; o admin é identificado por auth.uid() (não dá pra spoofar).
drop function if exists public.conceder_vitalicio(uuid, uuid);
drop function if exists public.conceder_vitalicio(uuid);
create or replace function public.conceder_vitalicio(user_uuid uuid)
returns jsonb
language plpgsql security definer as $$
begin
  -- Verifica que quem chama é admin (via auth.uid(), não via parâmetro)
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'msg', 'Apenas administradores podem conceder vitalício');
  end if;

  -- Marca recompensas pendentes de vitalício como aplicadas
  update public.recompensas set
    aplicada    = true,
    aplicada_em = now()
  where user_id = user_uuid
    and tipo    = 'vitalicio_pendente'
    and aplicada = false;

  -- Registra a concessão definitiva
  insert into public.recompensas (user_id, tipo, descricao, aplicada, aplicada_em)
  values (user_uuid, 'vitalicio', 'Acesso vitalício concedido pelo administrador', true, now());

  -- Atualiza profile
  update public.profiles set
    status           = 'active',
    trial_expires_at = '2099-12-31 23:59:59'::timestamptz,
    plan_name        = 'Contribuidor Vitalício'
  where id = user_uuid;

  return jsonb_build_object('ok', true, 'user_id', user_uuid);
end;
$$;

-- 7. Verificar resultado
select 'Tabelas criadas: plantas, recompensas' as resultado;
select count(*) as total_plantas from public.plantas;

-- ================================================================
-- PRÓXIMO PASSO: criar o Storage Bucket no Supabase
-- Storage → New bucket → nome: "plantas-pdf" → Public: SIM
-- ================================================================
