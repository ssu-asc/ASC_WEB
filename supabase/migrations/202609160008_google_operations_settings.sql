begin;

create table if not exists public.staff_workspace_settings (
  semester text primary key references public.semesters(id) on delete cascade,
  form_url text,
  candidate_sheet_url text,
  operations_drive_url text,
  interview_template_url text,
  version bigint not null default 1 check (version > 0),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.staff_workspace_settings enable row level security;

revoke all on public.staff_workspace_settings from anon, authenticated;
grant select on public.staff_workspace_settings to authenticated;
grant all on public.staff_workspace_settings to service_role;

create policy staff_workspace_settings_read_staff
on public.staff_workspace_settings
for select
to authenticated
using ((select private.is_active_staff()));

commit;
