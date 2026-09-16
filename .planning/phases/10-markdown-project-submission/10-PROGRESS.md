# Phase 10 Progress — Markdown Upload → ProjectDB Publish

## Implementation

- [x] Task 1 — migration 011 + Markdown upload validation/persistence
- [x] Task 2 — member `.md` upload UI + new `submission-write` contract
- [x] Task 3 — isolated ProjectDB validator/Notion compatibility changes
- [x] Task 4 — deterministic individual/team ProjectDB report builder + approval publish branch + legacy archive fallback
- [x] Task 5 — exact escaped Markdown draft inspection in staff review
- [x] Task 6 — GSD/operator documentation and local verification
- [ ] Coordinated release — integrate ProjectDB compatibility changes, then deploy migration 011 + changed submission functions
- [ ] Controlled production ProjectDB write-token publish test

## Local evidence

- ASC_WEB `npm test`: 80 passing
- ASC_WEB typecheck: PASS
- ASC_WEB build: PASS, 20 static pages
- ASC_WEB Chromium smoke: 14/14 PASS
- ASC_WEB local Supabase integration: migrations 001–011 + Markdown individual/team submission PASS
- ASC_WEB `git diff --check`: PASS
- ProjectDB isolated worktree unittest: 23/23 PASS
- ProjectDB isolated worktree `git diff --check`: PASS

## Release ordering

1. Integrate ProjectDB `source: asc_web` validator/Notion compatibility changes.
2. Verify ProjectDB tests on the integrated branch/main.
3. Apply ASC_WEB migration 011.
4. Deploy updated `submission-write` and `submission-admin`.
5. Run hosted Edge reachability smoke.
6. Run one controlled real ProjectDB-token Markdown approval and confirm `report-01.md` + existing Notion sync.
7. Deploy the latest static frontend after repository integration choice.
