# Phase 1 Verification

**Status:** Verified locally

## Verified

- Migration applies to a fresh local Supabase database.
- Real local Auth login works for issued member identities.
- Ordinary members cannot read another member's full profile.
- Staff can read the roster; ordinary members cannot use `member-admin`.
- Staff can issue an account through `member-admin`, and the new account can authenticate.
- Database guard serializes active-staff count changes, rejects removing the last active staff account, and preserves at least one active staff during concurrent cross-deactivation.
- Missing configuration fails closed instead of showing mock private data.
- TypeScript/static export and responsive Chromium smoke tests pass.

## Evidence

- `npm test`
- `npm run test:integration`
- `npm run typecheck`
- `npm run build`
- `npm run test:browser`

## Production boundary

Production signup policy, deployment secrets and initial staff bootstrap must still be configured by the operator. Those are deployment steps rather than missing source implementation.
