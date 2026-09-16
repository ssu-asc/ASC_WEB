# Phase 10 Progress — Markdown Upload → ProjectDB Publish

## Implementation

- [x] Task 1 — migration 011 + Markdown upload validation/persistence
- [x] Task 2 — member `.md` upload UI + new `submission-write` contract
- [x] Task 3 — isolated ProjectDB validator/Notion compatibility changes
- [x] Task 4 — deterministic individual/team ProjectDB report builder + approval publish branch + legacy archive fallback
- [x] Task 5 — exact escaped Markdown draft inspection in staff review
- [x] Task 6 — GSD/operator documentation and local verification
- [x] Coordinated release — ProjectDB compatibility merged, migration 011 + changed submission functions deployed, ASC_WEB merged and Pages deployed
- [ ] Controlled production ProjectDB write-token publish test — blocked only on provisioning a least-privilege `PROJECTDB_TOKEN`

## Local evidence

- ASC_WEB `npm test`: 80 passing
- ASC_WEB typecheck: PASS
- ASC_WEB build: PASS, 20 static pages
- ASC_WEB Chromium smoke: 14/14 PASS
- ASC_WEB local Supabase integration: migrations 001–011 + Markdown individual/team submission PASS
- ASC_WEB `git diff --check`: PASS
- ProjectDB isolated worktree unittest: 23/23 PASS
- ProjectDB isolated worktree `git diff --check`: PASS
- ProjectDB PR #80 merged to `main`
- hosted Supabase migration 011 deployed; post-deploy `db push --dry-run` reports up to date
- hosted `submission-write` v5 / `submission-admin` v4 ACTIVE
- ASC_WEB PR #1 merged to `main`
- GitHub Pages run `35118540739`: build/deploy PASS with `NEXT_PUBLIC_BASE_PATH=/ASC_WEB`
- production browser smoke: Member login assets 200; Supabase Auth OPTIONS 200; intentional invalid-login POST 400 handled normally

## Release ordering

1. [x] Integrate ProjectDB `source: asc_web` validator/Notion compatibility changes.
2. [x] Verify ProjectDB tests on integrated `main`.
3. [x] Apply ASC_WEB migration 011.
4. [x] Deploy updated `submission-write` and `submission-admin`.
5. [x] Run hosted Edge reachability smoke.
6. [x] Merge ASC_WEB and deploy the static frontend through GitHub Pages.
7. [ ] Provision a least-privilege `PROJECTDB_TOKEN`.
8. [ ] Run one controlled real Markdown approval and confirm ProjectDB `report-01.md`, immutable commit SHA, and existing Notion sync.
