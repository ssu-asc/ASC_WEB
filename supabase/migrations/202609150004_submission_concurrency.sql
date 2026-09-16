begin;

alter table public.submissions
  add column if not exists version bigint not null default 1 check (version > 0);

create or replace function public.create_team_submission_atomic(
  p_semester text,
  p_assignment_id uuid,
  p_team_name text,
  p_member_ids uuid[],
  p_title text,
  p_summary text,
  p_code_repository_url text,
  p_report_repository_url text,
  p_report_path text,
  p_submitted_ref text
)
returns table(team_id uuid, submission_id uuid, submission_version bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_team uuid;
  created_submission uuid;
  created_version bigint;
begin
  if coalesce(array_length(p_member_ids, 1), 0) < 2 then
    raise exception 'team needs at least two members' using errcode = '23514';
  end if;

  insert into public.teams (semester, name)
  values (p_semester, p_team_name)
  returning id into created_team;

  insert into public.team_members (team_id, profile_id, semester)
  select created_team, member_id, p_semester
  from unnest(p_member_ids) as member_id;

  insert into public.submissions (
    assignment_id, semester, project_type, owner_id, team_id,
    title, summary, code_repository_url, report_repository_url, report_path,
    submitted_ref, status, submitted_at
  ) values (
    p_assignment_id, p_semester, 'team', null, created_team,
    p_title, p_summary, p_code_repository_url, p_report_repository_url, p_report_path,
    p_submitted_ref, 'submitted', now()
  ) returning id, version into created_submission, created_version;

  return query select created_team, created_submission, created_version;
end;
$$;

revoke all on function public.create_team_submission_atomic(text, uuid, text, uuid[], text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_team_submission_atomic(text, uuid, text, uuid[], text, text, text, text, text, text) to service_role;

commit;
