-- Añade la columna de nombre para personalizar el saludo del push
alter table public.push_subscriptions add column if not exists name text;
