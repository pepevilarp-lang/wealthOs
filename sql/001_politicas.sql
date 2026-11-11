-- Políticas de seguridad por fila tal como están en producción (11/11/2026). Idempotente.
do $$
declare t text;
begin
  foreach t in array array['blocks','documents','journal','networth_log','operations','patrimonio_history',
                           'pe_reports','pe_transactions','watchlist','budgets','instinct_tokens','movements',
                           'notifications_sent','savings_goals','user_expense_data','user_kv']
  loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
      execute format('create policy %I on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)', 'own_' || t, t);
    end if;
  end loop;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='profiles') then
    create policy "own profile" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='app_events') then
    create policy events_insert_own on public.app_events for insert with check (auth.uid() = user_id);
    create policy events_select_own on public.app_events for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='push_subscriptions') then
    create policy push_own_select on public.push_subscriptions for select using (auth.uid() = user_id);
    create policy push_own_insert on public.push_subscriptions for insert with check (auth.uid() = user_id);
    create policy push_own_update on public.push_subscriptions for update using (auth.uid() = user_id);
    create policy push_own_delete on public.push_subscriptions for delete using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='quick_tokens') then
    create policy "qtok own select" on public.quick_tokens for select using (auth.uid() = user_id);
    create policy "qtok own insert" on public.quick_tokens for insert with check (auth.uid() = user_id);
    create policy "qtok own update" on public.quick_tokens for update using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='quick_expenses') then
    create policy "qexp own select" on public.quick_expenses for select using (auth.uid() = user_id);
    create policy "qexp own delete" on public.quick_expenses for delete using (auth.uid() = user_id);
  end if;
end $$;

-- Almacén de documentos: cada usuario solo su carpeta <uid>/…
-- (políticas users_own_docs_select/insert/delete sobre storage.objects, bucket 'wealth-docs')

-- Funciones SECURITY DEFINER: nunca ejecutables sin sesión (aplicado el 11/11/2026)
alter function public.handle_new_user() set search_path = public, pg_temp;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.my_friends() from public, anon;
revoke execute on function public.redeem_invite(text) from public, anon;
grant execute on function public.my_friends() to authenticated;
grant execute on function public.redeem_invite(text) to authenticated;
