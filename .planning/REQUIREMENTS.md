# Requirements — ASC 2026-2 Member Operations Portal

## In Scope

### MEMBERS / AUTH

- **MEM-01** ASC staff issue member accounts; public self-signup is not provided.
- **MEM-02** Member records include login ID, name, role, account-active state, semester-active state, and optional GitHub username.
- **MEM-03** Staff accounts are operational users and are not normal project submitters; ordinary member accounts are project participants by default.
- **MEM-04** Members can change their own password. Staff can reset an existing member from the spreadsheet row; the privileged server generates a strong temporary password and returns it only in that operation response.
- **MEM-05** The active semester roster is the source of truth for expected project participants.
- **AUTH-01** Issued member/staff accounts can sign in with ASC login ID and password.
- **AUTH-02** Authorization is derived from the database profile role/activity, not user-editable Auth metadata.
- **AUTH-03** Public signup and anonymous access are disabled in production Auth configuration.

### SPREADSHEET MEMBER MANAGEMENT

- **SHEET-01** Staff manage the semester roster in an editable spreadsheet-style grid, not an expandable form per member.
- **SHEET-02** Grid edits are local until an explicit `변경사항 저장` batch action.
- **SHEET-03** Staff can add rows, select multiple rows, and bulk-change role, semester activity, or account activity.
- **SHEET-04** Excel/Google Sheets tab-separated cell ranges can be pasted with or without supported headers.
- **SHEET-05** CSV and XLSX imports require a validation preview before the rows enter the editable grid; previewing never writes to Supabase.
- **SHEET-06** CSV/XLSX export and an XLSX import template are provided. Normal roster exports do not include temporary passwords.
- **SHEET-07** New accounts may omit a temporary password; the privileged server generates a strong random password and returns it only in that operation response.
- **SHEET-08** Plaintext generated credentials are never persisted in the database, localStorage, or sessionStorage.
- **SHEET-09** Existing rows use optimistic profile versions. A failed row in a bulk operation must not roll back independent successful rows.
- **SHEET-10** Direct Google OAuth/Sheets API synchronization is out of scope; interoperability is copy/paste and CSV/XLSX.
- **SHEET-11** Existing saved member rows expose an account-management reset action; generated reset credentials reuse the same one-time current-session credential panel and are never exported with the normal roster.

### SEMESTER TEAMS

- **TEAM-01** Teams are fixed for one semester and are managed only by staff.
- **TEAM-02** A member belongs to at most one team per semester.
- **TEAM-03** Staff can create/rename teams, assign or move members, remove members, and delete only teams that are safe to delete.
- **TEAM-04** Members cannot create or edit team membership from a project submission.
- **TEAM-05** Members may read only the members of their own confirmed semester team; the broad semester candidate roster is not exposed to ordinary members.
- **TEAM-06** Every team-project round reuses the same semester team, and one submission is shared by all confirmed teammates.

### PROJECT ROUNDS / SCHEDULE

- **ASN-01** Project rounds are represented by `assignments` with project type, title, description, `opens_at`, `due_at`, active state, stable round key, and optimistic version.
- **ASN-02** Staff can create a single individual or team project round from the schedule UI.
- **ASN-03** Staff can materialize an alternating individual ↔ team project series with a chosen start type, interval, and count.
- **ASN-04** Series creation is atomic; generated rounds are independent after creation so one exam-week round can later be edited/deactivated without changing the rest.
- **ASN-05** A member cannot submit before `opens_at`.
- **ASN-06** Submission remains available after `due_at`; overdue missing work remains actionable rather than being closed.
- **SCH-01** Members see project submission windows and general ASC events in one schedule UI.
- **SCH-02** General events remain stored separately from project assignments.
- **SCH-03** Staff can create/edit/delete general events and create/edit/deactivate project rounds.
- **SCH-04** Calendar/list views work on mobile and desktop and use Asia/Seoul for display.
- **SCH-05** Project data retains the full `opens_at → due_at` range, but the month calendar places the project only on `due_at` as a deadline; upcoming/list/detail views continue to show the full range.

### SUBMISSIONS

- **SUB-01** Individual submissions belong only to the member and assignment.
- **SUB-02** Team submissions belong to the fixed semester team and assignment; any confirmed teammate may create/update the shared submission.
- **SUB-03** An unassigned member cannot submit a team project and receives an explicit `팀 미배정` state.
- **SUB-04** A Phase-10 submission includes optional short description, optional GitHub code repository, and one required UTF-8 Markdown (`.md`) file body stored as text until approval.
- **SUB-05** Markdown uploads are limited to 262,144 UTF-8 bytes, safe `.md` basenames, non-empty text, and no member-supplied leading YAML frontmatter.
- **SUB-06** Members never choose ProjectDB repository path, branch, tag, or commit ref; the assignment title and authenticated owner/team are authoritative.
- **SUB-07** Approved work is read-only to members until staff reopen it as `수정요청`.
- **SUB-08** Member resubmission and staff review use optimistic submission versions so stale writes conflict safely.
- **SUB-09** `first_submitted_at` is preserved across later edits. `submitted_at` records the latest successful submit/update.
- **SUB-10** Late state is derived from `first_submitted_at > due_at`; late timing is independent from review state.
- **SUB-11** Reopened/resubmitted Markdown clears stale publication URL/path/ref fields until the next successful ProjectDB publish.

### STAFF PROJECT OVERVIEW / REVIEW

- **ADM-01** The staff overview is round-first rather than one long member × assignment table.
- **ADM-02** Each round shows expected/submitted/late/revision/approved counts.
- **ADM-03** Individual rounds show one row per expected active member and exclude staff.
- **ADM-04** Team rounds show one row per semester team, not one row per team member.
- **ADM-05** Active project members without a team are listed separately as unassigned warnings for team rounds.
- **ADM-06** Staff can filter/search the selected round and inspect the exact stored Markdown filename, byte size, and escaped source text before approval.
- **ADM-07** Staff can change a submitted item to `수정요청` or `승인` with an optional review note.
- **ADM-08** Staff-only operations are enforced server-side and are not available to ordinary members.
- **ADM-09** After successful publication, staff can open the immutable ProjectDB report link; failed publication remains retryable without rolling back approval.

### MEMBER DASHBOARD

- **DASH-01** Members see project rounds grouped into `지금 할 프로젝트`, `다음 프로젝트`, and `지난 프로젝트`.
- **DASH-02** Team rounds show the member's fixed team and teammates.
- **DASH-03** Staff visiting `/member` are directed to the operations project overview rather than personal submit obligations.

### PROJECTDB

- **PDB-01** Existing `ssu-asc/ProjectDB` Markdown reports and Git history remain the report system of record for both team and individual projects; no second report repository is created.
- **PDB-02** New Markdown-backed submissions are published only after staff approval; ASC_WEB generates trusted frontmatter/path and writes `report-01.md` through the server-side GitHub Contents API.
- **PDB-03** Team reports use fixed-team ProjectDB paths; individual reports use `reports/{year}/개인/{member_id}-{round_key}-{project}/report-01.md`.
- **PDB-04** Portal-generated reports use `source: asc_web` and `project_type: individual|team`; `cl_level` and `contributions` are optional rather than fabricated.
- **PDB-05** Existing legacy ProjectDB report validation/Notion synchronization remains backward compatible; individual portal reports skip team tracking-checkbox updates.
- **PDB-06** Historical ASC submissions without stored Markdown keep the legacy versioned `portal-index/...json` synchronization path.
- **PDB-07** ProjectDB synchronization failure must not roll back a persisted submission or approval; sync state can fail/retry independently.

### RESOURCE HUB / STAFF OPERATIONS WORKSPACE

- **RES-01** Active staff manage a generic current-semester external resource-link collection in `/member/operations/settings`.
- **RES-02** Resource-link metadata contains no provider password, OAuth token, refresh token, service-account key, recovery code, or other secret.
- **RES-03** Resource links support service (`notion`, `google_drive`, `google_docs`, `google_sheets`, `google_forms`, `github`, `discord`, `other`), category (`study`, `project`, `ctf`, `recruitment`, `operations`, `other`), audience (`member`, `staff`), ordering, active state, and optimistic version.
- **RES-04** Ordinary members may read only active current-semester `audience='member'` resources. Active staff may manage both member and staff resources.
- **RES-05** Members and staff have `/member/resources`; it shows only member-visible resources so staff-only operational links remain confined to `운영진 설정`.
- **RES-06** Existing Notion study content is linked in place rather than copied, mirrored, or migrated into ASC_WEB.
- **RES-07** ASC_WEB controls portal discovery only. External Notion/Google/GitHub/Discord permissions remain authoritative even after a link is visible in ASC_WEB.
- **RES-08** Changing Google accounts is handled by Google sharing/ownership transfer. Staff update the non-secret 운영진 메모 and only those resource URLs that actually changed after copy/recreation.
- **RES-09** Google Forms/Sheets remain recruitment intake/raw data; the public `/apply` configuration remains separate from internal staff resource links.
- **RES-10** Direct external API synchronization, Apps Script automation, an embedded editor/ATS, and Outline/VPS/Docker infrastructure are out of scope.

### STAFF SHARED SECRETS

- **VAULT-01** Active staff have one organization-global `운영진 메모` for non-secret handover information such as Google account address, Instagram handle, GitHub organization, and ownership notes.
- **VAULT-02** Staff are explicitly warned not to place passwords/tokens in the memo; shared passwords/secrets use a separate encrypted credential flow.
- **VAULT-03** Shared organization credentials store only metadata in portal tables; plaintext secret values are stored through Supabase Vault and referenced by Vault secret UUID.
- **VAULT-04** Browser roles have no direct access to Vault, secret metadata tables, secret audit tables, or service-role-only secret RPCs.
- **VAULT-05** A dedicated `staff-secrets` Edge Function re-checks active staff for list/create/update/reveal/deactivate/reactivate/audit operations.
- **VAULT-06** Credential lists never contain plaintext secrets. Plaintext is returned only after explicit audited reveal/copy and uses `Cache-Control: no-store`.
- **VAULT-07** Revealed plaintext stays only in short-lived React state, auto-clears within 30 seconds, and is never written to localStorage/sessionStorage/IndexedDB/URL/export/log/analytics.
- **VAULT-08** Secret metadata updates/deactivation use optimistic versions; stale requests must fail before any Vault secret mutation.
- **VAULT-09** Secret create/update/reveal/deactivate/reactivate operations write audit rows with actor/action/time but never secret content.
- **VAULT-10** V1 uses reversible deactivate/reactivate rather than permanent Vault deletion and may show the most recent 50 audit events to active staff.
- **VAULT-11** Phase 9 uses Supabase Vault, not custom application AES key management or deprecated pgsodium transparent-column encryption.
- **VAULT-12** Step-up MFA/re-authentication before reveal is deferred; an already-compromised active staff session remains capable of explicit reveal.

### DESIGN / ACCESSIBILITY

- **UI-01** Existing public ASC pages retain their structure and visual behavior except for the intentional Member navigation entry.
- **UI-02** The Member area reuses the ASC dark visual language and works on desktop/mobile.
- **UI-03** Native selects/options/datetime/search/disabled controls remain keyboard-accessible and have explicit dark backgrounds/light text so controls are legible.
- **UI-04** No custom dropdown implementation is required when native controls meet contrast and accessibility needs.

### SECURITY / DATA

- **SEC-01** Row Level Security protects browser reads/writes; client-side visibility is never the authorization boundary.
- **SEC-02** Browser configuration contains only Supabase project URL + publishable key; service-role/secret keys and ProjectDB credentials remain server-side. Vault plaintext is returned only by explicit staff reveal responses and is never embedded in build-time configuration.
- **SEC-03** Privileged member/team/assignment/submission-review operations execute through authenticated Edge Functions that re-check the current database role.
- **SEC-04** The database prevents removal of the last active staff account, including concurrent cross-deactivation.
- **SEC-05** One team per member/semester and one submission per owner/team per assignment remain database invariants.
- **SEC-06** Team moves and assignment edits use concurrency checks; stale operations must not silently overwrite newer state.
- **SEC-07** Missing configuration/API errors/loading/inactive membership are explicit states and never become fake successful data.
- **SEC-08** No CAPTCHA bypass, anonymous account abuse, temporary-email workflow, or equivalent authentication workaround is part of this portal.

## Out of Scope

- Google OAuth / Google Sheets API synchronization
- Discord study assignment/progress management
- built-in Notion-like documents/databases inside ASC_WEB
- finance/accounting
- built-in recruitment/ATS workflow (external Google Forms/Sheets/Drive/Docs are allowed)
- Google OAuth / Google API token synchronization
- Apps Script automation in V1
- self-hosted Outline/VPS/Docker operations workspace
- Kakao/Solapi notifications
- scoring/rankings
- public member signup
- general-purpose task/project management
- public ASC homepage redesign
- rewriting ProjectDB or its existing Notion synchronization

## Acceptance Summary

A release is acceptable when:

1. issued member/staff accounts authenticate against real Supabase Auth;
2. staff, teams, and expected submitters match the semester roster and fixed-team model;
3. staff can generate single/alternating scheduled project rounds;
4. members can submit only after opening time and can still submit after the deadline with late state derived from first submission;
5. staff project overview is round-first and team projects are not duplicated per teammate;
6. members upload Markdown rather than ProjectDB refs; staff approval generates a trusted individual/team ProjectDB report and persists the returned immutable commit SHA while review/sync behavior remains durable;
7. roster editing supports spreadsheet cells, Google Sheets/Excel paste, CSV/XLSX preview/import/export, and row-level batch results;
8. privileged operations and last-staff/team/submission constraints pass real local Supabase integration tests;
9. member controls and responsive layouts pass real Chromium smoke tests;
10. staff can reset an existing member and receive a one-time generated temporary password without storing it in portal data;
11. month calendar project entries are deadline-first while list/detail keeps the full submission window;
12. staff can save/read generic member/staff resource links, with stale writes rejected, while non-secret account handover notes live in the separate global 운영진 메모;
13. ordinary members can open member-visible Notion/Drive/GitHub/Discord/etc. links from `/member/resources` but cannot discover staff-only links;
14. changing resource URLs does not require a frontend rebuild and no external document server is required;
15. staff can keep non-secret handover notes separately from Vault-backed shared credentials, and ordinary members cannot access either;
16. shared secrets are never returned by list operations, reveal is audited/no-store/short-lived, stale secret updates do not mutate Vault, and inactive secrets cannot be revealed;
17. ProjectDB legacy validator/Notion-sync behavior remains green while `source: asc_web` individual/team reports validate without fabricated CL/contribution metadata;
18. existing public ASC pages remain unchanged except for the Member entry.
