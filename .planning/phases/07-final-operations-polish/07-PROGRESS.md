# Phase 7 Progress — Final Operations Polish / Google Operations Workspace

- [x] Task 1 — spreadsheet member password reissue with generated one-time credential
- [x] Task 2 — deadline-first project placement in month calendar
- [x] Task 3 — current-semester Google Form/Sheet/Drive/Template settings table + Edge Function
- [x] Task 4 — staff settings page + dynamic operations Drive navigation
- [x] Task 5 — remove Outline/runtime `NEXT_PUBLIC_ASC_OPS_URL` dependency from final architecture
- [x] Task 6 — update GSD/operator docs for Google account handover and zero-cost stack
- [x] Task 7 — apply migration 008 and deploy hosted `operations-settings`
- [x] Task 8 — final unit/type/build/browser/local Supabase/hosted Edge/diff verification

## Final evidence

- Unit/static/domain: 64/64 PASS
- TypeScript: PASS
- Next static build: PASS, 19 pages
- Chromium: 13/13 PASS
- Local Supabase: PASS with migrations 001–008
- Hosted Edge: PASS for `team-admin` + `operations-settings`
- Remote DB dry-run after apply: up to date
- `git diff --check`: PASS

## Remaining outside Phase 7

- Public GitHub Pages deployment
- Actual Google resource creation/share/ownership administration and entering their URLs
- Apps Script automation (intentionally deferred)
- Production ProjectDB write-token success-path check
- Git commit/push/PR
