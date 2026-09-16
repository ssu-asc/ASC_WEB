---
phase: 02-git-project-submissions
plan: "02"
type: execute
wave: 1
depends_on: ["01"]
files_modified:
  - src/lib/member-domain.ts
  - src/lib/member-api.ts
  - src/app/member/page.tsx
  - src/app/member/submission/page.tsx
  - src/styles/member.module.css
  - supabase/migrations/202609150002_operations.sql
  - supabase/functions/_shared/security.ts
  - supabase/functions/submission-write/index.ts
  - tests/operations-domain.test.mjs
  - tests/live-supabase.mjs
autonomous: true
requirements:
  - SUB-01
  - SUB-02
  - SUB-03
  - SUB-04
  - SUB-05
  - SUB-06
  - PDB-01
  - PDB-02
  - PDB-03
  - PDB-04
  - PDB-05
  - STS-01
  - STS-03
  - SEC-02
  - SEC-04
must_haves:
  truths:
    - GitHub Markdown plus a pinned ref is the reviewed artifact; PDF is not duplicated into portal storage.
    - Team membership and team submission are separate states.
    - Approved member submissions cannot be overwritten without staff reopening them.
    - Existing ProjectDB reports and Notion workflow remain untouched.
  artifacts:
    - path: src/app/member/submission/page.tsx
      provides: Individual/team Git submission UI
    - path: supabase/functions/submission-write/index.ts
      provides: Trusted submission/team mutation boundary
  key_links:
    - from: src/app/member/page.tsx
      to: src/app/member/submission/page.tsx
      via: Assignment submission action
    - from: src/app/member/submission/page.tsx
      to: supabase/functions/submission-write/index.ts
      via: Supabase Functions invocation
---

<objective>
Implement Git-based individual/team submission while preserving the current static Next.js deployment and existing ProjectDB format.
</objective>

<tasks>
<task type="auto">
  <name>1. Validate immutable review metadata and team state</name>
  <files>src/lib/member-domain.ts, tests/operations-domain.test.mjs</files>
  <action>Test repository URL, Markdown path and pinned ref validation first. Keep team-unassigned distinct from team-not-submitted and compute shared team state only from confirmed team membership.</action>
  <verify><automated>rtk npm test</automated></verify>
  <done>Domain tests reject unsafe report paths/invalid refs and distinguish missing/team-unassigned states.</done>
</task>
<task type="auto">
  <name>2. Add trusted submission mutation</name>
  <files>supabase/functions/submission-write/index.ts, supabase/migrations/202609150002_operations.sql, src/lib/member-api.ts</files>
  <action>Authenticate the bearer token, require active semester membership, form a team only from eligible members, enforce one team per member/semester, and reject writes to approved submissions. Keep service-role credentials server-only.</action>
  <verify><automated>rtk npm run test:integration</automated></verify>
  <done>Local Supabase integration proves individual submission isolation, shared team visibility and approved-write rejection.</done>
</task>
<task type="auto">
  <name>3. Build member submission form</name>
  <files>src/app/member/page.tsx, src/app/member/submission/page.tsx, src/styles/member.module.css</files>
  <action>Connect dashboard cards to a responsive form using the existing ASC visual language. Show confirmed team members, allow first-time team selection, show review notes, and make approved records read-only.</action>
  <verify><automated>rtk npm run typecheck &amp;&amp; rtk npm run build &amp;&amp; rtk npm run test:browser</automated></verify>
  <done>Submission route exports statically and fails closed when Supabase configuration is absent.</done>
</task>
</tasks>

<verification>
Use unit/domain tests, actual local Supabase Auth/RLS/Edge Function integration, TypeScript, static build and Chromium smoke checks. Do not treat a GitHub URL as proof that the referenced external repository is reachable from production.
</verification>

<success_criteria>
The member can submit individual/team Git report metadata, team members share state, unrelated members cannot read personal submissions, and approval blocks member overwrite.
</success_criteria>
