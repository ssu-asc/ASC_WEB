begin;

alter table public.events
  add column if not exists version bigint not null default 1 check (version > 0);

create or replace function public.list_semester_roster(target_semester text)
returns table(
  profile_id uuid,
  member_id text,
  name text,
  role text,
  account_active boolean,
  github_username text,
  profile_version bigint,
  membership_active boolean,
  individual_required boolean,
  team_required boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_active_staff() then
    raise exception 'staff access required' using errcode = '42501';
  end if;

  return query
  select
    p.id,
    p.member_id,
    p.name,
    p.role,
    p.active,
    p.github_username,
    p.version,
    m.active,
    m.individual_required,
    m.team_required
  from public.semester_memberships m
  join public.profiles p on p.id = m.profile_id
  where m.semester = target_semester
  order by p.name, p.member_id;
end;
$$;

revoke all on function public.list_semester_roster(text) from public, anon;
grant execute on function public.list_semester_roster(text) to authenticated;

commit;
