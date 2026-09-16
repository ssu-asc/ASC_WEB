begin;

alter table public.submissions
  add column if not exists report_filename text,
  add column if not exists report_markdown text,
  add column if not exists report_bytes integer;

alter table public.submissions
  alter column report_repository_url drop not null,
  alter column report_path drop not null,
  alter column submitted_ref drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.submissions'::regclass
      and conname = 'submissions_markdown_draft_consistency'
  ) then
    alter table public.submissions
      add constraint submissions_markdown_draft_consistency check (
        (report_filename is null and report_markdown is null and report_bytes is null)
        or
        (
          report_filename is not null
          and report_markdown is not null
          and report_bytes between 1 and 262144
          and octet_length(report_markdown) between 1 and 262144
          and report_bytes = octet_length(report_markdown)
          and char_length(report_filename) between 1 and 128
          and lower(report_filename) like '%.md'
          and report_filename !~ '[/\\]'
          and report_filename not in ('.', '..')
        )
      );
  end if;
end;
$$;

commit;
