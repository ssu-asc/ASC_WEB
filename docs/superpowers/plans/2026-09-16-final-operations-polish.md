# Final Operations Polish Implementation Plan

> **Superseded note (2026-09-16):** The password-reset and deadline-first calendar portions remain valid. The Outline workspace portion is superseded by `docs/superpowers/plans/2026-09-16-google-operations-workspace.md`; do not deploy Outline or `NEXT_PUBLIC_ASC_OPS_URL` for the final architecture.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore per-member account reissue, make the month calendar deadline-first for projects, and connect staff to a separately hosted Outline operations workspace.

**Architecture:** Preserve the current Supabase schema and fixed-team submission model. Make the account action a privileged `member-admin` operation, keep project schedule ranges in domain data while changing only month-calendar placement, and integrate Outline only as a configurable external staff link plus deployment template.

**Tech Stack:** Next.js 15.5.x, React 19, TypeScript 5, Supabase Auth/Postgres/Edge Functions, Docker Compose, Outline v1.10.1.

**Spec:** `.planning/phases/07-final-operations-polish/07-SPEC.md`

## Global Constraints

- Do not change one-submission-per-team semantics.
- Do not persist one-time account values in portal data or browser storage.
- Keep upcoming/list schedule views as open-to-due ranges.
- Month calendar uses project due_at and general-event start_at.
- ASC_WEB does not embed or fork Outline.
- Outline app image is pinned to v1.10.1.
- Deployment-specific values stay outside tracked source.
- Existing public ASC pages remain unchanged.

---

### Task 1: Restore per-member account reissue

**Files:**
- Modify: `supabase/functions/_shared/security.ts`
- Modify: `supabase/functions/member-admin/index.ts`
- Modify: `supabase/functions/member-bulk/index.ts`
- Modify: `src/lib/member-api.ts`
- Modify: `src/component/member/MemberSpreadsheet.tsx`
- Test: `tests/member-contract.test.mjs`
- Test: `tests/live-supabase.mjs`

**Interfaces:**
- Produce `generateTemporaryPassword(): string` in shared server security helpers.
- Produce `resetMemberPassword(client, memberId)` client API returning `{ ok: true; member_id: string; temporary_password: string }`.

- [ ] Write failing contract tests requiring shared generator usage, typed client API, and a spreadsheet row action.
- [ ] Extend local Supabase integration test: staff reissues one created member, returned value authenticates, ordinary member call is denied.
- [ ] Run focused tests and confirm RED.
- [ ] Move the random generator from `member-bulk` into the shared server helper.
- [ ] Update `member-admin` reset action: when no value is supplied, generate one server-side and return it only in the response.
- [ ] Add `resetMemberPassword` wrapper in `member-api.ts`.
- [ ] Add an existing-row `관리` action in `MemberSpreadsheet`; on success append the returned account info to the current one-time credential panel.
- [ ] Run unit/type/local-Supabase tests and confirm GREEN.

---

### Task 2: Make project month-calendar display deadline-first

**Files:**
- Modify: `src/lib/member-domain.ts`
- Modify: `src/app/member/schedule/page.tsx`
- Test: `tests/operations-domain.test.mjs`
- Test: `tests/member-contract.test.mjs`

**Interfaces:**
- Produce `calendarDateForScheduleItem(item: ScheduleItem): string`.

- [ ] Write failing domain test asserting assignment calendar date equals due/end time while event date equals start time.
- [ ] Write static UI contract test requiring the month grid to call the helper and render project deadline wording.
- [ ] Run focused tests and confirm RED.
- [ ] Implement the pure helper without changing `mergeScheduleItems`.
- [ ] Build the month `byDate` map from the helper and render project entries as `<title> 마감`.
- [ ] Run unit/type/build tests and confirm GREEN.

---

### Task 3: Add staff Outline operations workspace integration

**Files:**
- Modify: `.env.example`
- Modify: `src/component/member/MemberToolbar.tsx`
- Modify: `.github/workflows/deploy-pages.yml`
- Create: `ops/outline/docker-compose.yml`
- Create: `ops/outline/docker.env.example`
- Create: `ops/outline/README.md`
- Test: `tests/member-contract.test.mjs`

**Interfaces:**
- Browser config: `NEXT_PUBLIC_ASC_OPS_URL`.
- Staff-only external link label: `면접 / 운영 문서 ↗`.

- [ ] Write failing static tests for staff-only optional operations link, public build variable wiring, pinned Outline image, and disabled OAuth dynamic registration in the example env.
- [ ] Run focused tests and confirm RED.
- [ ] Add optional operations URL to `.env.example` and toolbar.
- [ ] Update GitHub Pages workflow to map repository variables `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `NEXT_PUBLIC_ASC_OPS_URL` into the build environment.
- [ ] Add Outline Compose template using `docker.getoutline.com/outlinewiki/outline:1.10.1`, Postgres, Redis, local persistent storage, and loopback-only app exposure for an external reverse proxy.
- [ ] Add deployment example with required core settings, `OAUTH_DISABLE_DCR=true`, and placeholders for one supported sign-in provider.
- [ ] Add operator README covering reverse proxy/TLS, sign-in provider setup, public-sharing disablement, backup, and ASC_WEB URL variable.
- [ ] Validate `docker compose config` with a disposable local env file without starting containers.
- [ ] Run unit/type/build tests and confirm GREEN.

---

### Task 4: Update GSD Core and verify the complete portal

**Files:**
- Modify: `.planning/PROJECT.md`
- Modify: `.planning/REQUIREMENTS.md`
- Modify: `.planning/ROADMAP.md`
- Modify: `.planning/STATE.md`
- Create: `.planning/phases/07-final-operations-polish/07-SUMMARY.md`
- Create: `.planning/phases/07-final-operations-polish/07-VERIFICATION.md`
- Modify: `docs/member-portal-setup.md`

- [ ] Update GSD requirements and roadmap with Phase 7 acceptance criteria.
- [ ] Update operator docs for member reissue, deadline-first month calendar, GitHub Actions variables, and Outline workspace setup.
- [ ] Run `npm test`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.
- [ ] Run `npm run test:browser`.
- [ ] Run `npm run test:integration`.
- [ ] Run `npm run test:edge`.
- [ ] Run `git diff --check`.
- [ ] Deploy changed `member-admin` and `member-bulk` Edge Functions only after local integration passes.
- [ ] Re-run deployed Edge smoke and write Phase 7 summary/verification evidence.
