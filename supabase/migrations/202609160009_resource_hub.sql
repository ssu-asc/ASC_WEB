begin;

alter table public.staff_workspace_settings
  add column if not exists google_account_email text;

create table if not exists public.resource_links (
  id uuid primary key default gen_random_uuid(),
  semester text not null references public.semesters(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 1000),
  url text not null check (char_length(url) between 8 and 2048),
  service text not null check (service in ('notion','google_drive','google_docs','google_sheets','google_forms','github','discord','other')),
  category text not null check (category in ('study','project','ctf','recruitment','operations','other')),
  audience text not null check (audience in ('member','staff')),
  sort_order integer not null default 100 check (sort_order between 0 and 1000000),
  active boolean not null default true,
  version bigint not null default 1 check (version > 0),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists resource_links_semester_visible
  on public.resource_links(semester, audience, active, sort_order, title);

alter table public.resource_links enable row level security;

revoke all on public.resource_links from anon, authenticated;
grant select on public.resource_links to authenticated;
grant all on public.resource_links to service_role;

drop policy if exists resource_links_read on public.resource_links;
create policy resource_links_read
on public.resource_links
for select
to authenticated
using (
  (select private.is_active_staff())
  or (
    active
    and audience = 'member'
    and private.has_semester_access(semester)
  )
);

-- Preserve migration-008 links as staff-only generic resource rows. Runtime code
-- stops depending on the fixed columns after this migration, but the columns stay
-- in place for rollback/compatibility.
insert into public.resource_links (
  semester, title, description, url, service, category, audience, sort_order, active, version
)
select
  settings.semester,
  '지원서',
  '',
  settings.form_url,
  'google_forms',
  'recruitment',
  'staff',
  10,
  true,
  1
from public.staff_workspace_settings settings
where settings.form_url is not null
  and btrim(settings.form_url) <> ''
  and not exists (
    select 1
    from public.resource_links resource
    where resource.semester = settings.semester
      and resource.title = '지원서'
      and resource.url = settings.form_url
      and resource.service = 'google_forms'
      and resource.category = 'recruitment'
      and resource.audience = 'staff'
  );

insert into public.resource_links (
  semester, title, description, url, service, category, audience, sort_order, active, version
)
select
  settings.semester,
  '지원자 현황',
  '',
  settings.candidate_sheet_url,
  'google_sheets',
  'recruitment',
  'staff',
  20,
  true,
  1
from public.staff_workspace_settings settings
where settings.candidate_sheet_url is not null
  and btrim(settings.candidate_sheet_url) <> ''
  and not exists (
    select 1
    from public.resource_links resource
    where resource.semester = settings.semester
      and resource.title = '지원자 현황'
      and resource.url = settings.candidate_sheet_url
      and resource.service = 'google_sheets'
      and resource.category = 'recruitment'
      and resource.audience = 'staff'
  );

insert into public.resource_links (
  semester, title, description, url, service, category, audience, sort_order, active, version
)
select
  settings.semester,
  '운영 Drive',
  '',
  settings.operations_drive_url,
  'google_drive',
  'operations',
  'staff',
  30,
  true,
  1
from public.staff_workspace_settings settings
where settings.operations_drive_url is not null
  and btrim(settings.operations_drive_url) <> ''
  and not exists (
    select 1
    from public.resource_links resource
    where resource.semester = settings.semester
      and resource.title = '운영 Drive'
      and resource.url = settings.operations_drive_url
      and resource.service = 'google_drive'
      and resource.category = 'operations'
      and resource.audience = 'staff'
  );

insert into public.resource_links (
  semester, title, description, url, service, category, audience, sort_order, active, version
)
select
  settings.semester,
  '면접 Template',
  '',
  settings.interview_template_url,
  'google_docs',
  'recruitment',
  'staff',
  40,
  true,
  1
from public.staff_workspace_settings settings
where settings.interview_template_url is not null
  and btrim(settings.interview_template_url) <> ''
  and not exists (
    select 1
    from public.resource_links resource
    where resource.semester = settings.semester
      and resource.title = '면접 Template'
      and resource.url = settings.interview_template_url
      and resource.service = 'google_docs'
      and resource.category = 'recruitment'
      and resource.audience = 'staff'
  );

commit;
