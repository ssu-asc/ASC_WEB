begin;

create table if not exists public.public_recruitment_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  title text not null default 'ASC 리크루팅 안내' check (char_length(btrim(title)) between 1 and 100),
  description text not null default '숭실대학교 ASC 소모임에서 새로운 지원자를 모집하고 있습니다.' check (char_length(description) <= 500),
  button_label text not null default '지원 페이지로 이동' check (char_length(btrim(button_label)) between 1 and 80),
  button_href text not null default '/apply' check (button_href ~ '^(/|https://)'),
  starts_at timestamptz,
  ends_at timestamptz,
  version bigint not null default 1 check (version > 0),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

insert into public.public_recruitment_settings (id, enabled)
values (true, false)
on conflict (id) do nothing;

alter table public.public_recruitment_settings enable row level security;
revoke all on public.public_recruitment_settings from anon, authenticated;
grant select on public.public_recruitment_settings to anon, authenticated;
grant all on public.public_recruitment_settings to service_role;

create policy public_recruitment_settings_read
on public.public_recruitment_settings for select to anon, authenticated
using (true);

create table if not exists public.schedule_series (
  id uuid primary key default gen_random_uuid(),
  semester text not null references public.semesters(id) on delete restrict,
  kind text not null check (kind in ('event', 'project')),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  description text not null default '' check (char_length(description) <= 4000),
  event_category text check (event_category is null or event_category in ('seminar', 'ctf', 'meeting', 'presentation', 'other')),
  project_pattern text check (project_pattern is null or project_pattern in ('individual', 'team', 'alternating')),
  link_url text check (link_url is null or link_url ~ '^https?://'),
  first_start_at timestamptz not null,
  first_end_at timestamptz not null,
  recurrence_frequency text not null default 'none' check (recurrence_frequency in ('none', 'daily', 'weekly', 'monthly')),
  recurrence_interval integer not null default 1 check (recurrence_interval between 1 and 31),
  weekdays smallint[] not null default '{}',
  end_mode text not null default 'count' check (end_mode in ('count', 'until', 'never')),
  occurrence_count integer check (occurrence_count is null or occurrence_count between 1 and 500),
  until_at timestamptz,
  active boolean not null default true,
  version bigint not null default 1 check (version > 0),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (first_end_at > first_start_at),
  check ((kind = 'event' and event_category is not null and project_pattern is null)
      or (kind = 'project' and project_pattern is not null and event_category is null)),
  check ((recurrence_frequency = 'weekly' and cardinality(weekdays) between 1 and 7)
      or (recurrence_frequency <> 'weekly' and cardinality(weekdays) = 0)),
  check (weekdays <@ array[0,1,2,3,4,5,6]::smallint[]),
  check ((end_mode = 'count' and occurrence_count is not null and until_at is null)
      or (end_mode = 'until' and occurrence_count is null and until_at is not null)
      or (end_mode = 'never' and occurrence_count is null and until_at is null)),
  check (recurrence_frequency <> 'none' or (end_mode = 'count' and occurrence_count = 1))
);

create index if not exists schedule_series_semester_active
  on public.schedule_series(semester, active, first_start_at);

alter table public.schedule_series enable row level security;
revoke all on public.schedule_series from anon, authenticated;
grant select on public.schedule_series to authenticated;
grant all on public.schedule_series to service_role;

create policy schedule_series_read on public.schedule_series for select to authenticated
using ((select private.is_active_staff()) or private.has_semester_access(semester));

alter table public.events
  add column if not exists schedule_series_id uuid references public.schedule_series(id) on delete set null,
  add column if not exists occurrence_index integer check (occurrence_index is null or occurrence_index >= 0);

alter table public.assignments
  add column if not exists schedule_series_id uuid references public.schedule_series(id) on delete set null,
  add column if not exists occurrence_index integer check (occurrence_index is null or occurrence_index >= 0);

create unique index if not exists events_schedule_series_occurrence_unique
  on public.events(schedule_series_id, occurrence_index);

create unique index if not exists assignments_schedule_series_occurrence_unique
  on public.assignments(schedule_series_id, occurrence_index);

create or replace function public.materialize_schedule_assignment(
  p_series_id uuid,
  p_occurrence_index integer,
  p_project_type text,
  p_title text,
  p_description text,
  p_opens_at timestamptz,
  p_due_at timestamptz
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
    schedule_series_id, occurrence_index
  ) values (
    v_semester, p_project_type, v_round_key, btrim(p_title), coalesce(p_description, ''),
    p_opens_at, p_due_at, true, p_series_id, p_occurrence_index
  ) returning id into v_id;

  return query select v_id, v_round_key, 1;
end;
$$;

revoke all on function public.materialize_schedule_assignment(uuid, integer, text, text, text, timestamptz, timestamptz)
from public, anon, authenticated;
grant execute on function public.materialize_schedule_assignment(uuid, integer, text, text, text, timestamptz, timestamptz)
to service_role;

commit;
