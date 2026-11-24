-- Seguimiento de las propuestas de operación (orbit_notes, kind = 'idea'). Idempotente.
-- /api/radar (tarea diaria) revisa cada idea abierta con las velas diarias de Twelve Data y la cierra al tocar
-- objetivo o salida, o al caducar. Se sigue igual si no se ejecutó: así se ve qué hubiera pasado.
alter table public.orbit_notes
  add column if not exists price_symbol text,          -- símbolo en Twelve Data (p. ej. 'XAU/USD', 'ACME')
  add column if not exists entry_date date,            -- desde cuándo cuenta (por defecto, día de la propuesta)
  add column if not exists size_eur numeric,           -- tamaño propuesto: entre 500 y 1.000 € (regla del usuario)
  add column if not exists executed boolean not null default false,   -- si el usuario la ejecutó de verdad
  add column if not exists last_price numeric,
  add column if not exists last_price_date date,
  add column if not exists exit_price numeric,
  add column if not exists closed_on date,
  add column if not exists result_eur numeric;         -- resultado sobre size_eur, descontando 2 € de comisiones

do $$ begin
  alter table public.orbit_notes add constraint orbit_notes_size_eur_rango check (size_eur is null or size_eur between 500 and 1000);
exception when duplicate_object then null; end $$;
