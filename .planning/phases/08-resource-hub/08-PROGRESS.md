# Phase 8 Progress — Resource Hub & Link Management

## Status

**Complete — local + hosted Supabase verified on 2026-09-16.**

## Tasks

- [x] Task 1 — migration 009, `google_account_email`, `resource_links`, RLS, legacy fixed-link migration
- [x] Task 2 — generic `operations-settings` metadata/link CRUD/reorder API + client API
- [x] Task 3 — staff Google account reference + generic link manager UI
- [x] Task 4 — `/member/resources`, category filters, shared `자료실` navigation, old Drive lookup removal
- [x] Task 5 — docs/GSD update, complete local verification, migration 009 production apply, `operations-settings --use-api` deploy, hosted smoke

## Verification Snapshot

- unit/contract: 66 passing
- typecheck: PASS
- static build: 20 pages
- Chromium smoke: 14/14
- local Supabase: migrations 001–009 + Auth/RLS/Edge integration PASS
- hosted Edge smoke: `team-admin` + `operations-settings` PASS
- remote DB dry-run: up to date after migration 009
- `operations-settings`: ACTIVE v3
- `git diff --check`: PASS

## Remaining Release Boundary

- GitHub Pages deployment of the current frontend working tree
- actual external Notion/Google/GitHub/Discord link/share setup by operators
- production ProjectDB write-token success-path validation
- git push/PR/integration choice
