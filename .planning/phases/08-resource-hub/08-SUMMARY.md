# Phase 8 Summary — Resource Hub & Link Management

## Delivered

### Data / migration

- Added `202609160009_resource_hub.sql` after deployed migration 008.
- Added `staff_workspace_settings.google_account_email` as non-secret handover/reference metadata.
- Added `resource_links` with service/category/audience/order/active/version/audit fields.
- Added RLS so ordinary members can read only active `audience='member'` links for semesters they can access, while active staff can read all links.
- Browser direct writes remain denied; privileged writes use the Edge Function.
- Non-null migration-008 fixed Form/Sheet/Drive/Template values are migrated once into staff-only generic link rows. Legacy columns remain only for compatibility and are no longer referenced by runtime source.

### Privileged API

`operations-settings` now supports:

- `save_metadata`
- `create_link`
- `update_link`
- `deactivate_link`
- `reorder_links`

It re-checks the current DB staff role, derives the current semester server-side, validates HTTPS links/email metadata, protects link edits with optimistic versions, and soft-deletes links with `active=false`.

### Staff UI

`/member/operations/settings` now provides:

- `Google 운영 계정` reference email;
- generic link add/edit/delete;
- service/category/audience native selects;
- `회원 공개` / `운영진 전용` boundary;
- accessible `위로` / `아래로` ordering instead of drag-and-drop;
- explicit reminder that external provider permissions remain authoritative.

### Member resource hub

Added `/member/resources` with:

- `전체 / 스터디 / 프로젝트 / CTF / 기타` filters;
- service/title/description cards;
- safe external `열기 ↗` links;
- only member-visible active resources;
- no iframe or external content/API mirroring.

Both member and staff toolbars now expose `자료실`. The previous staff toolbar network lookup and special Drive shortcut were removed. Staff-only links stay in `운영진 설정`.

### Existing external assets

Existing Notion study material is intentionally not migrated. Staff can register it as `notion + study + member` links. The same model supports Google Drive/Docs/Sheets/Forms, GitHub, Discord, and other HTTPS resources.

## Production Supabase

- migration 009 applied to linked `ASC_WEB` project;
- `operations-settings` redeployed with `--use-api` and is ACTIVE v3;
- hosted CORS/invalid-JWT reachability smoke passes;
- final remote DB dry-run reports up to date.

## Explicit Non-Goals Preserved

- no Google/Notion/Discord/GitHub OAuth or API synchronization;
- no Apps Script automation in this phase;
- no embedded wiki/editor/ATS;
- no Outline/VPS/Docker dependency;
- no change to public `/apply` configuration;
- no change to teams, submissions, review, schedule, or ProjectDB semantics.
