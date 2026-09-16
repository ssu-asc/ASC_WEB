# ASC Member Operations Redesign

**Date:** 2026-09-15
**Status:** Implemented and locally verified; hosted Supabase backend deployed

## Goal

Reshape the existing 2026-2 ASC member portal around the club's real operating model:

- staff manage the semester, teams, members, project rounds, and reviews;
- members submit only the project rounds assigned to active members;
- teams are fixed for one semester and are created/edited by staff, never during submission;
- individual and team project rounds alternate on a schedule and can be generated like recurring events;
- submissions remain open after the deadline and are marked late when the first submission happens after the deadline;
- staff see one project round at a time instead of a long member × assignment table;
- member management behaves like a spreadsheet and supports pasted rows plus CSV/XLSX import/export;
- the existing Supabase/Auth/RLS/ProjectDB architecture remains the system of record.

## Design choice

Keep `assignments` and `events` separate in the database, but present them through one schedule UI.

- `assignments` remain the source of truth for project rounds and submission windows.
- `events` remain the source of truth for non-project calendar items such as seminars, CTFs, meetings, presentations, and other events.
- the schedule page merges both sources so staff and members experience one calendar.
- creating a project item from the schedule creates an `assignment`, not a generic `event`.

This avoids rewriting the existing submission and ProjectDB pipeline while still matching the user's mental model of “create an event to open a submission.”

## Roles and navigation

### Staff

Staff are operational users, not project participants by default.

Staff navigation:

1. 프로젝트 현황
2. 팀 관리
3. 회원 관리
4. 일정
5. 비밀번호
6. 로그아웃

Staff accounts must not appear as required individual/team submitters. Existing `semester_memberships.individual_required` and `team_required` fields stay for backward compatibility and exceptional overrides, but normal staff creation/import sets both to `false`; normal active members set both to `true`.

### Members

Member navigation:

1. 내 프로젝트
2. 일정
3. 비밀번호
4. 로그아웃

Members cannot create or edit teams.

## Semester-fixed teams

A member can belong to at most one team per semester. This is already enforced by the current `team_members` primary key `(profile_id, semester)` and will remain the invariant.

### Staff team management

Add `/member/operations/teams`.

The page shows all active semester members and semester teams. Staff can:

- create a team;
- rename a team;
- assign unassigned members to a team;
- move a member between teams;
- remove a member from a team;
- delete an empty team.

Changes apply to all team project rounds in that semester because team membership is semester-scoped, not assignment-scoped.

The server must reject:

- duplicate team names in the same semester;
- assignment of inactive/non-member accounts unless explicitly reactivated first;
- a member being in two teams for the same semester;
- deleting a team that still has members or historical submissions.

### Submission changes

Remove all team-creation inputs from the member submission form. For a team assignment:

- the server looks up the caller's semester team;
- if no team exists, the member sees “팀 미배정 — 운영진에게 문의” and cannot submit;
- if a team exists, all team members share one submission record;
- any member of that team may create or update the shared submission subject to the existing optimistic-version rules;
- the team itself cannot be changed from the submission endpoint.

The existing first-submission `create_team_submission_atomic` path becomes obsolete for normal use and must no longer be reachable from the browser submission flow.

## Project rounds and schedule

### Assignment fields

Extend `assignments` with:

- `opens_at timestamptz`: when the submission becomes available;
- existing `due_at timestamptz`: the deadline;
- existing `project_type`: `individual` or `team`;
- existing `round_key`: stable unique identifier within semester/type;
- existing title, description, active state.

New project assignments require both `opens_at` and `due_at`, with `due_at > opens_at`.

### Unified schedule editor

Staff use one “일정 추가” entry point. The first field selects the item type:

- 일반 일정
- 개인 프로젝트
- 팀 프로젝트
- 개인 ↔ 팀 반복

For a general event, save to `events` using the existing event model.

For a single project round, save one `assignment` with title, description, type, open time, and deadline.

For an alternating project series, the form contains:

- first open time;
- first deadline;
- repeat interval in weeks, default `1`;
- number of rounds;
- starting project type, individual or team;
- title prefix/optional description.

Before saving, show a concrete preview such as:

- 1회차 · 개인 · 09/21–09/27
- 2회차 · 팀 · 09/28–10/04
- 3회차 · 개인 · 10/05–10/11

Saving materializes independent `assignments` immediately. No permanent recurrence rule is needed. This lets staff later move, edit, deactivate, or delete one exam-week round without mutating the rest of the series.

Series generation must be handled server-side in one database transaction so partial series are not left behind.

### Member availability

For a project round:

- before `opens_at`: show 예정; submission form is read-only/unavailable;
- from `opens_at` through `due_at`: submission is open;
- after `due_at`: submission remains open indefinitely and missing work is shown as 마감 지남/미제출;
- approved work remains read-only unless staff reopen it through the existing revision workflow.

## Late submission semantics

Late status is based on the **first successful submission**, not the latest edit.

Add `submissions.first_submitted_at timestamptz`.

- on insert: set both `first_submitted_at` and `submitted_at` to now;
- on later edits/resubmissions: preserve `first_submitted_at`, update `submitted_at` to the latest successful submission time;
- `is_late = first_submitted_at > assignment.due_at` is derived, not a mutable review status.

This keeps review state and timing separate. Examples:

- `제출완료 · 정상`
- `제출완료 · 지각`
- `수정요청 · 지각`
- `승인 · 지각`

## Staff project overview

Replace the current member × every-assignment table with round-first navigation.

### Round strip

At the top, show semester assignments in chronological order. Each round card/chip includes:

- round number/title;
- 개인 or 팀;
- 예정 / 진행중 / 마감;
- submitted count / total expected count;
- late count;
- revision-request count;
- approved count.

Selecting a round updates the detail table below without expanding every other round.

### Individual round details

One row per active required member:

- member name/id;
- state;
- on-time/late marker;
- first/latest submission time;
- project title;
- review action.

Staff accounts are excluded from the expected set.

### Team round details

One row per semester team, not one row per team member:

- team name;
- member count/names;
- state;
- on-time/late marker;
- first/latest submission time;
- project title;
- review action.

Active members not assigned to any team are shown in a separate warning area (“팀 미배정 N명”) rather than duplicated as submission rows.

### Filtering

Detail view supports search and state filters:

- 미제출
- 제출완료
- 지각
- 수정요청
- 승인

## Member project dashboard

Replace the equal-weight card wall with action-oriented sections:

1. **지금 할 프로젝트** — currently open or overdue/unsubmitted rounds requiring action;
2. **다음 프로젝트** — the next scheduled round(s);
3. **지난 프로젝트** — submitted/approved/history rounds.

For a team round, show the fixed team name and teammates. For a member without a team, show the operational warning and no submit action.

Staff visiting `/member` should not see personal submission obligations; direct staff toward the operations overview.

## Spreadsheet-style member management

Rebuild `/member/operations/members` around an editable grid instead of one expandable form per user.

### Main columns

- 로그인 아이디
- 이름
- 권한 (`부원` / `운영진`)
- 이번 학기 활동
- GitHub
- 계정 상태

Internal individual/team-required fields remain server-side compatibility fields and are derived from role in normal UI:

- active member: both true;
- staff: both false.

### Editing

The grid supports:

- direct cell editing;
- add row;
- multi-row selection;
- bulk activation/deactivation;
- bulk role change where valid;
- copy/paste rectangular tabular data from Excel or Google Sheets;
- client validation before save;
- server validation and per-row result reporting.

Changes are not written on every keystroke. Edits become dirty locally, then a single “변경사항 저장” action submits the batch.

### Bulk account creation

For newly pasted/imported users without an existing Auth account:

- the privileged server function creates the Auth account;
- if no temporary password was provided, generate a strong random temporary password server-side;
- never persist plaintext temporary passwords in the database;
- return generated credentials only in that operation's response;
- allow staff to immediately download/copy a one-time credential CSV;
- subsequent password reset remains available per member.

Bulk creation reports row-level success/failure. If Auth creation succeeds but profile creation fails, the function performs best-effort Auth rollback for that row and reports the failure.

### CSV/XLSX

Support:

- CSV import/export;
- XLSX import/export;
- a downloadable template with the supported headers;
- import preview before any server write;
- duplicate-login detection inside the imported file;
- deterministic mapping to the six main columns.

XLSX parsing/writing is loaded only on the member-management route so it does not increase the public site's normal bundle.

### Google Sheets

No Google OAuth or Sheets API synchronization in this milestone. Google Sheets interoperability is through copy/paste and CSV/XLSX files. Direct OAuth sync is explicitly deferred until there is evidence that manual interoperability is insufficient.

## Server/API boundaries

Keep privileged operations in Edge Functions.

### Existing functions

- `member-admin`: continue single-account create/update/password reset; update semantics so staff default to no project requirement.
- `submission-write`: remove member-created team behavior; enforce assignment open time and fixed team lookup; preserve `first_submitted_at`.
- `submission-admin`: keep optimistic review/update behavior and ProjectDB sync.

### New privileged functions

- `team-admin`: semester team CRUD and member assignment/move operations.
- `assignment-admin`: create/update/deactivate single project rounds and atomically materialize alternating series.
- `member-bulk`: validate and apply spreadsheet/import batches, including Auth creation and one-time generated credentials.

All staff functions derive staff identity from the authenticated caller and database profile role; no browser-supplied role is trusted.

## Data integrity and concurrency

Preserve current optimistic locking for member and submission updates.

Add or retain invariants:

- at least one active staff account must remain;
- one team per member per semester;
- one submission per individual owner per assignment;
- one submission per team per assignment;
- team assignment changes are staff-only;
- project series creation is atomic;
- assignment edits use a version field so stale staff forms cannot overwrite newer edits;
- bulk member updates carry expected profile versions for existing rows;
- a project cannot accept a submission before `opens_at`;
- a project continues accepting submissions after `due_at` and derives late status from `first_submitted_at`.

## ProjectDB behavior

ProjectDB integration is unchanged in principle:

- reports still live in `ssu-asc/ProjectDB` as Markdown;
- submission resolves the supplied ref to an immutable full commit SHA and verifies the report path at that SHA;
- approval remains durable even if supplemental ProjectDB sidecar sync fails;
- timing/late metadata may be included in the non-private sidecar, but member IDs/names/GitHub identities and review notes remain excluded.

## Schedule presentation

`readSchedule` merges general `events` and active project `assignments`.

A project schedule item uses:

- `start_at = assignment.opens_at`;
- `end_at = assignment.due_at`;
- category/project-type labeling such as `개인 프로젝트` or `팀 프로젝트`.

Calendar/list views show both open and deadline information as a range instead of treating a project only as a deadline point.

## Dark form controls

Fix the low-contrast native controls across the Member area.

- set `color-scheme: dark` on the member portal/form scope;
- explicitly style `select`, `option`, datetime controls, search fields, and disabled fields with dark backgrounds and light text;
- preserve visible focus outlines using the existing ASC accent color;
- keep native semantics and keyboard accessibility;
- verify Chrome desktop/mobile widths used by the existing smoke suite.

No custom dropdown component is needed unless a browser still fails contrast after explicit native styling.

## Migration strategy

Add forward-only migrations after the existing six migrations.

Expected schema changes include:

- `assignments.opens_at`;
- `assignments.version` if not already present;
- `submissions.first_submitted_at`;
- RPC/constraints for atomic assignment-series creation;
- any team-management RPC required for safe move operations.

Existing placeholder assignments from the initial tracer must not appear as live rounds once real scheduled rounds are introduced. Migration/seed handling must identify only the known placeholder rows and deactivate them without touching real production assignments.

No existing ProjectDB data is migrated or rewritten.

## Error handling

User-facing operations must distinguish:

- stale edit conflict → ask to reload;
- invalid/import row → mark exact row and reason;
- member already assigned to another team → reject/move only through explicit staff action;
- submission before open time → reject with open time;
- no team for team assignment → block submission and direct to staff;
- GitHub/ProjectDB verification outage → preserve current 502-style retriable failure behavior;
- bulk partial failures → keep successful independent rows and clearly report failed rows; do not pretend the whole file succeeded.

Series creation is the exception: it is all-or-nothing because the generated rounds form one requested schedule operation.

## Testing and verification

Extend the current test suite rather than replacing it.

### Domain tests

Cover:

- alternating round generation;
- open/upcoming/overdue classification;
- late derivation from first submission time;
- team overview collapsing to one row per team;
- staff exclusion from expected submitters;
- spreadsheet paste parsing and duplicate detection;
- import/export field normalization.

### Database/integration tests

Using local Supabase:

- staff creates and edits semester-fixed teams;
- member cannot create/change a team;
- team submission is shared among fixed team members;
- submission before `opens_at` is rejected;
- first late submission remains late after later revisions;
- on-time first submission remains on-time after post-deadline revision;
- assignment series creation is atomic;
- stale assignment/member/team updates conflict safely;
- member bulk creation creates Auth/profile/membership correctly;
- last-active-staff guard still holds;
- existing review and ProjectDB sync tests continue to pass.

### Browser tests

Verify:

- staff navigation and member navigation differ correctly;
- round-first operations overview at desktop/mobile widths;
- team management flow;
- member dashboard current/next/history grouping;
- spreadsheet paste/import preview;
- dark select/options/datetime controls are legible;
- existing login/password flows remain functional.

### Final gates

- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run test:browser`
- `npm run test:integration`
- `git diff --check`

## Out of scope

- Google OAuth / Google Sheets API synchronization;
- Discord study management;
- finance/recruitment/general task management;
- score/ranking systems;
- rewriting ProjectDB or its existing Notion sync;
- custom dropdown widgets when native controls meet contrast/accessibility requirements.
