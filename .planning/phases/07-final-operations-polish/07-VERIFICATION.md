# Phase 7 Verification — Final Operations Polish / Google Operations Workspace

**Date:** 2026-09-16
**Result:** PASS

## Source/unit/domain contracts

Command:

```bash
rtk npm test
```

Result: **64 passing, 0 failures**.

Coverage added in this phase includes:

- server-generated existing-member password reissue and one-time UI credential handling;
- project month-calendar placement on `due_at` while list data keeps `opens_at → due_at`;
- migration/RLS/Edge Function contracts for Google operations settings;
- staff settings page and dynamic operations Drive link;
- removal of runtime `NEXT_PUBLIC_ASC_OPS_URL` dependency.

## Type/build

Commands:

```bash
rtk npm run typecheck
rtk npm run build
```

Result: PASS. Next.js 15.5.25 static export generated **19 pages**, including `/member/operations/settings`.

The existing workspace-root multiple-lockfile warning remains non-fatal and unrelated to Phase 7.

## Chromium smoke

Command:

```bash
rtk npm run test:browser
```

Result: **13 passing responsive/fail-closed checks**. `/member/operations/settings/` is included in the private-route smoke set.

## Local Supabase integration

Command:

```bash
rtk npm run test:integration
```

Result: PASS with migrations `001–008` applied on the disposable local database.

Phase 7 integration evidence includes:

- existing-member generated password reissue can authenticate with the new password;
- ordinary member cannot read `staff_workspace_settings`;
- browser direct write to settings is rejected;
- ordinary member `operations-settings` call returns 403;
- staff first save succeeds with version 1;
- stale settings save returns 409;
- unsupported non-Google resource URL returns 400;
- valid update succeeds and increments version.

## Hosted Supabase Edge smoke

Command:

```bash
rtk npm run test:edge
```

Result: PASS.

Both `team-admin` and `operations-settings` pass preflight from:

- `http://localhost:3000`
- `http://127.0.0.1:3000`
- `http://0.0.0.0:3000`
- `http://127.0.0.1:3010`
- `http://0.0.0.0:3010`
- `https://ssu-asc.github.io`

Both deployed endpoints also return HTTP 401 for an invalid JWT instead of failing at fetch/CORS routing.

Deployment note: the initial `operations-settings` deploy appeared ACTIVE in management metadata but the function gateway still returned `NOT_FOUND`. Re-deploying the unchanged function with `rtk npx supabase functions deploy operations-settings --use-api` resolved route registration. Hosted function list now reports `operations-settings` ACTIVE version 2.

## Remote migration state

Before apply:

```text
Would push:
202609160008_google_operations_settings.sql
```

After apply/final verification:

```text
Remote database is up to date.
```

## Diff hygiene

Command:

```bash
rtk git diff --check
```

Result: PASS.

## Deliberate remaining release/operator work

- GitHub Pages has not been redeployed from this working tree.
- Actual Google Form/response Sheet/Drive/Template links have not been created or entered; staff can enter them after frontend deployment.
- Google ownership/share transfer remains an operator action in Google itself.
- Apps Script automation is intentionally not implemented.
- Production ProjectDB write-token approval success path remains a separate controlled check.
- Git commit/push/PR remains undecided.
