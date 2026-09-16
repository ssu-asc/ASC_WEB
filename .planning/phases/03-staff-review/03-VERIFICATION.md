# Phase 3 Verification

**Status:** Verified locally

## Verified

- Roster-derived denominator and mutually distinct missing/unassigned/review states.
- Ordinary member direct `UPDATE submissions SET status='approved'` is rejected by RLS.
- Ordinary member invocation of privileged admin operations is rejected.
- Active staff can approve through `submission-admin` only for the exact `expected_version` they reviewed; stale approvals are rejected.
- ProjectDB credential absence leaves approval intact and records sync failure; sync-state persistence errors are checked rather than silently ignored.
- Approved submission cannot be overwritten by ordinary member submission flow.
- ProjectDB sidecar excludes member IDs, student-number-style logins, names, GitHub usernames and review notes.
- Staff review UI compiles and is part of static export.

## Evidence

- `npm test`
- `npm run test:integration`
- `npm run typecheck`
- `npm run build`
- `npm run test:browser`

## Production-only validation

A real `PROJECTDB_TOKEN` success-path write is intentionally left for the deployment checklist because no production credential is stored or passed through this implementation session.
