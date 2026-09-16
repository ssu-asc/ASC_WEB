-- Phase 1 read tracer. Apply once through Supabase migrations to a reviewed project.
-- This file does not create real accounts, change Auth settings or grant browser writes.
begin;

create schema if not exists private;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  member_id text not null unique check (member_id ~ '^[a-z0-9][a-z0-9_-]{2,31}$'),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  role text not null default 'member' check (role in ('member', 'staff')),
  active boolean not null default true,
  github_username text check (github_username is null or github_username ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}$'),
  created_at timestamptz not null default now()
);

create table public.semesters (
  id text primary key check (id ~ '^[0-9]{4}-[12]$'),
  title text not null,
  active boolean not null default true,
  is_current boolean not null default false
);
create unique index semesters_one_current on public.semesters(is_current) where is_current;

create table public.semester_memberships (
  profile_id uuid not null references public.profiles(id) on delete restrict,
  semester text not null references public.semesters(id) on delete restrict,
  active boolean not null default true,
  individual_required boolean not null default true,
  team_required boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (profile_id, semester)
);
create index semester_memberships_semester on public.semester_memberships(semester, active);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  semester text not null references public.semesters(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  unique (id, semester),
  unique (semester, name)
);

create table public.team_members (
  team_id uuid not null,
  profile_id uuid not null,
  semester text not null,
  -- One confirmed team per member/semester. A submission cannot manufacture team membership.
  primary key (profile_id, semester),
  foreign key (profile_id, semester) references public.semester_memberships(profile_id, semester) on delete restrict,
  foreign key (team_id, semester) references public.teams(id, semester) on delete restrict
);
create index team_members_team on public.team_members(team_id);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  semester text not null references public.semesters(id) on delete restrict,
  project_type text not null check (project_type in ('individual', 'team')),
  round_key text not null default 'final' check (char_length(round_key) between 1 and 40),
  title text not null,
  description text not null default '',
  due_at timestamptz,
  active boolean not null default true,
  unique (semester, project_type, round_key),
  unique (id, semester, project_type)
);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null,
  semester text not null,
  project_type text not null,
  owner_id uuid,
  team_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  summary text not null default '' check (char_length(summary) <= 4000),
  code_repository_url text,
  report_repository_url text not null check (report_repository_url ~ '^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/?$'),
  report_path text not null check (report_path ~ '\.md$' and report_path !~ '^/' and report_path !~ '(^|/)\.\.?(/|$)'),
  submitted_ref text not null check (
    submitted_ref ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$'
    and submitted_ref !~ '\.\.'
    and submitted_ref !~ '^refs/'
    and submitted_ref !~ '/$'
  ),
  status text not null default 'submitted' check (status in ('submitted', 'revision_requested', 'approved')),
  review_note text check (review_note is null or char_length(review_note) <= 4000),
  submitted_at timestamptz not null default now(),
  foreign key (assignment_id, semester, project_type) references public.assignments(id, semester, project_type) on delete restrict,
  foreign key (owner_id, semester) references public.semester_memberships(profile_id, semester) on delete restrict,
  foreign key (team_id, semester) references public.teams(id, semester) on delete restrict,
  check (
    (project_type = 'individual' and owner_id is not null and team_id is null) or
    (project_type = 'team' and owner_id is null and team_id is not null)
  )
);
create unique index submissions_personal_once on public.submissions(assignment_id, owner_id) where owner_id is not null;
create unique index submissions_team_once on public.submissions(assignment_id, team_id) where team_id is not null;
create index submissions_semester on public.submissions(semester, status);

-- These helpers prevent recursive RLS queries. No supplied user ID can impersonate a caller.
create function private.is_active_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active and p.role = 'staff'
  );
$$;

create function private.has_semester_access(target_semester text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.semester_memberships m
    join public.profiles p on p.id = m.profile_id
    join public.semesters s on s.id = m.semester
    where p.id = (select auth.uid()) and p.active and m.active and s.active
      and m.semester = target_semester
  );
$$;

create function private.is_team_member(target_team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.team_members tm
    where tm.team_id = target_team and tm.profile_id = (select auth.uid())
      and private.has_semester_access(tm.semester)
  );
$$;

revoke all on all functions in schema private from public;
revoke all on schema private from public;
grant usage on schema private to authenticated;
grant execute on function private.is_active_staff(), private.has_semester_access(text), private.is_team_member(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.semesters enable row level security;
alter table public.semester_memberships enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.assignments enable row level security;
alter table public.submissions enable row level security;

-- Scope grants to portal tables only. Existing unrelated tables are not changed.
revoke all on public.profiles, public.semesters, public.semester_memberships,
  public.teams, public.team_members, public.assignments, public.submissions from anon, authenticated;
grant select on public.profiles, public.semesters, public.semester_memberships,
  public.teams, public.team_members, public.assignments, public.submissions to authenticated;
grant all on public.profiles, public.semesters, public.semester_memberships,
  public.teams, public.team_members, public.assignments, public.submissions to service_role;

create policy profiles_read on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select private.is_active_staff()));

create policy semesters_read on public.semesters for select to authenticated
using ((select private.is_active_staff()) or private.has_semester_access(id));

create policy semester_memberships_read on public.semester_memberships for select to authenticated
using ((select private.is_active_staff()) or (profile_id = (select auth.uid()) and private.has_semester_access(semester)));

create policy teams_read on public.teams for select to authenticated
using ((select private.is_active_staff()) or private.is_team_member(id));

create policy team_members_read on public.team_members for select to authenticated
using ((select private.is_active_staff()) or private.is_team_member(team_id));

create policy assignments_read on public.assignments for select to authenticated
using ((select private.is_active_staff()) or (active and private.has_semester_access(semester)));

create policy submissions_read on public.submissions for select to authenticated
using (
  (select private.is_active_staff()) or
  (private.has_semester_access(semester) and (
    (project_type = 'individual' and owner_id = (select auth.uid())) or
    (project_type = 'team' and private.is_team_member(team_id))
  ))
);

-- No INSERT/UPDATE/DELETE policies in the read tracer. Add audited, constrained operations in later tasks.
insert into public.semesters (id, title, active, is_current)
values ('2026-2', '2026학년도 2학기', true, true);
insert into public.assignments (semester, project_type, title, description, due_at)
values
  ('2026-2', 'individual', '개인 프로젝트', '개인 프로젝트의 Git 보고서와 제출 상태를 확인합니다.', null),
  ('2026-2', 'team', '팀 프로젝트', '소속 팀의 Git 보고서와 공동 제출 상태를 확인합니다.', null);

commit;
