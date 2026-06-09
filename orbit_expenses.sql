-- Orbit · sincronización de gastos entre dispositivos
-- Pega esto UNA vez en el SQL Editor de Supabase.
-- Permite que el Excel de gastos que subes en un dispositivo se vea en todos.

create table if not exists public.user_expense_data (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_expense_data enable row level security;

-- Cada usuario solo ve y edita sus propios gastos
drop policy if exists "own expense data" on public.user_expense_data;
create policy "own expense data" on public.user_expense_data
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
