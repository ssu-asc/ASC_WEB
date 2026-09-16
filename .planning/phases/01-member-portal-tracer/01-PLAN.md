---
phase: 01-member-portal-tracer
plan: "01"
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - package-lock.json
  - .env.example
  - .gitignore
  - src/lib/member-domain.ts
  - src/lib/supabase.ts
  - src/lib/member-api.ts
  - src/component/member/MemberSession.tsx
  - src/component/member/MemberToolbar.tsx
  - src/app/member/layout.tsx
  - src/app/member/page.tsx
  - src/app/member/login/page.tsx
  - src/app/member/password/page.tsx
  - src/app/member/operations/members/page.tsx
  - src/app/header.tsx
  - src/styles/member.module.css
  - src/styles/ui.module.css
  - supabase/migrations/202609150001_member_portal.sql
  - tests/member-domain.test.mjs
  - tests/member-contract.test.mjs
  - tests/member-auth-events.test.mjs
  - tests/member-browser.mjs
  - docs/member-portal-setup.md
autonomous: false
requirements:
  - MEM-01
  - MEM-02
  - MEM-03
  - MEM-04
  - MEM-05
  - AUTH-01
  - AUTH-02
  - AUTH-03
  - ASN-01
  - ASN-02
  - ASN-03
  - STS-01
  - UI-01
  - UI-02
  - UI-03
  - UI-04
  - SEC-01
  - SEC-05
  - SEC-06
  - SEC-07
  - SEC-08
  - SEC-09
must_haves:
  truths:
    - Missing backend configuration never fabricates a member, submission or successful mutation.
    - A member reads only their own semester requirements and own or confirmed-team submission state.
    - Only active staff can read the full roster or issue/reset accounts via a trusted server path.
    - Existing public homepage content and visual assets remain untouched.
  artifacts:
    - path: src/app/member/page.tsx
      provides: Real Supabase-backed member dashboard
    - path: src/app/member/operations/members/page.tsx
      provides: Staff-only semester roster
    - path: supabase/migrations/202609150001_member_portal.sql
      provides: Constrained operational tables and RLS
  key_links:
    - from: src/app/header.tsx
      to: src/app/member/page.tsx
      via: Desktop/mobile Member navigation
    - from: src/lib/member-api.ts
      to: Supabase Auth and Postgres
      via: Publishable client under authenticated RLS
---

<objective>
Implement the approved Member Accounts + Portal phase without redesigning ASC. First finish the read tracer (database contract, login, own status, staff roster), then implement trusted account mutations. A source build is not live integration verification.
</objective>

<context>
@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/01-member-portal-tracer/01-CONTEXT.md
@.planning/phases/01-member-portal-tracer/01-SPEC.md
@.planning/phases/01-member-portal-tracer/01-UI-SPEC.md
</context>

<tasks>
<task type="auto">
  <name>1. Tested operational contract and safe browser client</name>
  <files>src/lib/member-domain.ts, src/lib/supabase.ts, src/lib/member-api.ts, tests/member-domain.test.mjs, tests/member-contract.test.mjs, package.json, package-lock.json, .env.example, .gitignore, supabase/migrations/202609150001_member_portal.sql</files>
  <action>First write and run failing tests for issued-ID validation, current-semester membership, own/team status selection, not-required vs missing vs no-team, query-failure handling and browser configuration. Then implement typed pure helpers and a lazy singleton Supabase browser client. Missing env returns a configuration state, not an import-time exception. Never add privileged keys to .env.example. Create profiles, semesters, semester_memberships, teams, team_members, assignments and submissions with FK/uniqueness/check constraints; seed only semester and two assignment definitions with null deadlines. No real users or fabricated credentials. Enable RLS and revoke browser writes: this tracer provides reads, not an unsafe unrestricted submissions API. Trusted helper functions use a fixed search_path and current auth.uid(), not a caller-supplied user ID.</action>
  <verify><automated>rtk proxy npm test &amp;&amp; rtk proxy npm run typecheck</automated></verify>
  <done>Pure behavior and static contract checks pass; SQL and env templates exist. SQL presence is not recorded as applied or RLS-tested against a real Supabase server.</done>
</task>

<task type="auto">
  <name>2. Login to actual dashboard and read-only staff roster</name>
  <files>src/component/member/MemberSession.tsx, src/app/member/layout.tsx, src/app/member/login/page.tsx, src/app/member/page.tsx, src/app/member/password/page.tsx, src/app/member/operations/members/page.tsx, src/styles/member.module.css, src/app/header.tsx, docs/member-portal-setup.md</files>
  <action>Use one auth provider only inside /member. On logout/session changes clear prior private data and ignore stale asynchronous responses. Expose setup-required, loading, unauthenticated, blocked, error and ready states. Login accepts an issued ID/password; no signup. Read profile and active semester from Supabase. Dashboard derives labels only after successful assignment and submission reads; team unassigned is not team submitted. Staff roster starts from semester_memberships, supports text filtering, and excludes private data from public pages. Members may change their own password using Supabase Auth. New CSS modules inherit existing fonts/background/accent and Header/Footer; add Member links without editing src/app/page.tsx or public/data. Make unfinished submission/roster-mutation controls visibly disabled or omit them. Record setup and live test requirements in docs.</action>
  <verify><automated>rtk proxy npm test &amp;&amp; rtk proxy npm run typecheck &amp;&amp; rtk proxy npm run build &amp;&amp; rtk proxy npm run test:browser</automated></verify>
  <done>Static routes build with and without real env configuration. Browser paths do not expose admin credentials. Runtime checks distinguish tests using fixtures from live Supabase verification.</done>
</task>

<task type="auto">
  <name>3. Trusted member administration</name>
  <files>supabase/functions/member-admin/index.ts, supabase/functions/_shared/security.ts, supabase/migrations/202609150003_staff_guard.sql, src/lib/member-api.ts, src/app/member/operations/members/page.tsx, tests/member-contract.test.mjs, tests/live-supabase.mjs</files>
  <action>Authenticate bearer JWTs with getUser, require the current active database staff role, keep service credentials inside the Edge Function, validate inputs and use compensating Auth cleanup when account/profile creation partially fails. Protect self-demotion in the function and enforce at least one active staff account with a deferred database constraint trigger. Enable staff account create/update/reset forms without exposing auth.admin in the browser.</action>
  <verify><automated>rtk npm test &amp;&amp; rtk npm run test:integration &amp;&amp; rtk npm run typecheck &amp;&amp; rtk npm run build</automated></verify>
  <done>Local integration proves ordinary-member denial, staff account issuance/login, last-active-staff protection and no privileged browser credential.</done>
</task>

<task type="auto">
  <name>4. Local Supabase acceptance and production handoff</name>
  <files>tests/live-supabase.mjs, docs/member-portal-setup.md, .planning/phases/01-member-portal-tracer/01-VERIFICATION.md</files>
  <action>Run the migrations against a disposable local Supabase stack, create real local Auth users, exercise RLS and Edge Function boundaries, then reset the local database. Keep production project creation, secrets and first-staff bootstrap as explicit operator deployment steps rather than claiming they were performed.</action>
  <verify><automated>rtk npm run test:integration &amp;&amp; rtk npm run test:browser</automated></verify>
  <done>Local Auth/RLS/Edge Function acceptance passes and production-only actions are explicitly documented.</done>
</task>
</tasks>

<verification>
Use Node 24 native TypeScript stripping for unit/contract tests, actual local Supabase for Auth/RLS/Edge Function integration, tsc for production types, Next static export for regressions, and Chromium for fail-closed responsive smoke checks. Verify public routes remain present and distinguish local integration proof from production deployment.
</verification>

<success_criteria>
All source tasks and local authorization checks must pass before a SUMMARY marks this plan complete. Production Supabase/ProjectDB configuration remains an operator release step. No automatic commits, pushes or production deployments.
</success_criteria>

<output>
Maintain .planning/STATE.md and 01-PROGRESS.md with completed tasks, exact test evidence and blockers. At actual phase completion produce 01-SUMMARY.md and 01-VERIFICATION.md. Phase 2 begins only after Phase 1 verification.
</output>
