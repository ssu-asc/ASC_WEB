begin;

alter table public.submissions
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists projectdb_sync_status text not null default 'not_requested'
    check (projectdb_sync_status in ('not_requested', 'pending', 'synced', 'failed')),
  add column if not exists projectdb_sync_error text,
  add column if not exists projectdb_synced_at timestamptz;

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  semester text not null references public.semesters(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  category text not null check (category in ('project', 'seminar', 'ctf', 'meeting', 'presentation', 'other')),
  description text not null default '' check (char_length(description) <= 4000),
  start_at timestamptz not null,
  end_at timestamptz,
  link_url text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at is null or end_at >= start_at),
  check (link_url is null or link_url ~ '^https?://')
);
create index if not exists events_semester_start on public.events(semester, start_at);

alter table public.events enable row level security;
revoke all on public.events from anon, authenticated;
grant select, insert, update, delete on public.events to authenticated;
grant all on public.events to service_role;

create policy events_read on public.events for select to authenticated
using ((select private.is_active_staff()) or private.has_semester_access(semester));

create policy events_insert_staff on public.events for insert to authenticated
with check ((select private.is_active_staff()) and created_by = (select auth.uid()));

create policy events_update_staff on public.events for update to authenticated
using ((select private.is_active_staff()))
with check ((select private.is_active_staff()));

create policy events_delete_staff on public.events for delete to authenticated
using ((select private.is_active_staff()));

-- Members need a privacy-minimized active roster for team selection. The function
-- exposes only the identifiers required to choose teammates and validates that the
-- caller is an active member of the same semester.
create or replace function public.list_team_candidates(target_semester text default null)
returns table(profile_id uuid, member_id text, name text)
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
  )
  select p.id, p.member_id, p.name
  from chosen c
  join public.semesters semester_row
    on semester_row.id = c.semester and semester_row.active
  join public.semester_memberships caller
    on caller.profile_id = (select auth.uid())
   and caller.semester = c.semester
   and caller.active
  join public.profiles caller_profile
    on caller_profile.id = caller.profile_id and caller_profile.active
  join public.semester_memberships membership
    on membership.semester = c.semester and membership.active and membership.team_required
  join public.profiles p
    on p.id = membership.profile_id and p.active
  order by p.name, p.member_id;
$$;
revoke all on function public.list_team_candidates(text) from public, anon;
grant execute on function public.list_team_candidates(text) to authenticated;

commit;
