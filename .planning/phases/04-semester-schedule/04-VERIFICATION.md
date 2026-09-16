# Phase 4 Verification

**Status:** Verified locally

## Verified

- Assignment deadline rows are merged into schedule output without writing duplicate `events` rows.
- Event draft rejects invalid time ranges and non-HTTP(S) links.
- Ordinary member insert into `events` is rejected by actual local RLS.
- Active staff can insert an event; member can read it.
- Schedule page compiles and is included in static export.
- Mobile no-config route fails closed rather than showing fabricated schedule data.

## Evidence

- `npm test`
- `npm run test:integration`
- `npm run typecheck`
- `npm run build`
- `npm run test:browser`
