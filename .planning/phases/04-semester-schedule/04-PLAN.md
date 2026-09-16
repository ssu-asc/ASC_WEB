---
phase: 04-semester-schedule
plan: "04"
type: execute
wave: 1
depends_on: ["03"]
files_modified:
  - src/lib/member-domain.ts
  - src/lib/member-api.ts
  - src/app/member/schedule/page.tsx
  - src/component/member/MemberToolbar.tsx
  - src/styles/member.module.css
  - supabase/migrations/202609150002_operations.sql
  - tests/operations-domain.test.mjs
  - tests/live-supabase.mjs
autonomous: true
requirements:
  - SCH-01
  - SCH-02
  - SCH-03
  - SCH-04
  - SCH-05
  - UI-04
  - SEC-03
must_haves:
  truths:
    - Project deadlines are read from assignments and are not duplicated into events.
    - Ordinary members can read but cannot mutate general events.
    - Staff manages general events with server-enforced RLS.
  artifacts:
    - path: src/app/member/schedule/page.tsx
      provides: Upcoming, monthly and full schedule views
    - path: supabase/migrations/202609150002_operations.sql
      provides: Events schema and staff-only mutation policies
  key_links:
    - from: src/lib/member-api.ts
      to: public.assignments and public.events
      via: merged schedule read
---

<objective>
Add the smallest useful semester calendar while keeping assignment deadlines as the single source of truth.
</objective>

<tasks>
<task type="auto">
  <name>1. Define schedule merge and event validation</name>
  <files>src/lib/member-domain.ts, tests/operations-domain.test.mjs</files>
  <action>Test merging assignment deadlines with event rows, time sorting, event interval validation and safe HTTP/HTTPS links.</action>
  <verify><automated>rtk npm test</automated></verify>
  <done>Domain tests prove deadlines are synthesized rather than duplicated and invalid event drafts fail.</done>
</task>
<task type="auto">
  <name>2. Add event table and RLS</name>
  <files>supabase/migrations/202609150002_operations.sql, src/lib/member-api.ts</files>
  <action>Create current-semester events with read access for active members and insert/update/delete policies restricted to active staff. Keep project deadlines in assignments.</action>
  <verify><automated>rtk npm run test:integration</automated></verify>
  <done>Actual local PostgREST rejects member event writes, accepts staff event writes, and lets members read the event.</done>
</task>
<task type="auto">
  <name>3. Build responsive schedule UI</name>
  <files>src/app/member/schedule/page.tsx, src/component/member/MemberToolbar.tsx, src/styles/member.module.css</files>
  <action>Render upcoming items, monthly grid and full list. Add staff-only event editor for general events. Display project deadlines as read-only synthesized items.</action>
  <verify><automated>rtk npm run typecheck &amp;&amp; rtk npm run build &amp;&amp; rtk npm run test:browser</automated></verify>
  <done>Schedule route exports statically, retains ASC design and mobile layout, and fails closed without Supabase configuration.</done>
</task>
</tasks>

<verification>
Use domain tests, local Supabase RLS integration, TypeScript/static build and Chromium route smoke checks.
</verification>

<success_criteria>
Members see project deadlines and general events together, while only staff can mutate general events and no duplicate deadline record is introduced.
</success_criteria>
