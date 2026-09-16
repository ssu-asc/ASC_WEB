---
phase: 03-staff-review
plan: "03"
type: execute
wave: 1
depends_on: ["02"]
files_modified:
  - src/lib/member-domain.ts
  - src/lib/member-api.ts
  - src/app/member/operations/submissions/page.tsx
  - src/styles/member.module.css
  - supabase/migrations/202609150002_operations.sql
  - supabase/functions/submission-admin/index.ts
  - tests/operations-domain.test.mjs
  - tests/member-contract.test.mjs
  - tests/live-supabase.mjs
autonomous: true
requirements:
  - ADM-01
  - ADM-02
  - ADM-03
  - ADM-04
  - ADM-05
  - STS-02
  - SEC-03
  - SEC-04
  - SEC-05
must_haves:
  truths:
    - Staff status is computed from roster requirements, not only existing submissions.
    - Ordinary members cannot perform review actions.
    - ProjectDB sync failure cannot roll back an ASC approval.
  artifacts:
    - path: src/app/member/operations/submissions/page.tsx
      provides: Staff overview, filters and review actions
    - path: supabase/functions/submission-admin/index.ts
      provides: Trusted review and ProjectDB synchronization
  key_links:
    - from: src/app/member/operations/submissions/page.tsx
      to: supabase/functions/submission-admin/index.ts
      via: Staff review invocation
---

<objective>
Implement roster-based submission operations and durable staff review with safe ProjectDB synchronization.
</objective>

<tasks>
<task type="auto">
  <name>1. Compute semester-wide status from roster</name>
  <files>src/lib/member-domain.ts, src/lib/member-api.ts, tests/operations-domain.test.mjs</files>
  <action>Join active semester membership, active assignments, confirmed teams and submissions. Keep missing, unassigned, waived and review states mutually distinguishable.</action>
  <verify><automated>rtk npm test</automated></verify>
  <done>Overview tests show correct individual missing and team-unassigned behavior.</done>
</task>
<task type="auto">
  <name>2. Add staff review and ProjectDB sync boundary</name>
  <files>supabase/functions/submission-admin/index.ts, supabase/migrations/202609150002_operations.sql</files>
  <action>Require active staff for revision/approval and retry. Persist review first. Synchronize a sidecar archive record through a server-only GitHub credential. Record failed sync without undoing approval.</action>
  <verify><automated>rtk npm run test:integration</automated></verify>
  <done>Local integration proves member review denial, staff approval, durable approval on missing ProjectDB token and approved-write protection.</done>
</task>
<task type="auto">
  <name>3. Build staff status and review UI</name>
  <files>src/app/member/operations/submissions/page.tsx, src/styles/member.module.css, src/component/member/MemberToolbar.tsx</files>
  <action>Render counts, filters, responsive roster-derived rows, pinned report link, review note, approve/revision actions and ProjectDB retry status in the existing ASC visual language.</action>
  <verify><automated>rtk npm run typecheck &amp;&amp; rtk npm run build &amp;&amp; rtk npm run test:browser</automated></verify>
  <done>Staff route statically exports and private data remains fail-closed without Supabase configuration.</done>
</task>
</tasks>

<verification>
Verify domain calculations, RLS denial, Edge Function authorization, approval durability, TypeScript/build regression and Chromium routing. Real ProjectDB write success is a production credential check, not a local source claim.
</verification>

<success_criteria>
Staff can identify missing/unassigned members, review submissions and observe/retry ProjectDB synchronization without exposing privileged credentials or corrupting approval state.
</success_criteria>
