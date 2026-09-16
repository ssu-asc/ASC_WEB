# Phase 7 Summary — Final Operations Polish / Google Operations Workspace

**Completed:** 2026-09-16

## Delivered

### Member password reissue

- Existing saved member rows now expose `관리 → 임시 비밀번호 재발급`.
- `member-admin` generates a strong 20-character temporary password server-side and immediately updates Supabase Auth.
- Password generation is shared with `member-bulk`.
- Plaintext reset credentials are returned only in that operation response and reuse the existing one-time credential panel.
- Local integration verifies the newly generated password can actually sign in.

### Deadline-first month calendar

- Assignment `opens_at`/`due_at` data and submission semantics are unchanged.
- Upcoming/list/detail views continue to display the full submission range.
- Month calendar places project entries on `due_at` and labels them `마감`.
- General events remain placed on `start_at`.

### Free Google operations workspace

- Added migration `202609160008_google_operations_settings.sql`.
- Added staff-only `staff_workspace_settings` with one row per semester.
- Stores only four optional URLs: application Form, candidate Sheet, operations Drive/folder, interview Template Doc.
- Added `operations-settings` Edge Function with staff authorization, Google URL-family validation, and optimistic version conflict handling.
- Added `/member/operations/settings` for runtime link editing without rebuilding ASC_WEB.
- Staff navigation always exposes `운영진 설정` and dynamically exposes `면접 / 운영 문서 ↗` when an operations Drive URL is configured.
- Ordinary members cannot read the settings row or invoke the settings Edge Function.

### Google account handover model

- ASC_WEB does not integrate Google OAuth.
- No Google access token, refresh token, service-account key, or password is stored.
- Account changes happen through Google sharing/ownership transfer.
- ASC settings need editing only when copied/recreated Google resources receive new URLs.
- Operator docs call out Form, response Sheet, Drive folder, interview Template, and future Apps Script trigger ownership as separate handover checks.
- Apps Script automation remains out of V1.

### Outline removal

- `NEXT_PUBLIC_ASC_OPS_URL` was removed from source configuration and GitHub Pages build variables.
- The previous Outline plan is marked superseded.
- `/ops/outline/` is ignored as obsolete local scratch and is not a release dependency.
- Final architecture requires no Outline/VPS/Docker service.

## Production backend state

- Hosted Supabase migration 008 is applied; a fresh `supabase db push --dry-run` reports the remote database is up to date.
- Hosted `operations-settings` is ACTIVE, version 2.
- The first local deploy registered metadata but the gateway still returned `NOT_FOUND`; redeploying the unchanged source with `--use-api` registered the hosted route. Hosted smoke now proves CORS and POST reachability for both `team-admin` and `operations-settings`.

## Release boundary

Not performed by this phase:

- public GitHub Pages deployment of the new static frontend;
- creating/transferring the actual Google Form/Sheet/Drive/Doc resources;
- adding Apps Script automation;
- production ProjectDB write-token success-path approval test;
- git commit/push/PR.
