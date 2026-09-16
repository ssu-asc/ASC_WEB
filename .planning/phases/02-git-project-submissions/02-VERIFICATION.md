# Phase 2 Verification

**Status:** Verified locally

## Requirements checked

- Individual submission is scoped to the authenticated owner.
- Team submission is shared only with confirmed team members.
- Team assignment alone is not counted as submitted.
- Unsafe report paths and malformed GitHub repository inputs are rejected.
- ProjectDB input branch/tag is resolved server-side to a full commit SHA and the referenced `reports/{YYYY}/.../report-NN.md` file is checked at that SHA before persistence.
- Approved submissions reject member overwrite; stale concurrent updates are rejected with optimistic `version` checks.
- First team creation, membership writes and the first team submission are one database transaction.
- Browser has no service-role or ProjectDB credential.
- Existing ProjectDB report tree is untouched.

## Commands / evidence

- `npm test` — passing domain/contract tests.
- `npm run test:integration` — local Supabase migrations, Auth, RLS and `submission-write` tested with real API calls.
- `npm run typecheck` — production TypeScript passed.
- `npm run build` — static export includes `/member/submission`.
- `npm run test:browser` — no-config member routes fail closed and responsive login/header checks pass.

## Production-only validation

Public read access to the real `ssu-asc/ProjectDB` report path and full-SHA resolution are exercised by the local integration test. A real **write** with `PROJECTDB_TOKEN` remains a production deployment check documented in `docs/member-portal-setup.md`.
