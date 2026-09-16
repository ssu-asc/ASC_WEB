begin;

DO $$
DECLARE
  target_user_id uuid;
BEGIN
  select id into target_user_id
  from auth.users
  where email = 'admin@members.asc.invalid'
  limit 1;

  if target_user_id is null then
    raise exception 'admin@members.asc.invalid Auth user not found';
  end if;

  insert into public.profiles (
    id,
    member_id,
    name,
    role,
    active,
    github_username
  ) values (
    target_user_id,
    'admin',
    '테스트 운영진',
    'staff',
    true,
    null
  )
  on conflict (id) do update set
    member_id = excluded.member_id,
    name = excluded.name,
    role = 'staff',
    active = true;

  insert into public.semester_memberships (
    profile_id,
    semester,
    active,
    individual_required,
    team_required
  ) values (
    target_user_id,
    '2026-2',
    true,
    true,
    true
  )
  on conflict (profile_id, semester) do update set
    active = true,
    individual_required = true,
    team_required = true;
END
$$;

commit;
