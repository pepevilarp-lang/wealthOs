-- ═══ CONSULTAS DE RETENCIÓN — pégalas en Supabase SQL Editor cuando tengas usuarios ═══

-- 1) RETENCIÓN D1 / D7 / D30 por cohorte de alta
with first_day as (
  select user_id, min(day) as d0 from app_events where event='session_start' group by user_id
)
select
  f.d0 as cohorte,
  count(distinct f.user_id) as altas,
  count(distinct case when e.day = f.d0 + 1 then e.user_id end) as d1,
  count(distinct case when e.day between f.d0 + 1 and f.d0 + 7 then e.user_id end) as d7,
  count(distinct case when e.day between f.d0 + 1 and f.d0 + 30 then e.user_id end) as d30
from first_day f
left join app_events e on e.user_id = f.user_id and e.event='session_start'
group by f.d0 order by f.d0 desc;

-- 2) USUARIOS ACTIVOS por día (últimos 30 días)
select day, count(distinct user_id) as usuarios_activos
from app_events where event='session_start' and day > current_date - 30
group by day order by day desc;

-- 3) ¿QUÉ PÁGINAS se usan?
select props->>'page' as pagina, count(*) as vistas, count(distinct user_id) as usuarios
from app_events where event='page_view'
group by 1 order by 2 desc;

-- 4) RETENCIÓN POR PERFIL DEL ONBOARDING (¿quién vuelve más?)
with first_day as (
  select user_id, min(day) as d0,
         (array_agg(props->>'experience' order by created_at))[1] as experiencia
  from app_events where event='session_start' group by user_id
)
select experiencia,
  count(distinct f.user_id) as altas,
  count(distinct case when e.day between f.d0+1 and f.d0+7 then e.user_id end) as d7
from first_day f
left join app_events e on e.user_id=f.user_id and e.event='session_start'
group by 1 order by 2 desc;

-- 5) EMBUDO: alta → onboarding → push activado
select
  count(distinct case when event='session_start' then user_id end) as con_sesion,
  count(distinct case when event='onboarding_completed' then user_id end) as onboarding_ok,
  count(distinct case when event='push_subscribed' then user_id end) as con_push
from app_events;
