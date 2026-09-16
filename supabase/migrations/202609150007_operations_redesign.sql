begin;

alter table public.assignments
  add column if not exists opens_at timestamptz,
  add column if not exists version integer not null default 1 check (version > 0);

alter table public.teams
  add column if not exists version integer not null default 1 check (version > 0);

alter table public.submissions
  add column if not exists first_submitted_at timestamptz;

update public.submissions
set first_submitted_at = submitted_at
where first_submitted_at is null;

alter table public.submissions
  alter column first_submitted_at set not null,
  alter column first_submitted_at set default now();

-- Staff are operational accounts, not ordinary project submitters.
update public.semester_memberships m
set individual_required = false,
    team_required = false
from public.profiles p
where p.id = m.profile_id
  and p.role = 'staff';

-- These two rows are the exact unscheduled tracer assignments from migration 001.
update public.assignments
set active = false
where semester = '2026-2'
  and round_key = 'final'
  and due_at is null
  and opens_at is null
  and title in ('개인 프로젝트', '팀 프로젝트');

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assignments'::regclass
      and conname = 'assignments_window_order'
  ) then
    alter table public.assignments
      add constraint assignments_window_order
      check (opens_at is null or due_at is null or due_at > opens_at);
  end if;
end;
$$;

create index if not exists assignments_semester_opens
  on public.assignments(semester, opens_at)
  where active = true;

-- Allocate one project round under a semester-scoped transaction lock so concurrent
-- staff actions cannot reuse the same round number.
create or replace function public.create_assignment_atomic(
  p_semester text,
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
  v_next integer;
  v_id uuid;
  v_round_key text;
begin
  if p_project_type not in ('individual', 'team') then
    raise exception 'invalid project type' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) < 1 or char_length(btrim(p_title)) > 160 then
    raise exception 'invalid title' using errcode = '22023';
  end if;
  if char_length(coalesce(p_description, '')) > 4000 then
    raise exception 'invalid description' using errcode = '22023';
  end if;
  if p_opens_at is null or p_due_at is null or p_due_at <= p_opens_at then
    raise exception 'invalid assignment window' using errcode = '22023';
  end if;
  if not exists (select 1 from public.semesters s where s.id = p_semester and s.active) then
    raise exception 'semester is not active' using errcode = '23503';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_semester));
  select coalesce(max((substring(a.round_key from '^round-([0-9]+)$'))::integer), 0) + 1
    into v_next
  from public.assignments a
  where a.semester = p_semester
    and a.round_key ~ '^round-[0-9]+$';

  v_round_key := 'round-' || pg_catalog.lpad(v_next::text, 4, '0');
  insert into public.assignments (
    semester, project_type, round_key, title, description, opens_at, due_at, active
  ) values (
    p_semester, p_project_type, v_round_key, btrim(p_title), coalesce(p_description, ''), p_opens_at, p_due_at, true
  ) returning id into v_id;

  return query select v_id, v_round_key, 1;
end;
$$;

create or replace function public.create_assignment_series_atomic(
  p_semester text,
  p_first_opens_at timestamptz,
  p_first_due_at timestamptz,
  p_interval_weeks integer,
  p_count integer,
  p_first_type text,
  p_title_prefix text,
  p_description text
)
returns table(assignment_id uuid, round_key text, project_type text, assignment_version integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start integer;
  v_index integer;
  v_type text;
  v_round_key text;
  v_id uuid;
  v_opens_at timestamptz;
  v_due_at timestamptz;
begin
  if p_first_type not in ('individual', 'team') then
    raise exception 'invalid first project type' using errcode = '22023';
  end if;
  if p_count < 1 or p_count > 30 then
    raise exception 'invalid series count' using errcode = '22023';
  end if;
  if p_interval_weeks < 1 or p_interval_weeks > 8 then
    raise exception 'invalid interval weeks' using errcode = '22023';
  end if;
  if p_first_opens_at is null or p_first_due_at is null or p_first_due_at <= p_first_opens_at then
    raise exception 'invalid assignment window' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_title_prefix, ''))) < 1 or char_length(btrim(p_title_prefix)) > 120 then
    raise exception 'invalid title prefix' using errcode = '22023';
  end if;
  if char_length(coalesce(p_description, '')) > 4000 then
    raise exception 'invalid description' using errcode = '22023';
  end if;
  if not exists (select 1 from public.semesters s where s.id = p_semester and s.active) then
    raise exception 'semester is not active' using errcode = '23503';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_semester));
  select coalesce(max((substring(a.round_key from '^round-([0-9]+)$'))::integer), 0) + 1
    into v_start
  from public.assignments a
  where a.semester = p_semester
    and a.round_key ~ '^round-[0-9]+$';

  for v_index in 0..(p_count - 1) loop
    v_type := case
      when mod(v_index, 2) = 0 then p_first_type
      when p_first_type = 'individual' then 'team'
      else 'individual'
    end;
    v_round_key := 'round-' || pg_catalog.lpad((v_start + v_index)::text, 4, '0');
    v_opens_at := p_first_opens_at + (v_index * p_interval_weeks) * interval '1 week';
    v_due_at := p_first_due_at + (v_index * p_interval_weeks) * interval '1 week';

    insert into public.assignments (
      semester, project_type, round_key, title, description, opens_at, due_at, active
    ) values (
      p_semester,
      v_type,
      v_round_key,
      btrim(p_title_prefix) || ' ' || (v_index + 1)::text || '회차',
      coalesce(p_description, ''),
      v_opens_at,
      v_due_at,
      true
    ) returning id into v_id;

    assignment_id := v_id;
    round_key := v_round_key;
    project_type := v_type;
    assignment_version := 1;
    return next;
  end loop;
end;
$$;

-- Move/remove one semester member with an optimistic expected-current-team check.
create or replace function public.move_team_member_atomic(
  p_semester text,
  p_profile_id uuid,
  p_expected_team_id uuid,
  p_target_team_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current uuid;
  v_member_role text;
  v_profile_active boolean;
  v_membership_active boolean;
begin
  select p.role, p.active, m.active
    into v_member_role, v_profile_active, v_membership_active
  from public.semester_memberships m
  join public.profiles p on p.id = m.profile_id
  where m.profile_id = p_profile_id
    and m.semester = p_semester
  for update of m;

  if not found or v_member_role <> 'member' or not v_profile_active or not v_membership_active then
    raise exception 'target is not an active semester member' using errcode = '23514';
  end if;

  select tm.team_id into v_current
  from public.team_members tm
  where tm.profile_id = p_profile_id
    and tm.semester = p_semester;

  if v_current is distinct from p_expected_team_id then
    raise exception 'team membership changed' using errcode = 'P0001';
  end if;

  if p_target_team_id is not null and not exists (
    select 1 from public.teams t where t.id = p_target_team_id and t.semester = p_semester
  ) then
    raise exception 'target team does not exist' using errcode = '23503';
  end if;

  delete from public.team_members
  where profile_id = p_profile_id and semester = p_semester;

  if p_target_team_id is not null then
    insert into public.team_members(team_id, profile_id, semester)
    values (p_target_team_id, p_profile_id, p_semester);
  end if;

  return p_target_team_id;
end;
$$;

-- Ordinary members only need to see their own fixed team, not the whole active roster.
create or replace function public.list_own_team_members(target_semester text default null)
returns table(team_id uuid, team_name text, team_version integer, profile_id uuid, member_id text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  with chosen as (
    select coalesce(
      target_semester,
      (select s.id from public.semesters s where s.is_current and s.active order by s.id desc limit 1)
    ) as semester
  ), caller_team as (
    select tm.team_id, tm.semester
    from chosen c
    join public.semester_memberships m
      on m.profile_id = (select auth.uid())
     and m.semester = c.semester
     and m.active
    join public.profiles p
      on p.id = m.profile_id
     and p.active
    join public.team_members tm
      on tm.profile_id = p.id
     and tm.semester = c.semester
  )
  select t.id, t.name, t.version, p.id, p.member_id, p.name
  from caller_team ct
  join public.teams t on t.id = ct.team_id and t.semester = ct.semester
  join public.team_members tm on tm.team_id = t.id and tm.semester = t.semester
  join public.profiles p on p.id = tm.profile_id and p.active
  order by p.name, p.member_id;
$$;

revoke all on function public.create_assignment_atomic(text, text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.create_assignment_series_atomic(text, timestamptz, timestamptz, integer, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.move_team_member_atomic(text, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_assignment_atomic(text, text, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.create_assignment_series_atomic(text, timestamptz, timestamptz, integer, integer, text, text, text) to service_role;
grant execute on function public.move_team_member_atomic(text, uuid, uuid, uuid) to service_role;

revoke execute on function public.list_team_candidates(text) from authenticated;
revoke all on function public.list_own_team_members(text) from public, anon;
grant execute on function public.list_own_team_members(text) to authenticated;

commit;
