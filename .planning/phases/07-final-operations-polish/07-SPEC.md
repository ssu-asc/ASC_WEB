# Phase 7 Spec — Final Operations Polish / Google Operations Workspace

## Goal

Finalise the staff operating experience without adding paid infrastructure:

1. staff can reissue a member's password from spreadsheet member management;
2. project data retains the full submission window while the month calendar emphasises the deadline only;
3. interview/operations collaboration uses Google Forms/Sheets/Drive/Docs links managed by staff in ASC_WEB;
4. changing Google accounts or copied Google resources does not require a frontend redeploy.

## Password reissue

- Existing members have a `관리` action in the member spreadsheet.
- Staff can choose `임시 비밀번호 재발급`.
- The server generates a strong random temporary password and immediately updates Supabase Auth.
- The plaintext password is returned only in that response and reused by the existing one-time credential panel.
- Plaintext passwords are never stored in Postgres, localStorage, sessionStorage, exports, or logs.
- Ordinary members cannot use this action.

## Project schedule presentation

`assignments.opens_at` and `assignments.due_at` remain authoritative and unchanged.

- Upcoming/list/detail views show the complete submission range.
- Month calendar places a project only on `due_at` and labels it `마감`.
- General events remain placed on `start_at`.
- Late submission semantics remain unchanged.

## Google operations workspace

ASC_WEB does not embed or host a Notion clone, Outline, ATS, or Google editor.

For each semester, staff can configure four non-secret HTTPS resources:

- application Form URL;
- candidate response Sheet URL;
- operations Drive/folder URL;
- interview template Google Doc URL.

The settings are stored in Supabase, staff-only, current-semester scoped, and editable without rebuilding/deploying ASC_WEB.

### Account handover

Google authentication is not integrated into ASC_WEB. No OAuth tokens, service-account keys, access tokens, refresh tokens, or Google passwords are stored.

When the Google owner/editor account changes:

1. grant the new account access in Google;
2. transfer ownership when Google permits it, or copy resources to the new account if necessary;
3. remove the old operator's access;
4. change ASC_WEB URLs only when the copied/recreated Google resource URL changed.

The staff settings UI documents that Form, response Sheet, Drive folder, and interview template permissions must each be checked. If Apps Script automation is added later, installable triggers must be recreated under the intended owner account.

Apps Script automation is intentionally out of scope for V1.

## Storage and security

Create `staff_workspace_settings` with one row per semester:

- `semester` primary key;
- `form_url` nullable;
- `candidate_sheet_url` nullable;
- `operations_drive_url` nullable;
- `interview_template_url` nullable;
- `version bigint not null default 1`;
- `updated_by` nullable profile reference;
- `updated_at`.

Browser access:

- ordinary members: no rows;
- active staff: select only through RLS;
- writes: `operations-settings` Edge Function only.

The Edge Function re-checks the caller with `requireStaff(req)`, resolves the current semester server-side, validates Google URL families, and uses optimistic version checks.

## Navigation

Staff navigation includes:

- 프로젝트 현황
- 팀 관리
- 회원 관리
- 일정
- 운영진 설정
- 면접 / 운영 문서 ↗ (only when Drive URL is configured)
- 비밀번호

Members do not see staff settings or Google workspace links.

## Out of scope

- Google OAuth/Sheets API integration;
- Google credentials in Supabase;
- automatic Google account switching;
- Apps Script automation in V1;
- self-hosted Outline or any VPS/Docker dependency;
- rewriting the public `/apply` static recruitment configuration;
- changing the fixed-team or team-shared-submission data model.

## Acceptance

- per-member password reissue changes the real Auth password and generated password can sign in;
- month calendar uses project `due_at`, while list views retain open→due range;
- staff can save/read the four Google links with stale-write protection;
- members cannot read/save staff workspace settings;
- staff navigation dynamically exposes the configured operations Drive;
- no runtime/build dependency on Outline or `NEXT_PUBLIC_ASC_OPS_URL` remains;
- full unit/type/build/browser/local Supabase/hosted Edge smoke gates pass.
