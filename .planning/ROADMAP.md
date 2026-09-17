# Roadmap: ASC 2026-2 Core Operations

## Overview

Supabase Auth/Postgres/Edge Functions + existing ProjectDB Markdown reports. Existing public site design remains intact. The original four-phase portal was completed first, then operations redesign, spreadsheet member management, and final zero-cost operations polish were layered on top.

## Phases

- [x] **Phase 1: Member Portal Tracer** — issued accounts, semester roster, login, real status reads
- [x] **Phase 2: Git Project Submissions** — individual/team submissions and ProjectDB verification
- [x] **Phase 3: Staff Review** — roster-derived status and review workflow
- [x] **Phase 4: Semester Schedule** — general semester events and project deadlines
- [x] **Phase 5: Operations Redesign** — semester-fixed teams, scheduled project rounds, late submissions, round-first overview
- [x] **Phase 6: Spreadsheet Member Management** — sheet-style grid, paste, bulk account operations, CSV/XLSX
- [x] **Phase 7: Final Operations Polish** — per-member password reset, deadline-first month calendar, free Google operations workspace settings
- [x] **Phase 8: Resource Hub & Link Management** — Google handover metadata, generic staff/member links, member 자료실
- [x] **Phase 9: Staff Shared Secrets** — 운영진 메모, Supabase Vault 기반 공용 계정 비밀정보, 감사 로그
- [x] **Phase 10: Markdown Submission → ProjectDB Publish** — 회원 `.md` 업로드, 운영진 원문 검토, 개인/팀 ProjectDB 자동 게시 (production-ready; first real approval is an operator smoke)

## Phase Details

### Phase 1: Member Portal Tracer
**Goal:** Sign in with ASC-issued accounts and operate against real Supabase roster/profile state.
**Status:** Complete, local verified.

### Phase 2: Git Project Submissions
**Goal:** Submit ProjectDB Markdown report references with immutable verified Git commit SHA.
**Status:** Complete, local verified.

### Phase 3: Staff Review
**Goal:** Compute missing/submitted/revision/approved state from semester participation and keep durable staff review state.
**Status:** Complete, local verified.

### Phase 4: Semester Schedule
**Goal:** Show semester events and project timing in one member-facing schedule.
**Status:** Complete, local verified.

### Phase 5: Operations Redesign
**Goal:** Match the actual 2026-2 operating model rather than the first generic submission model.

**Delivered:**
- staff are excluded from normal project submit requirements;
- teams are fixed for one semester and managed only by staff;
- `/member/operations/teams` manages create/rename/assign/move/remove/delete actions;
- ordinary members no longer receive a semester-wide teammate candidate roster;
- project assignments have `opens_at`, `due_at`, and optimistic `version`;
- schedule creates individual, team, and materialized individual↔team alternating rounds;
- alternating series creation is transactional;
- member submission is rejected before open time and remains open after due time;
- `first_submitted_at` drives immutable late classification;
- staff overview is round-first with one row/member for individual rounds and one row/team for team rounds;
- team-unassigned members are a separate warning group;
- member dashboard is current/upcoming/history and staff `/member` redirects to operations;
- Member native form controls use an explicit dark color scheme.

**Primary artifacts:**
- `docs/superpowers/specs/2026-09-15-member-operations-redesign.md`
- `docs/superpowers/plans/2026-09-15-operations-redesign.md`
- `supabase/migrations/202609150007_operations_redesign.sql`

### Phase 6: Spreadsheet Member Management
**Goal:** Make roster work feel like Excel/Google Sheets without adding Google OAuth synchronization.

**Delivered:**
- direct editable roster cells with explicit batch save;
- row selection and bulk role/activity/account changes;
- tab-separated Excel/Google Sheets paste with header aliases;
- preview before imported data enters the grid;
- CSV import/export with proper quoted field parsing;
- XLSX import/export/template through a focused OOXML reader/writer;
- `member-bulk` privileged Edge Function for up to 200 rows;
- independent row results so one invalid row does not roll back unrelated valid rows;
- server-generated strong one-time temporary passwords when omitted;
- generated plaintext credential list lives only in current operation/React state and can be copied/downloaded once;
- staff role automatically maps to no individual/team project requirement.

**Primary artifacts:**
- `docs/superpowers/plans/2026-09-15-spreadsheet-members.md`
- `src/component/member/MemberSpreadsheet.tsx`
- `src/lib/member-spreadsheet.ts`
- `supabase/functions/member-bulk/index.ts`

### Phase 7: Final Operations Polish
**Goal:** Close the remaining operator gaps while keeping the operations stack free and avoiding a new document/recruitment server.

**Implementation scope:**
- restore a per-member password reissue action in the spreadsheet UI using a server-generated one-time temporary password;
- keep project `opens_at → due_at` ranges but place projects on `due_at` in the month calendar;
- originally add staff-only current-semester Google operations settings for Form/Sheet/Drive/interview-template URLs (later generalized by Phase 8);
- originally expose a configured Drive shortcut (removed by Phase 8 in favor of `자료실` + generic link management);
- allow Google account/resource handover by editing URLs only when copied/recreated resources change;
- store no Google OAuth token, service-account key, refresh token, or password;
- require no Outline/VPS/Docker service;
- keep team projects as one shared submission per semester team with no schema rewrite.

**Primary artifacts:**
- `.planning/phases/07-final-operations-polish/07-SPEC.md`
- `.planning/phases/07-final-operations-polish/07-PLAN.md`
- `docs/superpowers/plans/2026-09-16-google-operations-workspace.md`
- `supabase/migrations/202609160008_google_operations_settings.sql`
- `supabase/functions/operations-settings/index.ts`
- `src/app/member/operations/settings/page.tsx`

### Phase 8: Resource Hub & Link Management
**Goal:** Turn fixed Google operations URLs into a reusable semester-scoped link hub for staff operations and member study/resources without copying external content into ASC_WEB.

**Delivered:**
- historical `google_account_email` handover metadata (migrated into the Phase 9 운영진 메모 and no longer used by runtime code);
- generic `resource_links` with service/category/audience/order/active/version fields;
- forward migration 009 from existing Phase 7 fixed Google URLs into staff-only resource rows;
- `operations-settings` metadata + link CRUD/reordering with staff auth, HTTPS validation and optimistic conflicts;
- `/member/operations/settings` link collection management with native selectors and mobile/keyboard-friendly move controls;
- `/member/resources` and `자료실` navigation for active member-visible links;
- existing Notion study pages remain external and are linked rather than copied;
- external Notion/Google/GitHub/Discord permissions remain authoritative;
- public `/apply` stays separate from internal resource links.

**Primary artifacts:**
- `docs/superpowers/specs/2026-09-16-resource-hub-design.md`
- `docs/superpowers/plans/2026-09-16-resource-hub.md`
- `.planning/phases/08-resource-hub/08-SPEC.md`
- `supabase/migrations/202609160009_resource_hub.sql`
- `supabase/functions/operations-settings/index.ts`
- `src/app/member/resources/page.tsx`

### Phase 9: Staff Shared Secrets
**Goal:** Separate non-secret staff handover notes from encrypted shared organization credentials and expose secrets only through explicit audited staff reveal/copy operations.

**Delivered:**
- global `운영진 메모` for non-secret Google/Instagram/GitHub handover notes;
- Supabase Vault enabled by migration 010;
- secret metadata + audit tables with no plaintext password column;
- Vault bridged only through service-role-only atomic SQL functions;
- dedicated `staff-secrets` Edge Function with staff authorization;
- `/member/operations/settings` masked shared credential management;
- explicit reveal/copy only, `Cache-Control: no-store, private`, 30-second in-page plaintext lifetime;
- optimistic secret updates/deactivate/reactivate and recent access audit display;
- stale secret updates fail before Vault mutation;
- no direct browser secret/audit/Vault/RPC access;
- Phase 8 resource hub preserved unchanged;
- no credential export, local/session storage, custom AES master key, or member access.

**Primary artifacts:**
- `docs/superpowers/specs/2026-09-16-staff-shared-secrets-design.md`
- `docs/superpowers/plans/2026-09-16-staff-shared-secrets.md`
- `.planning/phases/09-staff-shared-secrets/09-SPEC.md`
- `supabase/migrations/202609160010_staff_shared_secrets.sql`
- `supabase/functions/staff-secrets/index.ts`

### Phase 10: Markdown Submission → ProjectDB Publish
**Goal:** Replace member-managed ProjectDB path/ref input with one required Markdown upload and publish approved individual/team reports into the existing ProjectDB.

**Delivered locally:**
- migration 011 stores Markdown draft filename/body/byte size in Postgres and makes publication URL/path/ref nullable until approval;
- member `/member/submission` now accepts one `.md` file (max 256 KiB), optional summary, optional GitHub code repo, with no ProjectDB path/tag/ref input;
- browser and `submission-write` both reject unsafe filename, empty/NUL/oversized/frontmatter Markdown;
- assignment title + authenticated individual/fixed-team identity are authoritative;
- staff project overview shows exact escaped Markdown source, uploaded filename/size, and code-repo link;
- approval generates deterministic trusted ProjectDB frontmatter/path and writes `report-01.md`; reapproval targets the same path;
- individual reports publish under `reports/{year}/개인/...`; team reports remain under the fixed team group;
- historical submissions without Markdown retain the legacy `portal-index` sync branch;
- isolated ProjectDB worktree generalizes validator/Notion sync for `source: asc_web` without weakening legacy validation;
- portal reports do not fabricate CL or contribution metadata; personal reports skip team tracking checkbox updates;
- no Supabase Storage, new report repository, VPS, or paid service is introduced.

**Primary artifacts:**
- `docs/superpowers/specs/2026-09-16-markdown-project-submission-design.md`
- `docs/superpowers/plans/2026-09-16-markdown-project-submission.md`
- `.planning/phases/10-markdown-project-submission/10-SPEC.md`
- `supabase/migrations/202609160011_markdown_submission.sql`
- `src/lib/submission-upload.ts`
- `supabase/functions/_shared/projectdb-report.ts`
- `supabase/functions/submission-write/index.ts`
- `supabase/functions/submission-admin/index.ts`

**Release status:** ProjectDB compatibility is merged, migration 011 and the new submission functions are deployed, ASC_WEB is live on the existing Cloudflare Pages `asc-web` production project at `https://ssu-asc.com`, and the least-privilege ProjectDB token is provisioned. The first real approval is an operator smoke for GitHub write permission, not an implementation dependency. Notion synchronization is not required for v1.0 completion.

## Progress

| Phase | Status | Verified |
|---|---|---|
| 1. Member Portal Tracer | Complete | 2026-09-15 |
| 2. Git Project Submissions | Complete | 2026-09-15 |
| 3. Staff Review | Complete | 2026-09-15 |
| 4. Semester Schedule | Complete | 2026-09-15 |
| 5. Operations Redesign | Complete (local verified) | 2026-09-15 |
| 6. Spreadsheet Member Management | Complete (local verified) | 2026-09-15 |
| 7. Final Operations Polish | Complete (local + hosted Supabase verified) | 2026-09-16 |
| 8. Resource Hub & Link Management | Complete (local + hosted Supabase verified) | 2026-09-16 |
| 9. Staff Shared Secrets | Complete (local + hosted Supabase verified) | 2026-09-16 |
| 10. Markdown Submission → ProjectDB Publish | Complete / production-ready | 2026-09-17 |

## Current Release Gates

Local verification evidence for the current source state:

Current verified evidence:

- `npm test` — 80 passing tests
- `npm run typecheck` — passing
- `npm run build` — Next 15.5.25 static export, 20 pages
- `npm run test:browser` — 14 Chromium responsive/fail-closed checks
- `npm run test:integration` — local Supabase with migrations 001–011, Auth/RLS/Edge Functions, Markdown individual/team submission, resource-link flows, Vault create/update/reveal/deactivate/reactivate/audit and stale-secret protection
- `npm run test:edge` — hosted `team-admin`, `operations-settings`, and `staff-secrets` CORS/reachability checks passing
- `git diff --check` — passing
- final `supabase db push --dry-run` — remote database up to date

ProjectDB compatibility is merged through PR #80. Hosted Supabase is current through migration 011 and all required Edge Functions are ACTIVE. ASC_WEB is merged through PR #1 and deployed to Cloudflare Pages project `asc-web`; `https://ssu-asc.com/member/login/` serves the current portal with root-relative assets, and hosted Edge CORS explicitly allows `https://ssu-asc.com`. A least-privilege hosted `PROJECTDB_TOKEN` is provisioned. The first real approval/publish is retained as an operator smoke rather than a release blocker. Entering real shared organization credentials, external resource permission setup, step-up reveal authentication, and periodic production Auth/token inspection remain separate operator actions.
