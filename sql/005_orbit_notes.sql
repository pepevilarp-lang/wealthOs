-- Análisis de Claude para Orbit: revisiones de cartera, radar de empresas, tesis e ideas de operación.
-- Los escribe Claude (conector de Supabase, en el chat o en la tarea semanal). Instinct los envía por WhatsApp
-- (GET /alerts, sin repetir) y la app los muestra en "Análisis". El usuario solo lee los suyos. Idempotente.
create table if not exists public.orbit_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('cartera', 'radar', 'tesis', 'idea', 'resultados', 'analisis')),
  ticker text,
  title text not null,
  summary text not null check (char_length(summary) <= 700),   -- listo para WhatsApp
  body text,                                                    -- análisis completo (markdown)
  doc_url text,
  sources jsonb not null default '[]'::jsonb,                   -- [{ "title": "...", "url": "..." }]
  -- Solo para ideas de operación (1 semana a 3 meses)
  direction text check (direction in ('alcista', 'bajista')),
  horizon text,
  entry_price numeric,
  target_price numeric,
  stop_price numeric,
  currency text,
  expires_on date,
  status text check (status in ('abierta', 'objetivo', 'stop', 'caducada', 'cerrada')),
  result_pct numeric,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists orbit_notes_user_created on public.orbit_notes (user_id, created_at desc);
alter table public.orbit_notes enable row level security;
drop policy if exists orbit_notes_select_own on public.orbit_notes;
create policy orbit_notes_select_own on public.orbit_notes for select using (auth.uid() = user_id);
-- Sin políticas de escritura: solo el servidor o Claude con la clave de servicio escriben.
