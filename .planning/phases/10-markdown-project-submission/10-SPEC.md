# Phase 10 Spec — Markdown Upload → ProjectDB Publish

**Status:** Approved design; implementation in progress

## Objective

Replace member-supplied ProjectDB repository/path/ref inputs with one required Markdown upload. Store the Markdown draft in Supabase Postgres until staff approval, then publish a trusted ProjectDB report for both individual and team assignments.

## Member submission

The submission form accepts:

- assignment title shown read-only;
- optional summary up to 4000 chars;
- required `.md` file up to 262,144 UTF-8 bytes;
- optional GitHub code repository URL.

The form no longer asks for:

- ProjectDB repository URL;
- ProjectDB path;
- commit SHA/tag/branch;
- editable project title.

Files starting with YAML frontmatter `---` are rejected because ASC_WEB generates trusted frontmatter.

## Migration 011

Add `202609160011_markdown_submission.sql`.

Add nullable historical-compatible fields to `submissions`:

- `report_filename text`;
- `report_markdown text`;
- `report_bytes integer`.

Make legacy publication fields nullable:

- `report_repository_url`;
- `report_path`;
- `submitted_ref`.

Add checks for safe `.md` basename, 1..262144 byte count, and Markdown octet length <=262144. Existing rows remain valid with null Markdown fields.

## submission-write

New browser contract:

```text
assignment_id
summary
code_repository_url?
report_filename
report_markdown
expected_version?
```

The server:

- resolves assignment and fixed individual/team ownership;
- sets `title` from `assignments.title`;
- validates Markdown filename/content/encoded byte size;
- rejects leading YAML frontmatter;
- preserves `first_submitted_at`;
- allows late submission;
- rejects pre-open, non-participant, unassigned-team, approved-write, and stale-version cases;
- clears previous published repository/path/ref fields when a reopened submission receives a new Markdown draft.

## ProjectDB path

Team:

```text
reports/{YYYY}/{team_segment}/{round_key}-{project_segment}/report-01.md
```

Individual:

```text
reports/{YYYY}/개인/{member_id}-{round_key}-{project_segment}/report-01.md
```

Generated path segments are server-controlled and traversal-safe.

## Generated ProjectDB report

ASC_WEB prepends trusted YAML frontmatter with:

- `source: asc_web`;
- `project_type`;
- assignment title as `project_name`;
- fixed team name or `개인` as `quad_name`;
- trusted current member list;
- `report_number: 1`;
- submission date;
- `status: 진행 중`;
- `portal_submission_id`;
- optional `code_repository_url`.

Members do not control frontmatter identity/team/path values.

## ProjectDB compatibility

Legacy ProjectDB reports keep current validation.

For `source: asc_web` reports:

- require source/project_type/project_name/quad_name/members/report_number/date/status/portal_submission_id;
- `project_type` must be `individual|team`;
- `cl_level` and `contributions` are optional;
- if optional values exist, existing validators still validate them.

Notion sync:

- omit CL property when CL is absent;
- omit contribution property when absent;
- skip tracking checkbox updates for `project_type=individual`;
- preserve legacy/team behavior otherwise.

## Staff review / publication

Staff sees exact stored Markdown filename/byte size/body as escaped text.

On approval:

- review state is persisted first;
- Markdown-backed submission publishes `report-01.md` via ProjectDB GitHub Contents API;
- existing target file SHA is fetched so reapproval updates the same file;
- returned Git commit SHA is saved to `submitted_ref`;
- generated path/repository URL are saved after successful publish;
- sync failure does not roll back approval;
- retry remains available.

Historical submissions with null `report_markdown` continue the legacy supplemental archive behavior.

## Security

- GitHub write token remains server-only;
- browser never selects ProjectDB path/ref;
- Markdown preview is escaped text, not raw HTML;
- new writes are optimistic and RLS-protected;
- team submission remains shared per fixed team;
- server-generated metadata comes only from trusted DB state.

## Free-cost constraint

No object storage or new hosting is introduced. Markdown drafts stay in existing Supabase Postgres and approved reports stay in the existing GitHub ProjectDB repository.

## Acceptance

- migration 011 survives local resets;
- member UI uses required `.md` upload and no ProjectDB path/ref fields;
- browser and server reject invalid Markdown drafts;
- individual/team writes and late/revision semantics remain correct;
- staff sees exact draft text;
- approved Markdown generates deterministic ProjectDB path/frontmatter;
- ProjectDB legacy tests remain green;
- portal individual/team report fixtures validate;
- individual Notion tracking is skipped;
- ASC_WEB unit/type/build/browser/local integration/hosted Edge/diff gates pass;
- remote dry-run shows only migration 011 before apply.

## Out of scope

- PDF/PPTX/ZIP;
- multiple files/assets;
- Markdown WYSIWYG editor;
- member-selected ProjectDB paths/refs;
- per-project GitHub repository creation;
- new report repository.
