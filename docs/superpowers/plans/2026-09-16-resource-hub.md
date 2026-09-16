# Resource Hub & Link Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed four-link Google operations settings with a semester-scoped Google account reference plus reusable external resource links, and add a member-facing `자료실` that exposes only member-visible resources.

**Architecture:** Add forward migration `202609160009_resource_hub.sql` that preserves migration 008 data, adds `google_account_email`, creates RLS-protected `resource_links`, and migrates the four legacy Google URLs into staff-only resource rows. Keep one `operations-settings` Edge Function for staff metadata/link CRUD/reordering, while ordinary member reads use RLS-protected PostgREST. Refactor staff settings into a generic link manager and add `/member/resources` for active-semester member-visible links only.

**Tech Stack:** Next.js 15.5.x, React 19, TypeScript 5, Supabase Auth/Postgres/RLS/Edge Functions, Node test runner, Chromium browser smoke.

**Spec:** `docs/superpowers/specs/2026-09-16-resource-hub-design.md`

## Global Constraints

- Preserve the existing static-export public site and Member dark visual language.
- Do not add Google/Notion/Discord/GitHub OAuth or content synchronization.
- Store only non-secret account-reference metadata and HTTPS links.
- `google_account_email` is reference-only metadata; never a credential.
- Member-visible links are discoverable only to active users with semester access; staff-only links remain unreadable to ordinary members.
- External providers remain the final access-control boundary.
- Keep legacy migration-008 URL columns for compatibility, but new runtime code must not depend on them.
- Use optimistic `version` checks for staff metadata/link updates and soft-delete links with `active=false`.
- Existing team/project/submission/schedule semantics must not change.
- Use TDD: every behavior change starts with a failing test and is verified green before the next task.

---

### Task 1: Add the resource-link data model and forward migration

**Files:**
- Create: `supabase/migrations/202609160009_resource_hub.sql`
- Modify: `tests/member-contract.test.mjs`
- Modify: `tests/live-supabase.mjs`

**Interfaces:**
- Consumes: deployed migration 008 table `public.staff_workspace_settings` and helpers `private.is_active_staff()` / `private.has_semester_access(text)`.
- Produces: `staff_workspace_settings.google_account_email text`, `public.resource_links`, RLS read policies, migrated legacy rows.

- [ ] **Step 1: Write static RED tests for migration 009**

Add contract assertions that migration 009:

```js
const migration = read('supabase/migrations/202609160009_resource_hub.sql');
assert.match(migration, /add column if not exists google_account_email text/i);
assert.match(migration, /create table if not exists public\.resource_links/i);
assert.match(migration, /audience[^\n]*check[^\n]*member[^\n]*staff/is);
assert.match(migration, /service[^\n]*notion[^\n]*google_drive[^\n]*github[^\n]*discord/is);
assert.match(migration, /alter table public\.resource_links enable row level security/i);
assert.match(migration, /private\.has_semester_access\(semester\)/i);
assert.match(migration, /private\.is_active_staff\(\)/i);
assert.match(migration, /form_url[\s\S]*지원서[\s\S]*google_forms[\s\S]*recruitment[\s\S]*staff/i);
assert.match(migration, /candidate_sheet_url[\s\S]*지원자 현황/i);
assert.match(migration, /operations_drive_url[\s\S]*운영 Drive/i);
assert.match(migration, /interview_template_url[\s\S]*면접 Template/i);
```

- [ ] **Step 2: Run the static RED test**

Run:

```bash
rtk npm test -- --test-name-pattern="resource hub migration"
```

Expected: FAIL because migration 009 does not exist.

- [ ] **Step 3: Add live integration RED coverage**

In `tests/live-supabase.mjs`, after creating staff/member sessions:

```js
const memberResourcesBefore = await clients.a.from('resource_links').select('title,audience').eq('semester', '2026-2');
assert.equal(memberResourcesBefore.error, null);
assert.deepEqual(memberResourcesBefore.data, []);

const staffResourcesBefore = await clients.staff.from('resource_links').select('title,audience').eq('semester', '2026-2');
assert.equal(staffResourcesBefore.error, null);
```

After staff-only and member-visible fixtures are created through the function in Task 2, assert ordinary members see only the active `audience='member'` row and cannot see `staff` or inactive rows.

- [ ] **Step 4: Implement migration 009**

Create:

```sql
begin;

alter table public.staff_workspace_settings
  add column if not exists google_account_email text;

create table if not exists public.resource_links (
  id uuid primary key default gen_random_uuid(),
  semester text not null references public.semesters(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 1000),
  url text not null check (char_length(url) between 8 and 2048),
  service text not null check (service in ('notion','google_drive','google_docs','google_sheets','google_forms','github','discord','other')),
  category text not null check (category in ('study','project','ctf','recruitment','operations','other')),
  audience text not null check (audience in ('member','staff')),
  sort_order integer not null default 100 check (sort_order between 0 and 1000000),
  active boolean not null default true,
  version bigint not null default 1 check (version > 0),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists resource_links_semester_visible
  on public.resource_links(semester, audience, active, sort_order, title);

alter table public.resource_links enable row level security;
revoke all on public.resource_links from anon, authenticated;
grant select on public.resource_links to authenticated;
grant all on public.resource_links to service_role;

create policy resource_links_read
on public.resource_links
for select
to authenticated
using (
  (select private.is_active_staff())
  or (
    active
    and audience = 'member'
    and private.has_semester_access(semester)
  )
);
```

Migrate non-null legacy fields with deterministic `where not exists` keys using same semester/title/url so migration never duplicates rows. Keep migration-008 columns in place.

- [ ] **Step 5: Run local reset + static tests**

Run:

```bash
rtk npm test -- --test-name-pattern="resource hub migration"
rtk npm run test:integration
```

Expected: migration 001–009 applies twice through reset; no failures.

---

### Task 2: Generalize `operations-settings` into staff metadata/link management

**Files:**
- Modify: `supabase/functions/operations-settings/index.ts`
- Modify: `src/lib/member-api.ts`
- Modify: `tests/member-contract.test.mjs`
- Modify: `tests/live-supabase.mjs`

**Interfaces:**
- Consumes: migration-009 `resource_links` and `staff_workspace_settings.google_account_email`.
- Produces:

```ts
export type ResourceService = 'notion' | 'google_drive' | 'google_docs' | 'google_sheets' | 'google_forms' | 'github' | 'discord' | 'other';
export type ResourceCategory = 'study' | 'project' | 'ctf' | 'recruitment' | 'operations' | 'other';
export type ResourceAudience = 'member' | 'staff';

export interface StaffWorkspaceMetadata {
  semester: string;
  google_account_email: string | null;
  version: number;
  updated_at: string;
}

export interface ResourceLink {
  id: string;
  semester: string;
  title: string;
  description: string;
  url: string;
  service: ResourceService;
  category: ResourceCategory;
  audience: ResourceAudience;
  sort_order: number;
  active: boolean;
  version: number;
  updated_at: string;
}
```

Client functions:

```ts
readStaffResourceAdmin(client, profile): Promise<{ semester: Semester | null; metadata: StaffWorkspaceMetadata | null; links: ResourceLink[] }>
readMemberResources(client, profile): Promise<{ semester: Semester | null; links: ResourceLink[] }>
saveStaffWorkspaceMetadata(client, { google_account_email, expected_version })
createResourceLink(client, draft)
updateResourceLink(client, draft & { resource_id, expected_version })
deactivateResourceLink(client, { resource_id, expected_version })
reorderResourceLinks(client, { resource_ids })
```

- [ ] **Step 1: Write RED tests for generic actions and validation**

Static tests require action names:

```text
save_metadata
create_link
update_link
deactivate_link
reorder_links
```

and assert the old fixed action `action: "save"` is no longer used by runtime client code.

Integration tests:

1. ordinary member invoking each write action receives `403`;
2. staff saves `google_account_email` and reads it back;
3. invalid email returns `400`;
4. staff creates one member Notion study link and one staff Google Sheet recruitment link;
5. member direct RLS read sees only the member link;
6. stale update returns `409`;
7. invalid `http://` URL returns `400`;
8. deactivate hides the member link from ordinary read;
9. reorder updates deterministic sort order.

- [ ] **Step 2: Run RED tests**

Run:

```bash
rtk npm test -- --test-name-pattern="resource links|workspace metadata"
rtk npm run test:integration
```

Expected: FAIL because new actions/API do not exist.

- [ ] **Step 3: Implement server validators**

Inside `operations-settings/index.ts` add focused validators:

```ts
function cleanGoogleAccountEmail(value: unknown): string | null
function cleanHttpsUrl(value: unknown): string
function cleanTitle(value: unknown): string
function cleanDescription(value: unknown): string
function cleanService(value: unknown): ResourceService
function cleanCategory(value: unknown): ResourceCategory
function cleanAudience(value: unknown): ResourceAudience
```

Email rule: blank/null allowed; otherwise lowercase, max 254, conservative conventional email shape. URL rule: absolute `https:` only, max 2048. Do not domain-restrict resource links.

- [ ] **Step 4: Implement Edge actions**

`save_metadata`:
- current semester only;
- create metadata row with version 1 when none exists and `expected_version=0`;
- otherwise update `google_account_email` with `version+1` and stale conflict `409`;
- leave legacy fixed URL columns untouched.

`create_link`:
- current semester fixed server-side;
- determine initial `sort_order` after current active maximum or accept validated draft order only if plan explicitly sends it;
- set `created_by/updated_by` to current staff.

`update_link`:
- current semester + `id` + expected version;
- update title/description/url/service/category/audience; increment version.

`deactivate_link`:
- current semester + `id` + expected version;
- set `active=false`, increment version.

`reorder_links`:
- validate every supplied ID belongs to current semester and is active;
- reject duplicate IDs;
- assign `sort_order = (index + 1) * 10`;
- update rows in deterministic sequence.

- [ ] **Step 5: Implement client API**

`readStaffResourceAdmin` reads current semester, staff-only metadata, and all `resource_links` ordered by `active desc, sort_order, title`.

`readMemberResources` requires active membership through existing profile/semester flow, queries only `active=true`, `audience='member'`, orders by `sort_order,title`, and relies on RLS as the security boundary.

All writes invoke `operations-settings`.

- [ ] **Step 6: Run targeted + integration tests**

Run:

```bash
rtk npm test -- --test-name-pattern="resource links|workspace metadata"
rtk npm run typecheck
rtk npm run test:integration
```

Expected: PASS.

---

### Task 3: Replace fixed operations settings UI with account metadata + generic link manager

**Files:**
- Modify: `src/app/member/operations/settings/page.tsx`
- Modify: `src/styles/member.module.css`
- Modify: `tests/member-contract.test.mjs`

**Interfaces:**
- Consumes: Task-2 `readStaffResourceAdmin`, metadata/link write functions and types.
- Produces: staff-only UI for Google account reference plus arbitrary staff/member resource links.

- [ ] **Step 1: Write UI RED contract tests**

Require these labels/behaviors:

```text
Google 운영 계정
링크 모음
링크 추가
회원 공개
운영진 전용
Notion
Google Drive
Google Docs
Google Sheets
Google Forms
GitHub
Discord
수정
삭제
```

Assert old fixed form fields are absent from the staff page source as standalone permanent fields:

```text
지원서 Form
지원자 Sheet
운영 Drive
면접 Template
```

They may still appear as migrated link titles in DB tests/docs, not as fixed form controls.

- [ ] **Step 2: Run RED UI test**

Run:

```bash
rtk npm test -- --test-name-pattern="resource link manager"
```

Expected: FAIL against current four-input page.

- [ ] **Step 3: Implement metadata editor**

At top of `/member/operations/settings` show:

```text
Google 운영 계정
[ asc.operations@gmail.com ]
[저장]
```

Copy explains reference-only metadata and that credentials are never stored.

- [ ] **Step 4: Implement resource-link manager**

Show active links first, then inactive links if useful for audit. Each card shows title, service, category, audience, description, external-open action, and staff edit/delete actions.

Use one edit/add form with native selects:

```text
제목
설명
URL
서비스
분류
공개 범위
```

`공개 범위` options exactly `회원 공개` / `운영진 전용`.

Save is explicit. Delete means soft-deactivate after `window.confirm`. Avoid custom dropdowns.

- [ ] **Step 5: Implement simple reorder**

Use accessible `위로` / `아래로` buttons, not drag-and-drop. After local array swap call `reorderResourceLinks` with active IDs in desired order. This is simpler and mobile/keyboard friendly.

- [ ] **Step 6: Verify UI contracts/typecheck**

Run:

```bash
rtk npm test -- --test-name-pattern="resource link manager"
rtk npm run typecheck
```

Expected: PASS.

---

### Task 4: Add the member Resource Hub and simplify navigation

**Files:**
- Create: `src/app/member/resources/page.tsx`
- Modify: `src/component/member/MemberToolbar.tsx`
- Modify: `src/styles/member.module.css`
- Modify: `tests/member-contract.test.mjs`
- Modify: `tests/member-browser.mjs`

**Interfaces:**
- Consumes: Task-2 `readMemberResources` and `ResourceLink`.
- Produces: `/member/resources` showing only active `audience='member'` links, plus `자료실` navigation for both member and staff.

- [ ] **Step 1: Write RED route/navigation tests**

Static contract requires:

```text
/member/resources
자료실
전체
스터디
프로젝트
CTF
기타
열기 ↗
```

Assert toolbar no longer imports/calls `readStaffWorkspaceSettings` or performs a runtime Drive shortcut lookup.

Browser smoke private-route list includes `/member/resources/`.

- [ ] **Step 2: Run RED tests**

Run:

```bash
rtk npm test -- --test-name-pattern="member resource hub|member toolbar"
```

Expected: FAIL because route does not exist and toolbar still fetches Drive settings.

- [ ] **Step 3: Implement member resource hub**

Use `MemberGate`. Load via `readMemberResources(client, profile)`. Render explicit loading/error/empty states.

Category filters:

```text
all
study
project
ctf
other
```

Recruitment/operations categories with `audience='member'` may be placed under `기타` because the member hub intentionally keeps a small filter surface.

Cards show service label, title, optional description, and safe external link:

```tsx
<a href={link.url} target="_blank" rel="noopener noreferrer">열기 ↗</a>
```

Do not iframe or fetch external content.

- [ ] **Step 4: Simplify toolbar**

For active staff:

```text
프로젝트 현황 / 팀 관리 / 회원 관리 / 자료실 / 일정 / 운영진 설정 / 비밀번호 / 로그아웃
```

For members:

```text
내 프로젝트 / 자료실 / 일정 / 비밀번호 / 로그아웃
```

Remove toolbar resource-network lookup and special `면접 / 운영 문서 ↗` shortcut; staff-only links live in settings.

- [ ] **Step 5: Run static/browser checks**

Run:

```bash
rtk npm test -- --test-name-pattern="member resource hub|member toolbar"
rtk npm run build
rtk npm run test:browser
```

Expected: static export includes `/member/resources`; browser smoke private route passes.

---

### Task 5: Complete Phase 8 docs, migration verification, and hosted deployment

**Files:**
- Modify: `.planning/PROJECT.md`
- Modify: `.planning/REQUIREMENTS.md`
- Modify: `.planning/ROADMAP.md`
- Modify: `.planning/STATE.md`
- Modify: `.planning/phases/08-resource-hub/08-CONTEXT.md`
- Modify: `.planning/phases/08-resource-hub/08-SPEC.md`
- Create: `.planning/phases/08-resource-hub/08-PLAN.md`
- Create: `.planning/phases/08-resource-hub/08-PROGRESS.md`
- Create: `.planning/phases/08-resource-hub/08-SUMMARY.md`
- Create: `.planning/phases/08-resource-hub/08-VERIFICATION.md`
- Modify: `docs/member-portal-setup.md`
- Modify: `tests/live-edge-smoke.mjs` only if the existing hosted smoke must include changed `operations-settings` behavior/reachability.

**Interfaces:**
- Consumes: completed Phase-8 implementation.
- Produces: operator documentation, GSD evidence, deployed migration 009/function revision.

- [ ] **Step 1: Update GSD/operator docs**

Document:

- Google operation account is metadata only;
- resource links are arbitrary HTTPS links to Notion/Drive/Docs/Sheets/Forms/GitHub/Discord/etc.;
- member vs staff audience;
- external provider permissions remain authoritative;
- existing Notion study material should be linked, not migrated;
- no Google/Notion OAuth/API sync;
- migration history is 001–009;
- `operations-settings` is still the only link-write Edge Function;
- account handover/share permissions checklist.

- [ ] **Step 2: Run complete local verification**

Run:

```bash
rtk npm test
rtk npm run typecheck
rtk npm run build
rtk npm run test:browser
rtk npm run test:integration
rtk npm run test:edge
rtk git diff --check
```

Expected: all PASS.

- [ ] **Step 3: Verify production migration delta**

Run:

```bash
rtk npx supabase db push --dry-run
```

Expected before deployment: only `202609160009_resource_hub.sql` pending.

- [ ] **Step 4: Apply migration 009**

Run:

```bash
rtk npx supabase db push --yes
```

Verify migration list local/remote match through `202609160009`.

- [ ] **Step 5: Deploy changed Edge Function**

Deploy with the path that already proved reliable for new function routing:

```bash
rtk npx supabase functions deploy operations-settings --use-api
```

Verify `operations-settings` is ACTIVE and its version increments.

- [ ] **Step 6: Run hosted smoke and final dry-run**

Run:

```bash
rtk npm run test:edge
rtk npx supabase db push --dry-run
```

Expected: hosted Edge route reachable/CORS-correct and remote DB up to date.

- [ ] **Step 7: Update Phase-8 completion evidence**

Record exact passing counts/pages/routes and deployment state in `08-VERIFICATION.md`, `08-SUMMARY.md`, `.planning/STATE.md`, and `.planning/ROADMAP.md`.

Do not claim GitHub Pages/public frontend deployment, Google external permission setup, or ProjectDB production token success unless separately verified.
