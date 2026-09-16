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

- remote `supabase db push --dry-run` — PASS; **only `202609160011_markdown_submission.sql` is pending**
- existing hosted Phase-9 Edge smoke — PASS for `team-admin`, `operations-settings`, and `staff-secrets`

Production deployment is intentionally not performed yet because current ProjectDB main must first receive the compatibility changes. Deploying the ASC_WEB approval publisher before that integration could commit a valid portal report whose existing ProjectDB validation/Notion pipeline does not yet understand the new `source: asc_web` schema.

Expected release sequence:

1. integrate ProjectDB compatibility changes;
2. re-run ProjectDB tests;
3. confirm ASC_WEB remote dry-run shows only migration 011 pending;
4. apply migration 011;
5. deploy changed `submission-write` and `submission-admin`;
6. verify hosted CORS/reachability;
7. run one controlled production ProjectDB-token Markdown approval;
8. confirm generated `report-01.md`, immutable commit SHA and existing Notion sync.

Do not claim Phase 10 production publishing is live before steps 1–8 are complete.
