begin;

alter table public.profiles
  add column if not exists version bigint not null default 1 check (version > 0);

alter table public.submissions
  add column if not exists projectdb_sync_attempt uuid;

create or replace function public.update_member_admin_atomic(
  p_target_id uuid,
  p_semester text,
  p_expected_version bigint,
  p_name text,
  p_role text,
  p_active boolean,
  p_github_username text,
  p_semester_active boolean,
  p_individual_required boolean,
  p_team_required boolean
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_version bigint;
begin
  update public.profiles
  set name = p_name,
      role = p_role,
      active = p_active,
      github_username = p_github_username,
      version = version + 1
  where id = p_target_id
    and version = p_expected_version
  returning version into next_version;

  if next_version is null then
    raise exception 'member record changed; refresh and retry' using errcode = '40001';
  end if;

  insert into public.semester_memberships (
    profile_id, semester, active, individual_required, team_required
  ) values (
    p_target_id, p_semester, p_semester_active, p_individual_required, p_team_required
  )
  on conflict (profile_id, semester) do update
  set active = excluded.active,
      individual_required = excluded.individual_required,
      team_required = excluded.team_required;

  return next_version;
end;
$$;

revoke all on function public.update_member_admin_atomic(
  uuid, text, bigint, text, text, boolean, text, boolean, boolean, boolean
) from public, anon, authenticated;
grant execute on function public.update_member_admin_atomic(
  uuid, text, bigint, text, text, boolean, text, boolean, boolean, boolean
) to service_role;

commit;
