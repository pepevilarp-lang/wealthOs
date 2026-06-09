-- ============================================================
-- Orbit · Quick-add de gastos desde Atajos de iOS / Siri / widget
-- Ejecuta esto UNA vez en Supabase (SQL Editor).
-- ============================================================

-- 1) Token por usuario (para que el Atajo se identifique sin login)
create table if not exists public.quick_tokens (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  token      text unique not null,
  created_at timestamptz default now()
);

alter table public.quick_tokens enable row level security;

drop policy if exists "qtok own select" on public.quick_tokens;
drop policy if exists "qtok own insert" on public.quick_tokens;
drop policy if exists "qtok own update" on public.quick_tokens;
create policy "qtok own select" on public.quick_tokens for select using (auth.uid() = user_id);
create policy "qtok own insert" on public.quick_tokens for insert with check (auth.uid() = user_id);
create policy "qtok own update" on public.quick_tokens for update using (auth.uid() = user_id);

-- 2) Bandeja de gastos rápidos (el Atajo escribe aquí vía la función de Vercel;
--    Orbit los recoge, los mete en Gastos y los borra)
create table if not exists public.quick_expenses (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  amount      numeric not null,
  category    text not null,
  note        text,
  occurred_at timestamptz default now(),
  created_at  timestamptz default now()
);

alter table public.quick_expenses enable row level security;

drop policy if exists "qexp own select" on public.quick_expenses;
drop policy if exists "qexp own delete" on public.quick_expenses;
create policy "qexp own select" on public.quick_expenses for select using (auth.uid() = user_id);
create policy "qexp own delete" on public.quick_expenses for delete using (auth.uid() = user_id);

create index if not exists quick_expenses_user_idx on public.quick_expenses(user_id);

-- Nota: la función de Vercel inserta con la SERVICE ROLE KEY (salta RLS),
-- así que NO hace falta policy de insert para el rol anónimo.
