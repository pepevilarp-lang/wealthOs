-- ╔══════════════════════════════════════════════════════════════╗
-- ║  ORBIT · SOCIAL  — pégalo ENTERO en Supabase → SQL Editor → Run ║
-- ║  Crea: amigos (connections), compartidos (shares), comentarios ║
-- ║  + invitación por enlace + RLS estricta (deny-by-default).     ║
-- ╚══════════════════════════════════════════════════════════════╝

-- 1) PROFILES: nombre visible + código de invitación único
alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists invite_code text;

-- backfill de códigos para perfiles ya existentes
update public.profiles
   set invite_code = lower(substr(replace(gen_random_uuid()::text,'-',''),1,10))
 where invite_code is null;

-- default + unicidad para los nuevos
alter table public.profiles
  alter column invite_code set default lower(substr(replace(gen_random_uuid()::text,'-',''),1,10));
create unique index if not exists profiles_invite_code_idx on public.profiles(invite_code);

-- 2) CONNECTIONS (amistades). Par canónico user_a < user_b (sin duplicados).
create table if not exists public.connections (
  id         uuid primary key default gen_random_uuid(),
  user_a     uuid not null references auth.users(id) on delete cascade,
  user_b     uuid not null references auth.users(id) on delete cascade,
  status     text not null default 'accepted',
  created_at timestamptz not null default now(),
  unique (user_a, user_b),
  check (user_a < user_b)
);
alter table public.connections enable row level security;
drop policy if exists conn_select on public.connections;
create policy conn_select on public.connections for select
  using (auth.uid() = user_a or auth.uid() = user_b);
-- alta/baja se hace SOLO vía RPC redeem_invite (security definer). Nada de insert directo.

-- 3) SHARES: artículo compartido. Guardamos SNAPSHOT (título/url/fuente/summary),
--    nunca el texto completo del artículo (copyright).
create table if not exists public.shares (
  id         uuid primary key default gen_random_uuid(),
  from_user  uuid not null references auth.users(id) on delete cascade,
  to_user    uuid not null references auth.users(id) on delete cascade,
  from_name  text,
  article    jsonb not null,
  note       text,
  reason     text,
  created_at timestamptz not null default now()
);
alter table public.shares enable row level security;
drop policy if exists shares_select on public.shares;
create policy shares_select on public.shares for select
  using (auth.uid() = from_user or auth.uid() = to_user);
drop policy if exists shares_insert on public.shares;
create policy shares_insert on public.shares for insert
  with check (
    auth.uid() = from_user
    and exists (
      select 1 from public.connections c
      where c.user_a = least(from_user, to_user)
        and c.user_b = greatest(from_user, to_user)
    )
  );

-- 4) SHARE_COMMENTS: hilo de respuestas sobre un share
create table if not exists public.share_comments (
  id         uuid primary key default gen_random_uuid(),
  share_id   uuid not null references public.shares(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  user_name  text,
  text       text not null,
  created_at timestamptz not null default now()
);
alter table public.share_comments enable row level security;
drop policy if exists sc_select on public.share_comments;
create policy sc_select on public.share_comments for select
  using (exists (select 1 from public.shares s
                 where s.id = share_id and (s.from_user = auth.uid() or s.to_user = auth.uid())));
drop policy if exists sc_insert on public.share_comments;
create policy sc_insert on public.share_comments for insert
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.shares s
                where s.id = share_id and (s.from_user = auth.uid() or s.to_user = auth.uid()))
  );

-- 5) REDEEM_INVITE: canjea el enlace de un amigo y crea la conexión de forma segura
create or replace function public.redeem_invite(code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  inviter uuid;
  inviter_name text;
begin
  select id, coalesce(display_name, 'Tu amigo')
    into inviter, inviter_name
    from public.profiles
   where invite_code = lower(code)
   limit 1;

  if inviter is null then return null; end if;
  if inviter = auth.uid() then return 'self'; end if;

  insert into public.connections(user_a, user_b)
  values (least(inviter, auth.uid()), greatest(inviter, auth.uid()))
  on conflict (user_a, user_b) do nothing;

  return inviter_name;
end;
$$;
grant execute on function public.redeem_invite(text) to authenticated;

-- 6) MY_FRIENDS: lista de amigos (id + nombre) sin exponer perfiles ajenos
create or replace function public.my_friends()
returns table(friend_id uuid, display_name text)
language sql
security definer
set search_path = public
as $$
  select p.id,
         coalesce(p.display_name, split_part(u.email, '@', 1)) as display_name
    from public.connections c
    join auth.users u
      on u.id = (case when c.user_a = auth.uid() then c.user_b else c.user_a end)
    join public.profiles p on p.id = u.id
   where auth.uid() in (c.user_a, c.user_b);
$$;
grant execute on function public.my_friends() to authenticated;

-- LISTO. Si algo falla, suele ser que la tabla "profiles" no existe con ese nombre:
-- ajusta "public.profiles" al nombre real de tu tabla de perfiles.
