# Phase 10 Summary — Markdown Upload → ProjectDB Publish

## Delivered

### Member submission

- Members upload one UTF-8 `.md` report instead of entering ProjectDB repository/path/ref values.
- Optional summary and GitHub code-repository URL remain.
- Browser validation and server validation both enforce safe `.md` basename, non-empty text, no NUL, no leading YAML frontmatter, and a 262,144-byte limit.
- Markdown draft filename/body/byte count are stored in Postgres; Supabase Storage is not used.
- Assignment title and authenticated member/fixed-team ownership are authoritative.
- Pre-open, late, fixed-team, approved-lock and optimistic-version behavior remain unchanged.

### Staff review

- Staff inspect the exact stored Markdown source as escaped text before approval.
- Filename, byte size and optional code repository are visible in the review panel.
- Approved ProjectDB link appears only after successful publication.

### ProjectDB publication

- A pure server-side builder creates trusted `source: asc_web` frontmatter and deterministic ProjectDB paths.
- Individual: `reports/{year}/개인/{member_id}-{round_key}-{project}/report-01.md`.
- Team: `reports/{year}/{team}/{round_key}-{project}/report-01.md`.
- GitHub Contents API create/update preserves one report path per assignment and saves the returned immutable commit SHA.
- Approval remains durable when ProjectDB sync fails; retry remains available.
- Historical submissions without Markdown keep the legacy `portal-index/...json` archive path.

### ProjectDB compatibility

The ProjectDB compatibility change set, now merged through PR #80:

- keeps all legacy required fields/validation unchanged;
- accepts `source: asc_web` individual/team reports without fabricated CL/contribution metadata;
- omits the Notion CL property when CL is absent;
- skips team submission-tracking updates for individual portal reports;
- documents the portal-generated report structure.

## Free-cost result

No new object storage, VPS, report repository or paid service is introduced. Draft Markdown stays in existing Supabase Postgres; approved reports stay in the existing GitHub ProjectDB.

## Production rollout

ProjectDB compatibility is merged, hosted Supabase migration 011 is applied, updated `submission-write` / `submission-admin` are active, ASC_WEB is merged through PR #1, and the existing Cloudflare Pages `asc-web` project serves production at `https://ssu-asc.com`. Production smoke confirms the custom-domain Member route, root-relative assets, and hosted Supabase Edge CORS from `https://ssu-asc.com`.

A least-privilege `PROJECTDB_TOKEN` is provisioned in hosted Supabase. Phase 10 is production-ready: the first real staff approval is retained as an operator smoke to observe the generated `report-01.md` and immutable commit SHA in the live repository. Notion synchronization is not required for v1.0 completion.
