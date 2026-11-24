-- Radar de empresas: avisos públicos sobre las acciones del usuario (directivos, analistas, 8-K, noticias).
-- Los escribe /api/radar (tarea diaria) o GET /api/instinct?route=radar&refresh=1 con la clave de servicio.
-- El usuario solo puede leer los suyos. Idempotente.
create table if not exists public.radar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  ticker text not null,
  kind text not null check (kind in ('insider', 'analistas', 'hecho_relevante', 'noticia')),
  level text not null default 'baja' check (level in ('alta', 'media', 'baja')),
  text text not null,
  url text,
  event_date date not null,
  created_at timestamptz not null default now(),
  unique (user_id, key)
);
create index if not exists radar_events_user_date on public.radar_events (user_id, event_date desc);
alter table public.radar_events enable row level security;
drop policy if exists radar_events_select_own on public.radar_events;
create policy radar_events_select_own on public.radar_events for select using (auth.uid() = user_id);
-- Sin políticas de escritura: solo la clave de servicio (servidor) inserta.
