# Phase 10 Verification — Markdown Upload → ProjectDB Publish

## Local ASC_WEB gate

Fresh local gate before coordinated release:

- `npm test` — 80 passing, 0 failures
- `npm run typecheck` — PASS
- `npm run build` — PASS, Next 15.5.25 static export, 20 pages
- `npm run test:browser` — 14/14 PASS
- `npm run test:integration` — PASS with migrations 001–011 and real local Auth/RLS/Edge paths
- `git diff --check` — PASS

Coverage includes:

- `.md` filename/body/UTF-8 byte/frontmatter validation;
- no member ProjectDB path/ref inputs;
- server-derived assignment title and owner/fixed team;
- personal/team Markdown draft storage and visibility;
- stale resubmission conflicts;
- approved submission member lock;
- durable approval with ProjectDB sync failure when token is intentionally absent;
- deterministic individual/team ProjectDB path/frontmatter builder;
- exact escaped staff Markdown source preview;
- historical legacy submission sync branch retained.

## ProjectDB isolated worktree gate

- baseline before changes: 16/16 unittest PASS
- after Phase 10 compatibility changes: 23/23 unittest PASS
- `git diff --check` — PASS

Coverage includes:

- legacy report required fields remain required;
- portal individual report without CL/contributions passes;
- portal team report without CL/contributions passes;
- invalid portal project type fails;
- Notion properties omit absent CL/contributions;
- legacy CL property remains unchanged when present;
- individual portal reports skip team tracking-checkbox updates.

## Production status

Completed on 2026-09-17 KST:

- ProjectDB compatibility merged through PR #80; `main` is at `01b64c6` for the integration commit.
- hosted migration `202609160011_markdown_submission.sql` applied successfully.
- post-deploy `supabase db push --dry-run` reports the remote database is up to date.
- hosted `submission-write` is ACTIVE v5; `submission-admin` is ACTIVE v4.
- hosted Edge smoke passes for `team-admin`, `operations-settings`, and `staff-secrets` CORS/reachability.
- ASC_WEB merged through PR #1; `main` is at `efeceec` for the portal integration commit.
- GitHub Pages was enabled for workflow deployment and repository Variables were configured for the browser-safe Supabase URL/key plus `NEXT_PUBLIC_BASE_PATH=/ASC_WEB`.
- Pages run `35118540739` passed both build and deploy.
- production browser smoke at `/ASC_WEB/member/login/` confirms JS/CSS/fonts/images load from the base path, the form activates, Supabase Auth OPTIONS reaches 200, and an intentional invalid-login POST reaches 400 and is rendered as a normal login failure.

Still open:

1. provision a least-privilege hosted `PROJECTDB_TOKEN` (repository and branch settings are already configured);
2. run one controlled production Markdown approval;
3. confirm generated ProjectDB `report-01.md`, immutable commit SHA, and existing Notion sync.

The currently authenticated GitHub CLI OAuth token was deliberately not reused as the long-lived Supabase `PROJECTDB_TOKEN` because it has broader organization/repository permissions than the documented least-privilege release boundary. Phase 10 UI/DB/functions are deployed, but end-to-end production ProjectDB publishing should not be declared verified until the three open steps above are complete.
