-- ═══ Analítica Orbit: eventos + retención D1/D7/D30 ═══
create table if not exists public.app_events (
  id         bigint generated always as identity primary key,
  user_id    uuid references auth.users(id) on delete cascade,
  event      text not null,
  props      jsonb default '{}'::jsonb,
  day        date default (now() at time zone 'utc')::date,
  created_at timestamptz default now()
);
create index if not exists app_events_user_day on public.app_events(user_id, day);
create index if not exists app_events_event_day on public.app_events(event, day);
-- 1 sesión por usuario y día (los duplicados se rechazan en silencio)
create unique index if not exists app_events_daily_session
  on public.app_events(user_id, day) where event = 'session_start';

alter table public.app_events enable row level security;
create policy "events_insert_own" on public.app_events for insert with check (auth.uid() = user_id);
create policy "events_select_own" on public.app_events for select using (auth.uid() = user_id);
