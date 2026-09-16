# ASC Operations Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the 2026-2 portal around staff-managed semester-fixed teams, schedule-created alternating project rounds, late submissions, and round-first operations views without replacing the existing Supabase/Auth/ProjectDB submission pipeline.

**Architecture:** Keep `assignments` as project rounds and `events` as ordinary schedule items. Add forward-only schema fields and privileged Edge Functions for team and assignment administration, then reshape the member/staff pages around those APIs. Preserve RLS, optimistic locking, immutable ProjectDB commit verification, and the existing review flow.

**Tech Stack:** Next.js 15.5.x, React 19, TypeScript 5, Supabase Postgres/Auth/RLS/Edge Functions, Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-09-15-member-operations-redesign.md`

## Global Constraints

- Teams are fixed for one semester and only staff can create or edit them.
- Staff accounts are operational users and default to `individual_required=false`, `team_required=false`.
- Project rounds are stored in `assignments`; ordinary events remain in `events`.
- Alternating series are materialized into independent assignments in one database transaction.
- Submission remains open after `due_at`; late status derives from `first_submitted_at > due_at`.
- Submission before `opens_at` is rejected server-side.
- ProjectDB report validation, full commit SHA resolution, approval durability, and privacy constraints stay unchanged.
- Existing public ASC pages are not redesigned; changes are limited to the Member portal and its APIs.
- All shell commands in this repository begin with `rtk`.

---

### Task 1: Add project-window, late-submission, and versioned-team schema primitives

**Files:**
- Create: `supabase/migrations/202609150007_operations_redesign.sql`
- Modify: `src/lib/member-domain.ts`
- Modify: `src/lib/member-api.ts`
- Test: `tests/member-domain.test.mjs`
- Test: `tests/operations-domain.test.mjs`

**Interfaces:**
- `Assignment` gains `opens_at: string | null` and `version: number`.
- `Team` gains `version: number`.
- `Submission` gains `first_submitted_at: string`.
- `ScheduleItem` gains `project_type: ProjectType | null` so the calendar can label individual vs team project ranges.
- Produce `projectWindowState(assignment, now)` returning `"upcoming" | "open" | "overdue"`.
- Produce `isLateSubmission(submission, assignment)` returning boolean.
- Produce `generateAlternatingRounds(input)` for deterministic client preview only; the server remains authoritative.

- [ ] **Step 1: Write failing domain tests for window state, alternating preview, and late semantics**

Add assertions equivalent to:

```js
assert.equal(projectWindowState({ opens_at: "2026-09-21T00:00:00+09:00", due_at: "2026-09-27T23:59:00+09:00" }, new Date("2026-09-20T12:00:00+09:00")), "upcoming");
assert.equal(projectWindowState({ opens_at: "2026-09-21T00:00:00+09:00", due_at: "2026-09-27T23:59:00+09:00" }, new Date("2026-09-24T12:00:00+09:00")), "open");
assert.equal(projectWindowState({ opens_at: "2026-09-21T00:00:00+09:00", due_at: "2026-09-27T23:59:00+09:00" }, new Date("2026-09-28T00:01:00+09:00")), "overdue");

const preview = generateAlternatingRounds({
  firstOpensAt: "2026-09-21T00:00:00+09:00",
  firstDueAt: "2026-09-27T23:59:00+09:00",
  intervalWeeks: 1,
  count: 4,
  firstType: "individual",
  titlePrefix: "프로젝트",
});
assert.deepEqual(preview.map((round) => round.project_type), ["individual", "team", "individual", "team"]);
assert.equal(preview[3].title, "프로젝트 4회차");

assert.equal(isLateSubmission(
  { first_submitted_at: "2026-09-28T00:01:00+09:00" },
  { due_at: "2026-09-27T23:59:00+09:00" },
), true);
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
rtk npm test -- --test-name-pattern="project window|alternating|late submission"
```

Expected: FAIL because the helpers/fields do not exist.

- [ ] **Step 3: Add migration 007 with forward-only schema changes**

The migration must:

```sql
alter table public.assignments add column if not exists opens_at timestamptz;
alter table public.assignments add column if not exists version integer not null default 1 check (version > 0);
alter table public.teams add column if not exists version integer not null default 1 check (version > 0);
alter table public.submissions add column if not exists first_submitted_at timestamptz;

update public.submissions
set first_submitted_at = submitted_at
where first_submitted_at is null;

alter table public.submissions alter column first_submitted_at set not null;
alter table public.submissions alter column first_submitted_at set default now();

update public.semester_memberships m
set individual_required = false,
    team_required = false
from public.profiles p
where p.id = m.profile_id
  and p.role = 'staff';

update public.assignments
set active = false
where semester = '2026-2'
  and round_key = 'final'
  and due_at is null
  and title in ('개인 프로젝트', '팀 프로젝트');

alter table public.assignments
  add constraint assignments_window_order
  check (opens_at is null or due_at is null or due_at > opens_at);
```

Also add transactional RPCs:

```sql
public.create_assignment_atomic(
  p_semester text,
  p_project_type text,
  p_title text,
  p_description text,
  p_opens_at timestamptz,
  p_due_at timestamptz
)
```

```sql
public.create_assignment_series_atomic(
  p_semester text,
  p_first_opens_at timestamptz,
  p_first_due_at timestamptz,
  p_interval_weeks integer,
  p_count integer,
  p_first_type text,
  p_title_prefix text,
  p_description text
)
```

and:

```sql
public.move_team_member_atomic(
  p_semester text,
  p_profile_id uuid,
  p_expected_team_id uuid,
  p_target_team_id uuid
)
```

`p_expected_team_id` and `p_target_team_id` are nullable; `NULL` means “currently unassigned” and “remove from team” respectively.

Also add:

```sql
public.list_own_team_members(target_semester text default null)
returns table(team_id uuid, team_name text, profile_id uuid, member_id text, name text)
```

and revoke `authenticated` execution on the old `public.list_team_candidates(text)` because ordinary members no longer need the semester-wide candidate roster.

The mutation RPCs are `security definer`, set `search_path=''`, and are callable only by `service_role`. Revoke execution from `public`, `anon`, and `authenticated`, then grant execution to `service_role`. Staff authorization happens in the calling Edge Function through `requireStaff(req)` before the service-role RPC call; this matches the portal's existing privileged-operation boundary and prevents direct browser mutation RPC use.

`create_assignment_atomic` and `create_assignment_series_atomic` both take the same semester-scoped advisory transaction lock and allocate the next numeric suffix among existing `round-NNNN` keys for that semester. The single RPC inserts the exact supplied title; the series RPC validates `1 <= p_count <= 30`, `1 <= p_interval_weeks <= 8`, and `p_first_due_at > p_first_opens_at`, starts at the next number, alternates project type, and inserts all requested rows in the same transaction. This avoids duplicate round identifiers when single rounds and later series are mixed or staff create schedules concurrently.

`move_team_member_atomic` locks the target member's semester membership, validates the member is active and has `role='member'`, reads the current team, compares it with `p_expected_team_id` using null-safe equality, and raises a serialization/stale conflict when they differ. It then removes the current link and inserts `p_target_team_id` when non-null. Because the RPC is service-role-only, it must not trust any caller identity argument; the Edge Function supplies only semester/profile/team identifiers after `requireStaff` succeeds.

`list_own_team_members` remains callable by `authenticated`, derives the caller from `auth.uid()`, requires active semester membership, and returns only the caller's own semester team and teammates.

- [ ] **Step 4: Implement domain fields and helpers**

Add:

```ts
export type ProjectWindowState = "upcoming" | "open" | "overdue";

export function projectWindowState(assignment: Pick<Assignment, "opens_at" | "due_at">, now = new Date()): ProjectWindowState {
  if (!assignment.opens_at || !assignment.due_at) return "upcoming";
  if (now.valueOf() < new Date(assignment.opens_at).valueOf()) return "upcoming";
  if (now.valueOf() <= new Date(assignment.due_at).valueOf()) return "open";
  return "overdue";
}

export function isLateSubmission(
  submission: Pick<Submission, "first_submitted_at">,
  assignment: Pick<Assignment, "due_at">,
): boolean {
  return Boolean(assignment.due_at) && new Date(submission.first_submitted_at).valueOf() > new Date(assignment.due_at!).valueOf();
}
```

Implement `generateAlternatingRounds` with exact week offsets from the initial open/deadline values. Preview rows carry ordinal numbers/titles but do not predict database `round_key` values; the transactional server RPC assigns the authoritative `round-NNNN` keys. Reject non-integer counts/intervals and deadlines not after opens.

Update all assignment/submission/team select field lists in `member-api.ts` to include the new columns.

- [ ] **Step 5: Run domain tests**

Run:

```bash
rtk npm test
```

Expected: PASS.

- [ ] **Step 6: Apply migration locally and run integration baseline**

Run:

```bash
rtk npm run test:integration
```

Expected: local Supabase starts, all migrations including `202609150007_operations_redesign.sql` apply, and existing integration cases pass.

- [ ] **Step 7: Commit the schema/domain slice**

```bash
rtk git add supabase/migrations/202609150007_operations_redesign.sql src/lib/member-domain.ts src/lib/member-api.ts tests/member-domain.test.mjs tests/operations-domain.test.mjs
rtk git commit -m "feat: add scheduled project round primitives"
```

---

### Task 2: Make teams staff-owned and submissions use fixed semester teams

**Files:**
- Create: `supabase/functions/team-admin/index.ts`
- Modify: `supabase/config.toml`
- Modify: `supabase/functions/submission-write/index.ts`
- Modify: `supabase/functions/member-admin/index.ts`
- Modify: `src/lib/member-api.ts`
- Modify: `src/lib/member-domain.ts`
- Test: `tests/member-contract.test.mjs`
- Test: `tests/live-supabase.mjs`

**Interfaces:**
- Produce Edge Function `team-admin` with actions `create_team`, `rename_team`, `assign_member`, `remove_member`, `delete_team`.
- `saveSubmission` no longer accepts `team_name` or `team_member_ids`.
- Team submission resolves the caller's existing `team_members` row only.

- [ ] **Step 1: Add failing contract tests**

Assert the browser/API contract no longer sends team creation fields and that `team-admin` is registered in `supabase/config.toml`.

Add integration cases:

```js
// active staff creates Team A
// staff assigns memberA and memberB to Team A
// memberA team submission succeeds
// memberB reads the same submission row
// ordinary member cannot call team-admin successfully
// team submission by unassigned member returns 409/400 with 팀 미배정 message
```

- [ ] **Step 2: Run focused contract tests and confirm failure**

```bash
rtk npm test -- --test-name-pattern="team-admin|fixed team|team creation"
```

Expected: FAIL.

- [ ] **Step 3: Implement `team-admin`**

Request body shapes:

```ts
type TeamAdminBody =
  | { action: "create_team"; name: string }
  | { action: "rename_team"; team_id: string; expected_version: number; name: string }
  | { action: "assign_member"; team_id: string; profile_id: string; expected_team_id: string | null }
  | { action: "remove_member"; team_id: string; profile_id: string; expected_team_id: string }
  | { action: "delete_team"; team_id: string; expected_version: number };
```

Behavior:

- call `requireStaff(req)`/existing staff guard helper;
- derive current semester server-side;
- create/rename with trimmed 1–100 character names;
- rename with `.eq("version", expected_version)` and increment version;
- assignment calls `move_team_member_atomic(semester, profile_id, expected_team_id, team_id)`;
- removal calls the same RPC with `p_target_team_id = null` and exact expected current team;
- delete only succeeds for exact team version and naturally rejects teams referenced by members/submissions through database constraints;
- map uniqueness/stale conflicts to 409 responses.

- [ ] **Step 4: Remove team creation from `submission-write`**

Replace the current `currentTeamLink`/`create_team_submission_atomic` branch with fixed lookup:

```ts
const { data: teamLink } = await client.from("team_members")
  .select("team_id")
  .eq("profile_id", profile.id)
  .eq("semester", semester)
  .maybeSingle();
if (!teamLink) throw new HttpError(409, "팀 미배정 — 운영진에게 문의해 주세요.");
teamId = teamLink.team_id;
```

Before ProjectDB verification, load `opens_at,due_at` with the assignment and reject if `Date.now() < opens_at` using a 409 message that contains the opening time.

For inserts set:

```ts
const now = new Date().toISOString();
first_submitted_at: now,
submitted_at: now,
```

For updates preserve `first_submitted_at` by omitting it from the update payload while setting only `submitted_at` to now.

- [ ] **Step 5: Make staff creation default to no project requirement**

In `member-admin`, when creating/updating role through the normal UI semantics:

```ts
const individualRequired = role === "staff" ? false : requestedIndividualRequired ?? true;
const teamRequired = role === "staff" ? false : requestedTeamRequired ?? true;
```

Do not remove the database compatibility fields.

- [ ] **Step 6: Add client APIs**

Add:

```ts
export interface TeamAdminSnapshot {
  semester: Semester | null;
  teams: Team[];
  members: RosterRecord[];
  teamMembers: TeamMember[];
}

export interface TeamContext {
  team: Team | null;
  members: TeamCandidate[];
}

export async function readTeamAdminSnapshot(client: SupabaseClient, profile: Profile): Promise<TeamAdminSnapshot>;
export async function readTeamContext(client: SupabaseClient, profile: Profile, semester: string): Promise<TeamContext>;
export async function manageTeam(client: SupabaseClient, body: TeamAdminBody): Promise<{ ok: true }>;
```

`readTeamContext` calls `list_own_team_members` and never loads the semester-wide team candidate roster. Update `saveSubmission` input to only `SubmissionDraft & { assignment_id: string; expected_version?: number }`.

- [ ] **Step 7: Run unit and integration tests**

```bash
rtk npm test
rtk npm run test:integration
```

Expected: fixed-team cases pass and existing review/ProjectDB tests remain green.

- [ ] **Step 8: Commit fixed-team server behavior**

```bash
rtk git add supabase/functions/team-admin supabase/functions/submission-write supabase/functions/member-admin supabase/config.toml src/lib/member-api.ts src/lib/member-domain.ts tests/member-contract.test.mjs tests/live-supabase.mjs
rtk git commit -m "feat: make semester teams staff managed"
```

---

### Task 3: Add staff team-management page and role-aware navigation

**Files:**
- Create: `src/app/member/operations/teams/page.tsx`
- Modify: `src/component/member/MemberToolbar.tsx`
- Modify: `src/styles/member.module.css`
- Test: `tests/member-browser.mjs`

**Interfaces:**
- Consumes `readTeamAdminSnapshot` and `manageTeam` from Task 2.
- Produces `/member/operations/teams` as the sole team-configuration UI.

- [ ] **Step 1: Extend browser checks to require the staff team page/navigation**

Add checks that staff pages render navigation labels:

```text
프로젝트 현황
팀 관리
회원 관리
일정
비밀번호
로그아웃
```

and non-staff pages do not expose `팀 관리` or `회원 관리`.

- [ ] **Step 2: Run browser suite and confirm failure**

```bash
rtk npm run test:browser
```

Expected: FAIL because the team route/navigation does not exist.

- [ ] **Step 3: Implement the team-management page**

The page must show:

- team cards/rows with team name, version, and current members;
- an unassigned-member section;
- create-team form;
- rename action with expected version;
- member move dropdown/action using existing active member rows;
- remove-member action;
- delete button only when the team has no members; server remains authoritative for historical submission protection.

Reload the snapshot after each successful mutation. Keep all mutations behind `MemberGate staffOnly`.

- [ ] **Step 4: Update toolbar by role**

For staff, use:

```text
프로젝트 현황 -> /member/operations/submissions
팀 관리 -> /member/operations/teams
회원 관리 -> /member/operations/members
일정 -> /member/schedule
비밀번호 -> /member/password
```

For members, use:

```text
내 프로젝트 -> /member
일정 -> /member/schedule
비밀번호 -> /member/password
```

- [ ] **Step 5: Add responsive team styles**

Add focused classes for team rows, unassigned warnings, member chips, and mobile stacking; do not create a separate design system.

- [ ] **Step 6: Run browser and type checks**

```bash
rtk npm run typecheck
rtk npm run test:browser
```

Expected: PASS.

- [ ] **Step 7: Commit the staff team UI**

```bash
rtk git add src/app/member/operations/teams/page.tsx src/component/member/MemberToolbar.tsx src/styles/member.module.css tests/member-browser.mjs
rtk git commit -m "feat: add semester team management"
```

---

### Task 4: Add assignment administration and unified recurring project schedule editor

**Files:**
- Create: `supabase/functions/assignment-admin/index.ts`
- Modify: `supabase/config.toml`
- Modify: `src/lib/member-api.ts`
- Modify: `src/app/member/schedule/page.tsx`
- Modify: `src/styles/member.module.css`
- Test: `tests/operations-domain.test.mjs`
- Test: `tests/live-supabase.mjs`
- Test: `tests/member-browser.mjs`

**Interfaces:**
- Produce `assignment-admin` actions `create`, `create_series`, `update`, `deactivate`.
- Produce `saveAssignment`, `saveAssignmentSeries`, `deactivateAssignment` client APIs.
- `readSchedule` maps assignments as a range from `opens_at` to `due_at`.

- [ ] **Step 1: Write failing tests for assignment administration and schedule range mapping**

Integration cases:

```js
// staff creates one individual round with opens_at/due_at
// non-staff assignment-admin call is rejected
// staff creates 4-round alternating series and receives exactly 4 rows
// invalid series request leaves zero rows from that request
// stale assignment update conflicts
```

Domain/API assertion: a project schedule item uses `start_at=opens_at`, `end_at=due_at` and a label identifying individual/team project.

- [ ] **Step 2: Run focused tests and confirm failure**

```bash
rtk npm test -- --test-name-pattern="assignment|schedule range|series"
```

Expected: FAIL.

- [ ] **Step 3: Implement `assignment-admin`**

Request shapes:

```ts
type AssignmentAdminBody =
  | { action: "create"; project_type: ProjectType; title: string; description: string; opens_at: string; due_at: string }
  | { action: "create_series"; first_type: ProjectType; title_prefix: string; description: string; first_opens_at: string; first_due_at: string; interval_weeks: number; count: number }
  | { action: "update"; assignment_id: string; expected_version: number; title: string; description: string; opens_at: string; due_at: string }
  | { action: "deactivate"; assignment_id: string; expected_version: number };
```

Single-create calls `create_assignment_atomic`; series creation calls `create_assignment_series_atomic`. Both RPCs share the same semester advisory lock and global `round-NNNN` sequence. Updates/deactivation require exact `version` and increment it. Deactivation is rejected when the assignment already has submissions so historical work cannot disappear from the portal.

- [ ] **Step 4: Add schedule client APIs and range merge**

Add `manageAssignment(...)` wrapper and update `mergeScheduleItems` so an assignment with `opens_at`/`due_at` produces:

```ts
{
  id: `assignment:${assignment.id}`,
  source: "assignment",
  title: assignment.title,
  category: "project",
  description: assignment.description,
  start_at: assignment.opens_at!,
  end_at: assignment.due_at,
  link_url: null,
  project_type: assignment.project_type,
}
```

General events produce `project_type: null`. Inactive/unscheduled legacy assignments must not appear.

- [ ] **Step 5: Replace staff schedule form with a unified item editor**

The first control is:

```text
일반 일정
개인 프로젝트
팀 프로젝트
개인 ↔ 팀 반복
```

General event continues through `saveEvent`.

Single project shows title, description, open time, deadline.

Alternating series shows first open/deadline, interval weeks, round count, starting type, title prefix, and a client preview generated by `generateAlternatingRounds`.

The preview is read-only and saving sends one `create_series` request.

Editing an existing project assignment supports title/description/open/deadline and deactivation, not changing project type.

- [ ] **Step 6: Run integration/browser/type checks**

```bash
rtk npm run typecheck
rtk npm test
rtk npm run test:integration
rtk npm run test:browser
```

Expected: PASS.

- [ ] **Step 7: Commit project schedule administration**

```bash
rtk git add supabase/functions/assignment-admin supabase/config.toml src/lib/member-api.ts src/lib/member-domain.ts src/app/member/schedule/page.tsx src/styles/member.module.css tests/operations-domain.test.mjs tests/live-supabase.mjs tests/member-browser.mjs
rtk git commit -m "feat: manage recurring project rounds from schedule"
```

---

### Task 5: Replace staff submission overview with round-first individual/team views

**Files:**
- Modify: `src/lib/member-domain.ts`
- Modify: `src/lib/member-api.ts`
- Modify: `src/app/member/operations/submissions/page.tsx`
- Modify: `src/styles/member.module.css`
- Test: `tests/operations-domain.test.mjs`
- Test: `tests/member-browser.mjs`

**Interfaces:**
- Produce `ProjectRoundOverview` and `ProjectRoundDetailRow` domain models.
- Produce `computeProjectRoundOverview(...)` returning one summary per assignment plus detail rows.
- Team assignments collapse to one detail row per team; unassigned active members are a warning list, not submission rows.

- [ ] **Step 1: Add failing overview tests**

Cover:

```js
// staff excluded from individual expected totals
// individual round => one row per active required member
// team round => one row per team regardless of team member count
// active unassigned members listed separately
// late count derives from first_submitted_at
// approved/revision/submitted/missing counts are correct for selected round
```

- [ ] **Step 2: Run focused tests and verify failure**

```bash
rtk npm test -- --test-name-pattern="round overview|one row per team|staff excluded"
```

Expected: FAIL.

- [ ] **Step 3: Implement the round-first domain computation**

Define:

```ts
export interface ProjectRoundSummary {
  assignment: Assignment;
  total_expected: number;
  submitted: number;
  late: number;
  revision_requested: number;
  approved: number;
  window: ProjectWindowState;
}

export interface ProjectRoundDetailRow {
  key: string;
  kind: "member" | "team";
  display_name: string;
  secondary: string;
  member_names: string[];
  state: DisplayState;
  late: boolean;
  submission: Submission | null;
}

export interface ProjectRoundOverview {
  summaries: ProjectRoundSummary[];
  detailsByAssignment: Record<string, ProjectRoundDetailRow[]>;
  unassignedByAssignment: Record<string, Profile[]>;
}
```

Chronologically sort assignments by `opens_at`. Exclude staff from individual expected rows. For team rounds, only semester teams become detail rows; active unassigned members populate warnings.

- [ ] **Step 4: Change `readSubmissionOverview` to return the computed overview inputs/results**

The API must still fetch roster, teams, team_members, assignments, submissions once for the semester, but return the round-first data model instead of the old member × assignment rows.

- [ ] **Step 5: Rebuild the operations page**

UI:

- horizontal/wrapping round strip sorted by time;
- each chip/card shows type, window, `submitted/total`, late, revision, approved;
- selected assignment state stored locally, defaulting to current open round, then latest overdue, then first upcoming;
- detail table changes to member rows for individual rounds and team rows for team rounds;
- separate team-unassigned warning panel;
- filters `전체 / 미제출 / 제출완료 / 지각 / 수정요청 / 승인` plus search;
- preserve existing `ReviewActions` and ProjectDB retry behavior.

- [ ] **Step 6: Run unit/browser checks**

```bash
rtk npm test
rtk npm run typecheck
rtk npm run test:browser
```

Expected: PASS.

- [ ] **Step 7: Commit round-first operations view**

```bash
rtk git add src/lib/member-domain.ts src/lib/member-api.ts src/app/member/operations/submissions/page.tsx src/styles/member.module.css tests/operations-domain.test.mjs tests/member-browser.mjs
rtk git commit -m "feat: show submission status by project round"
```

---

### Task 6: Rebuild member dashboard and submission page around current/next/history and fixed teams

**Files:**
- Modify: `src/lib/member-domain.ts`
- Modify: `src/lib/member-api.ts`
- Modify: `src/app/member/page.tsx`
- Modify: `src/app/member/submission/page.tsx`
- Modify: `src/styles/member.module.css`
- Test: `tests/member-domain.test.mjs`
- Test: `tests/member-browser.mjs`

**Interfaces:**
- Produce `groupDashboardItems(items, now)` returning `{ current, upcoming, history }`.
- Team submission page reads existing fixed team only; there are no team-name/member-picker inputs.

- [ ] **Step 1: Add failing dashboard grouping tests**

Cover:

```js
// open unsubmitted => current
// overdue unsubmitted => current with overdue state
// upcoming => upcoming
// submitted/approved past rounds => history
// staff profile => member dashboard does not produce obligations
```

- [ ] **Step 2: Run focused tests and verify failure**

```bash
rtk npm test -- --test-name-pattern="dashboard grouping|current project|upcoming project"
```

Expected: FAIL.

- [ ] **Step 3: Implement dashboard grouping and richer team context**

`readMemberDashboard` must order assignments by `opens_at` and include fixed team context for team assignments. Staff callers should be redirected by UI before loading obligations.

`groupDashboardItems` must keep overdue/unsubmitted and revision-requested items in `current`; future rounds in `upcoming`; completed historical rounds in `history`.

- [ ] **Step 4: Rebuild `/member`**

For staff, immediately route to `/member/operations/submissions`.

For members, render:

```text
지금 할 프로젝트
다음 프로젝트
지난 프로젝트
```

Current cards show open/deadline range, normal/late marker if submitted, team name/teammates for team rounds, and an actionable submission button when allowed.

Upcoming cards have no submit button.

Team rounds without a team show `팀 미배정 — 운영진에게 문의`.

- [ ] **Step 5: Simplify `/member/submission`**

Delete `teamName`, `selectedMembers`, member picker, and any request fields that create teams.

For team rounds, show read-only team name and teammate chips from `readTeamContext`. If no fixed team exists, show warning and block submit.

Before `opens_at`, show opening time and block submit client-side; the server remains authoritative.

After `due_at`, allow submission and label the action area `지각 제출` for a first submission that has not yet happened.

- [ ] **Step 6: Run tests and build**

```bash
rtk npm test
rtk npm run typecheck
rtk npm run build
rtk npm run test:browser
```

Expected: PASS.

- [ ] **Step 7: Commit the member experience changes**

```bash
rtk git add src/lib/member-domain.ts src/lib/member-api.ts src/app/member/page.tsx src/app/member/submission/page.tsx src/styles/member.module.css tests/member-domain.test.mjs tests/member-browser.mjs
rtk git commit -m "feat: organize member projects by action state"
```

---

### Task 7: Fix dark native controls and finish operations verification

**Files:**
- Modify: `src/styles/member.module.css`
- Modify: `tests/member-browser.mjs`
- Modify: `tests/live-supabase.mjs`
- Modify: `.planning/REQUIREMENTS.md`
- Modify: `.planning/ROADMAP.md`
- Modify: `.planning/STATE.md`
- Modify: `docs/member-portal-setup.md`

**Interfaces:**
- No new runtime API; this task closes visual/accessibility and operator documentation requirements.

- [ ] **Step 1: Add browser assertions for control contrast hooks and all redesigned routes**

Browser smoke checks must visit desktop/mobile widths for:

```text
/member
/member/submission
/member/schedule
/member/operations/submissions
/member/operations/teams
/member/operations/members
```

and assert that the member portal root/control scope exposes dark color scheme and does not render light-on-light select controls.

- [ ] **Step 2: Apply dark native-control CSS**

Add a portal scope such as:

```css
.page {
  color-scheme: dark;
}

.field input,
.field textarea,
.field select,
.filters input,
.filters select,
.search {
  background-color: #171819;
  color: #f5f5f5;
  border-color: rgba(255,255,255,.22);
}

.field select option,
.filters select option {
  background: #171819;
  color: #f5f5f5;
}

.field input:disabled,
.field textarea:disabled,
.field select:disabled {
  background-color: #101112;
  color: rgba(255,255,255,.55);
}
```

Keep existing accent focus outlines and native keyboard behavior.

- [ ] **Step 3: Expand final integration cases**

Ensure `tests/live-supabase.mjs` verifies:

- staff team CRUD/moves;
- member cannot alter teams;
- fixed team shared submission;
- before-open rejection;
- on-time first submission stays on-time after later edit;
- late first submission stays late after later edit;
- atomic alternating series;
- stale team/assignment conflicts;
- last-active-staff protection;
- existing review and ProjectDB failure durability.

- [ ] **Step 4: Update GSD/operator docs**

Update the planning state to describe the new operating model and new migration/function inventory. `docs/member-portal-setup.md` must list migration 007 and deployed functions `team-admin` and `assignment-admin` in addition to the existing functions.

- [ ] **Step 5: Run all final gates**

```bash
rtk npm test
rtk npm run typecheck
rtk npm run build
rtk npm run test:browser
rtk npm run test:integration
rtk git diff --check
```

Expected: every command exits 0.

- [ ] **Step 6: Deploy the forward migration/functions to the already-linked Supabase project after local verification**

First inspect:

```bash
rtk npx supabase db push --dry-run
```

Expected: only the new forward migration(s) from this plan.

Then apply/deploy:

```bash
rtk npx supabase db push
rtk npx supabase functions deploy member-admin
rtk npx supabase functions deploy submission-write
rtk npx supabase functions deploy submission-admin
rtk npx supabase functions deploy team-admin
rtk npx supabase functions deploy assignment-admin
```

Do not expose service-role, database password, or GitHub tokens in command output or chat.

- [ ] **Step 7: Commit verification/docs**

```bash
rtk git add src/styles/member.module.css tests/member-browser.mjs tests/live-supabase.mjs .planning docs/member-portal-setup.md
rtk git commit -m "docs: finalize redesigned member operations"
```
