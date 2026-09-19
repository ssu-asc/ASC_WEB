# State — ASC 2026-2 Core Operations Portal

## Current Position

**ASC 2026-2 Core Operations Portal v1.0 is shipped and production-ready as of 2026-09-17. GSD Core Phases 1–10 are implemented, integrated, deployed, and re-verified.**

The deployed Member operations portal includes integrated Markdown report submission: members write directly in a ProjectDB-template editor, may optionally import/download `.md`, staff inspect the exact stored source, and approval generates trusted individual/team ProjectDB reports. Resource hub, global staff memo, and Vault-backed shared staff credentials remain intact.

ProjectDB compatibility landed in `ssu-asc/ProjectDB` PR #80. ASC_WEB migration `202609160011` plus updated `submission-write` and `submission-admin` are deployed. ASC_WEB itself landed through PR #1 and production is served from the existing Cloudflare Pages project `asc-web` at `https://ssu-asc.com`; the GitHub Pages custom-domain association is intentionally unset. A least-privilege `PROJECTDB_TOKEN` is provisioned in hosted Supabase. The first real staff approval remains an operational production smoke for GitHub write permission; it is not a remaining implementation dependency. Notion synchronization is not part of the v1.0 release-completion gate.

## Delivered

### Accounts / Roles
- ASC-issued login ID/password with no public signup UI
- database-backed member/staff role and activity state
- staff default to no individual/team project requirement
- member self-password change
- staff member password reissue from spreadsheet row
- server-generated one-time temporary reset password; no plaintext DB/localStorage/sessionStorage persistence
- database active-staff guard preserves at least one active staff under concurrent changes

### Spreadsheet Member Management
- simplified editable roster grid with explicit batch save
- visible fields are login ID, name, role, and password reset management
- semester activity, GitHub username, and account-active fields remain in the compatibility model but are hidden from routine member management and preserved on existing rows
- new/imported accounts default to current-semester active + account active with no GitHub username
- selection + bulk role changes
- Excel/Google Sheets tabular paste with the simplified `아이디 / 이름 / 권한` shape
- CSV and XLSX import/export/template
- import preview before grid mutation
- `member-bulk` up to 200 rows with independent row results
- supplied/generated temporary passwords for new accounts
- optimistic profile version checks

### Semester-Fixed Teams / Projects
- staff-only semester team management with inline team rename, member removal, add/move, and safe empty-team deletion
- one team per member/semester invariant
- one team-project submission per `(assignment_id, team_id)`; any confirmed teammate may submit/update it
- individual/team assignments use `opens_at`, `due_at`, round key, active state and optimistic version
- alternating individual↔team series materialize independent rounds transactionally
- submission is blocked before open and remains available after deadline
- `first_submitted_at` determines late status independently of review state

### Staff Project Overview / ProjectDB
- member-first `전체 현황` summarizes each person's individual + team progress for the whole semester and surfaces team-unassigned/revision/missing attention first
- future unopened rounds are counted as `예정`, not `미제출`
- round-first `회차별 현황` remains the detailed review surface
- individual rows per expected member; team rows per team
- team-unassigned members surfaced separately
- member submission is an integrated Markdown editor prefilled from the ProjectDB progress-report template, with optional `.md` import/download and optional summary/code-repository URL
- team templates prefill the fixed team name/member rows; individual templates remove team-only contribution friction
- legacy ProjectDB Markdown imports have user-controlled YAML frontmatter stripped before validation; approval still regenerates trusted frontmatter server-side
- members never manage ProjectDB path/ref/branch/commit or need to create a GitHub report file manually
- Markdown drafts are stored as Postgres text (max 256 KiB) rather than object storage
- staff review shows the exact escaped Markdown filename/byte size/source before approval
- approval generates trusted frontmatter and deterministic `report-01.md` ProjectDB paths for both individual and team assignments
- individual portal reports use `reports/{year}/개인/...`; team reports use fixed-team paths
- ProjectDB publish returns an immutable commit SHA that becomes the saved publication ref
- sync failure remains independent/retryable and does not roll back approval
- historical submissions without Markdown retain the legacy `portal-index` archive sync branch
- stale member/staff writes conflict instead of overwriting newer state

### Member Dashboard / Schedule / UI
- member dashboard groups `지금 할 프로젝트 / 다음 프로젝트 / 지난 프로젝트`
- staff `/member` redirects to operations
- list/detail retain full project `opens_at → due_at` range
- month calendar places projects only on `due_at` and labels them `마감`
- dark native controls for select/option/datetime/search/disabled states
- existing public ASC structure remains unchanged except Member navigation

### Resource Hub
- `resource_links` supports Notion, Google Drive/Docs/Sheets/Forms, GitHub, Discord and other HTTPS resources
- links carry category, member/staff audience, order, active state and optimistic version
- ordinary members read only active current-semester `audience='member'` rows through RLS
- staff manage member/staff links through `operations-settings`; browser direct mutation is denied
- historical Phase-7 fixed Google URLs were migrated once into staff-only generic links by migration 009
- `/member/resources` shows only member-visible resources to both members and staff
- existing Notion study content stays external and is linked rather than copied
- external provider permissions remain authoritative
- public `/apply` stays separate from internal resource-link configuration

### Staff Handover Memo + Shared Secrets
- `운영진 메모` is organization-global and stores only non-secret handover information such as Google account address, Instagram handle, GitHub organization and ownership notes
- historical `google_account_email` metadata is runtime-deprecated and migration 010 preserves any existing values in the memo
- password/token-like shared secrets are stored only through **Supabase Vault**, not ordinary portal columns
- `staff_shared_secrets` contains metadata + Vault UUID only; no plaintext secret column exists
- `staff_shared_secret_audit` records created/updated/revealed/deactivated/reactivated without secret content
- browser roles have no direct access to secret metadata, audit rows, Vault objects, or service-role-only Vault RPCs
- dedicated `staff-secrets` Edge Function re-checks active staff for every secret operation
- list/create/update/state-change responses expose sanitized metadata only and do not return Vault UUIDs
- explicit `reveal` is the only plaintext-returning operation and uses `Cache-Control: no-store, private`
- reveal/copy is audited; stale updates fail before Vault mutation
- UI defaults to masked values, holds reveal plaintext only in React state, and auto-clears it after 30 seconds
- edit/deactivate/hide/unmount clear in-page reveal state; copy clears the page state after clipboard write
- V1 uses deactivate/reactivate instead of permanent Vault deletion
- step-up MFA/re-authentication before reveal is deferred; a compromised active staff session can still explicitly reveal shared credentials

## Hosted Supabase Status

Project: `ASC_WEB`

Remote migration history is current through:

```text
202609150001
202609150002
202609150003
202609150004
202609150005
202609150006
202609150007
202609160008
202609160009
202609160010
202609160011
```

A post-deploy `supabase db push --dry-run` reports the remote database is up to date.

Active hosted Edge Functions:

- `member-admin`
- `member-bulk`
- `team-admin`
- `assignment-admin`
- `submission-write` — ACTIVE
- `submission-admin` — ACTIVE
- `operations-settings` — ACTIVE
- `staff-secrets` — ACTIVE

The new secret function was deployed using the Supabase server-side `--use-api` bundle path. Hosted smoke verifies CORS and invalid-JWT HTTP reachability without sending any real secret.

## Verification Evidence

Latest local evidence for Phase 10:

- `npm test` — **83 passing, 0 failures**
- `npm run typecheck` — PASS
- `npm run build` — PASS, Next 15.5.25 static export, **21 pages**
- `npm run test:browser` — **15/15 PASS**
- `npm run test:integration` — PASS with disposable local Supabase, migrations `001–011`, Auth/PostgREST/RLS/Edge Functions, Markdown individual/team submission and real local Vault operations
- ProjectDB compatibility branch/main: `python3 -m unittest discover -s tests -v` — **23 passing**
- `git diff --check` — PASS for ASC_WEB gate
- hosted Supabase migration 011 — DEPLOYED; post-deploy dry-run reports up to date
- hosted `submission-write` v5 / `submission-admin` v4 — ACTIVE
- hosted Edge smoke — PASS for `team-admin`, `operations-settings`, and `staff-secrets`
- Cloudflare Pages production deployment `0b9fd3ee-5e99-46f1-9cbb-f3bbbb3826f6` — project `asc-web`, branch `main`, source `62dda61`, deployment PASS
- production domain smoke — `https://ssu-asc.com/member/operations/progress/` returns 200 and loads the current progress page chunk; `https://ssu-asc.com/member/login/` remains live; hosted Edge preflight with `Origin: https://ssu-asc.com` returns 204 and `Access-Control-Allow-Origin: https://ssu-asc.com`

Integration coverage includes:
- issued Auth accounts and RLS
- last-active-staff protection
- single/bulk member account operations and optimistic concurrency
- generated reset credential login
- fixed-team management and shared team submission behavior
- project-round scheduling/concurrency and late semantics
- Markdown upload validation, draft persistence, individual/team shared submission behavior, stale resubmission conflicts, and durable review/sync states
- deterministic individual/team ProjectDB report frontmatter/path generation
- ProjectDB legacy validator compatibility plus `source: asc_web` individual/team fixtures and individual tracking skip
- member/staff resource-link audience RLS, CRUD/reorder/deactivation
- staff memo optimistic save and ordinary-member denial
- ordinary-member denial for all `staff-secrets` actions
- browser direct secret/audit/RPC denial
- local Vault create/list/reveal/update/deactivate/reactivate
- no plaintext in create/list/update/audit/metadata responses or tables
- no internal Vault UUID in Edge responses
- audited no-store reveal
- stale secret replacement rejected before Vault mutation
- inactive secret reveal blocked; reactivation restores reveal

## Dependency Note

Next remains on the 15.5 patch line. The known transitive PostCSS advisory that requires the breaking Next 16 path remains a separate framework-upgrade task.

## Post-v1.0 Operator Follow-up

These are operational or hardening tasks, not v1.0 implementation blockers:
- use the first real staff approval as the production ProjectDB write smoke and confirm `report-01.md` plus the saved immutable commit SHA;
- enter real ASC organization credentials into the Vault UI only when needed;
- maintain actual Notion/Google/GitHub/Discord sharing and ownership in those external services;
- consider step-up MFA/re-authentication before shared-secret reveal as a future hardening milestone;
- periodically inspect production Auth settings and GitHub token expiry/rotation.

Notion synchronization is not required as part of the ASC_WEB v1.0 completion verification. Follow `docs/member-portal-setup.md` for ongoing operator checks.
