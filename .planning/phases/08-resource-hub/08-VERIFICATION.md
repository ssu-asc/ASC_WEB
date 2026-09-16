# Phase 8 Verification — Resource Hub & Link Management

**Date:** 2026-09-16
**Result:** PASS

## Contract / unit

Command:

```bash
npm test
```

Result: **66 passing, 0 failures**.

Phase-8 contracts cover:

- migration 009 schema/RLS/legacy-link mapping;
- generic `operations-settings` actions;
- staff resource-link manager;
- member resource hub;
- shared `자료실` navigation;
- removal of runtime dependency on migration-008 fixed URL columns.

## Typecheck

```bash
npm run typecheck
```

Result: PASS.

## Static production build

```bash
npm run build
```

Result: PASS with Next.js 15.5.25 static export, **20 pages**. `/member/resources` and `/member/operations/settings` are included. The pre-existing multiple-lockfile workspace-root warning remains non-fatal.

## Chromium smoke

```bash
npm run test:browser
```

Result: **14/14 PASS**.

Private/fail-closed routes include:

- `/member/`
- `/member/password/`
- `/member/submission/`
- `/member/schedule/`
- `/member/resources/`
- `/member/operations/members/`
- `/member/operations/submissions/`
- `/member/operations/teams/`
- `/member/operations/settings/`

## Local Supabase integration

```bash
npm run test:integration
```

Result: PASS. Disposable local database applies migrations `001–009` through two reset cycles.

Phase-8 integration evidence includes:

- ordinary member cannot read `staff_workspace_settings` metadata;
- ordinary browser cannot directly mutate metadata or `resource_links`;
- ordinary member receives 403 for every privileged operations-settings write action;
- staff saves normalized Google operations account email;
- stale metadata save returns 409;
- invalid email returns 400;
- staff creates member-visible Notion/GitHub links and staff-only Google Sheets link;
- ordinary member RLS read exposes only member-visible active rows;
- staff can read both audiences;
- non-HTTPS link returns 400;
- stale link update returns 409;
- reorder changes deterministic sort order and advances versions;
- soft-deactivation removes the link from ordinary member visibility.

Existing Auth/RLS/member-admin/team/assignment/submission/review/ProjectDB integration coverage remains green.

## Pre-deploy migration dry-run

```bash
npx supabase db push --dry-run
```

Result before deploy: only `202609160009_resource_hub.sql` pending.

## Production deployment

Applied:

```text
202609160009_resource_hub.sql
```

Deployed:

```bash
npx supabase functions deploy operations-settings --use-api
```

Hosted function state after deployment:

```text
operations-settings ACTIVE v3
```

## Hosted Edge smoke

```bash
npm run test:edge
```

Result: PASS for both `team-admin` and `operations-settings` across localhost/127.0.0.1/0.0.0.0 development origins, ASC_WEB 3010 development origin, and GitHub Pages origin. Invalid JWT POST reaches the deployed gateway and returns HTTP 401 rather than a fetch/CORS failure.

## Final remote DB state

```bash
npx supabase db push --dry-run
```

Result: **Remote database is up to date.**

## Diff hygiene

```bash
git diff --check
```

Result: PASS.

## Not verified / separate operator actions

- public GitHub Pages deployment of the current frontend tree;
- actual Notion/Google/GitHub/Discord resource URLs and external sharing permissions;
- production ProjectDB write-token success-path approval;
- git push/PR/merge choice.
