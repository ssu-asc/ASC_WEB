# Phase 10 Context — Markdown Upload → ProjectDB Publish

## Why this phase exists

The current member submission UI requires ProjectDB repository/path/ref input. The intended member experience is simpler: select one Markdown report file, optionally provide a code repository URL, submit it for review, and let ASC_WEB publish the approved report into ProjectDB automatically.

## Confirmed decisions

- Both individual and team reports use the existing `ssu-asc/ProjectDB` repository.
- Do not create a second GitHub report database.
- Member submission requires one `.md` file; PDF/PPTX/ZIP/multiple assets are deferred.
- Markdown draft text is stored in Postgres, not Supabase Storage.
- Members never choose ProjectDB path/ref/branch/tag.
- ASC_WEB generates frontmatter and ProjectDB path only after staff approval.
- One ASC assignment maps to one ProjectDB `report-01.md`; reapproval updates the same path.
- Team reports use the fixed semester team name; individual reports use `quad_name: 개인` and a member-scoped project folder.
- Existing ProjectDB validator/Notion sync remain backward compatible for legacy reports.
- `source: asc_web` reports may omit CL/contribution frontmatter rather than fabricating data.
- Existing ProjectDB push workflow continues syncing approved reports to Notion.
- Existing historical ASC submissions without stored Markdown remain valid and retain the legacy sync path.

## Delivery boundary

Phase 10 may apply migration 011, redeploy changed ASC_WEB submission functions, and modify ProjectDB validator/sync compatibility code on an isolated ProjectDB feature branch. Public GitHub Pages deployment, real ProjectDB production-token success-path verification, and git integration/PR decisions remain explicit release choices.

## Primary design

See `docs/superpowers/specs/2026-09-16-markdown-project-submission-design.md`.
