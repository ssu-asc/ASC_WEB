# Phase 7 Plan — Final Operations Polish / Google Operations Workspace

## Task 1 — Restore member password reissue

- Reuse the privileged `member-admin` boundary.
- Add `reissue_password` with server-generated 20-character temporary passwords.
- Share the generator with `member-bulk`.
- Add `관리 → 임시 비밀번호 재발급` to existing member rows.
- Reuse the one-time credential panel; never persist plaintext credentials.
- Verify the generated password can authenticate through real local Supabase Auth.

## Task 2 — Make month calendar deadline-first

- Keep assignment `opens_at → due_at` unchanged in domain/API data.
- Add a pure month-placement helper.
- Place projects on `due_at` in month view and append `마감` to their month label.
- Keep general events on `start_at`.
- Keep upcoming/list/detail ranges unchanged.

## Task 3 — Add free Google operations workspace settings

- Add migration `202609160008_google_operations_settings.sql` with one staff-only settings row per semester.
- Store only four non-secret URLs: Google Form, response Sheet, operations Drive, interview template Doc.
- Add staff-only `operations-settings` Edge Function with strict Google URL-family validation and optimistic version checks.
- Add `/member/operations/settings` for staff to edit links without rebuilding ASC_WEB.
- Add `운영진 설정` to staff navigation and show `면접 / 운영 문서 ↗` only when a Drive URL exists.
- Ordinary members never see or read these settings.

## Task 4 — Remove Outline from release architecture

- Remove `NEXT_PUBLIC_ASC_OPS_URL` from source, `.env.example`, and GitHub Pages workflow.
- Ignore the obsolete local `ops/outline/` scratch directory so it is not part of release content.
- Update GSD/operator docs to Google Forms/Sheets/Drive/Docs.
- Document Google account handover and permission checks.
- Apps Script remains optional and is not implemented in V1.

## Verification

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

Then:

```bash
rtk npx supabase db push --dry-run
rtk npx supabase db push
rtk npx supabase functions deploy operations-settings
```

The dry-run must show only migration `202609160008_google_operations_settings.sql` pending before production apply.
