begin;

alter table public.events
  add column if not exists all_day boolean not null default false;

alter table public.assignments
  add column if not exists all_day boolean not null default false;

alter table public.schedule_series
  add column if not exists all_day boolean not null default false;

create or replace function public.materialize_schedule_assignment(
  p_series_id uuid,
  p_occurrence_index integer,
  p_project_type text,
  p_title text,
  p_description text,
  p_opens_at timestamptz,
  p_due_at timestamptz,
  p_all_day boolean
)
returns table(assignment_id uuid, round_key text, assignment_version integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_semester text;
  v_existing public.assignments%rowtype;
  v_next integer;
  v_round_key text;
  v_id uuid;
begin
  if p_occurrence_index < 0 then
    raise exception 'invalid occurrence index' using errcode = '22023';
  end if;
  if p_project_type not in ('individual', 'team') then
    raise exception 'invalid project type' using errcode = '22023';
  end if;
  if p_due_at <= p_opens_at then
    raise exception 'invalid assignment window' using errcode = '22023';
  end if;

  select s.semester into v_semester
  from public.schedule_series s
  where s.id = p_series_id and s.active and s.kind = 'project';
  if v_semester is null then
    raise exception 'schedule series unavailable' using errcode = '23503';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_semester));

  select a.* into v_existing
  from public.assignments a
  where a.schedule_series_id = p_series_id and a.occurrence_index = p_occurrence_index;
  if found then
    return query select v_existing.id, v_existing.round_key, v_existing.version;
    return;
  end if;

  select coalesce(max((substring(a.round_key from '^round-([0-9]+)$'))::integer), 0) + 1
    into v_next
  from public.assignments a
  where a.semester = v_semester and a.round_key ~ '^round-[0-9]+$';

  v_round_key := 'round-' || pg_catalog.lpad(v_next::text, 4, '0');
  insert into public.assignments (
    semester, project_type, round_key, title, description, opens_at, due_at, active,
    schedule_series_id, occurrence_index, all_day
  ) values (
    v_semester, p_project_type, v_round_key, btrim(p_title), coalesce(p_description, ''),
    p_opens_at, p_due_at, true, p_series_id, p_occurrence_index, coalesce(p_all_day, false)
  ) returning id into v_id;

  return query select v_id, v_round_key, 1;
end;
$$;

revoke all on function public.materialize_schedule_assignment(uuid, integer, text, text, text, timestamptz, timestamptz, boolean)
from public, anon, authenticated;
grant execute on function public.materialize_schedule_assignment(uuid, integer, text, text, text, timestamptz, timestamptz, boolean)
to service_role;

commit;
