# Phase 8 Spec — Resource Hub & Link Management

**Status:** Implemented and verified locally + hosted Supabase (2026-09-16)

## Objective

Replace the fixed four-link Google operations settings with a generic semester-scoped resource hub that supports both staff-only operational links and member-visible study/resources.

## Data

### Staff workspace metadata

Keep `staff_workspace_settings` and add `google_account_email text null`.

The existing `form_url`, `candidate_sheet_url`, `operations_drive_url`, and `interview_template_url` columns become deprecated compatibility fields after migration 009 moves non-null values into the resource-link table.

### Resource links

Create `resource_links` with:

- `id uuid primary key`
- `semester text`
- `title text`
- `description text`
- `url text`
- `service text`
- `category text`
- `audience text`
- `sort_order integer`
- `active boolean`
- optimistic `version bigint`
- creator/updater audit IDs and timestamps

Allowed services: `notion`, `google_drive`, `google_docs`, `google_sheets`, `google_forms`, `github`, `discord`, `other`.

Allowed categories: `study`, `project`, `ctf`, `recruitment`, `operations`, `other`.

Allowed audiences: `member`, `staff`.

All resource URLs are absolute HTTPS URLs.

## Migration 009

Create `202609160009_resource_hub.sql`.

It must:

1. add `google_account_email`;
2. create `resource_links` and RLS;
3. migrate non-null Phase 7 fixed Google links exactly once into resource rows;
4. retain old fixed columns for compatibility but remove runtime dependence on them;
5. allow active semester members to read only active `audience='member'` rows;
6. allow active staff to read all current-semester resource rows;
7. deny browser direct mutation.

## Edge Function

Extend existing `operations-settings` rather than adding another privileged function.

Actions:

- `save_metadata`
- `create_link`
- `update_link`
- `deactivate_link`
- `reorder_links`

All actions require active staff. Link updates/deactivation use optimistic versions. Cross-semester mutation is rejected.

## Staff UI

`/member/operations/settings` becomes:

1. `Google 운영 계정` metadata field;
2. link collection management;
3. add/edit/deactivate/move-up/move-down controls;
4. audience selector (`회원 공개`, `운영진 전용`);
5. service/category selectors using native dark controls;
6. explicit external-permission warning.

No heavy grid, drag/drop, OAuth, or external API integration.

## Member Resource Hub

Add `/member/resources` and `자료실` navigation.

Show only current-semester active member-visible resources, ordered by `sort_order`, then title.

Filters:

- 전체
- 스터디
- 프로젝트
- CTF
- 기타

Cards show service, title, description, category and `열기 ↗`.

Do not iframe or mirror external content.

Staff visiting `/member/resources` sees the same member-visible collection; staff-only resources stay in `운영진 설정`.

## External permission boundary

ASC_WEB controls only link discovery. Notion/Google/Discord/GitHub permissions remain authoritative.

A public-by-link Notion page remains reachable to anyone with the URL. A restricted Drive folder still requires Google permission even when a member can see the link in ASC_WEB.

## Existing Notion study assets

Do not migrate content. Add links pointing to existing pages with recommended defaults:

- service `notion`
- category `study`
- audience `member`

## Google handover

`google_account_email` is informational only. Account changes happen through Google sharing/ownership transfer. Update ASC URLs only when copied/recreated resources receive different URLs.

## Public apply boundary

The public `/apply` route remains driven by `public/data/apply.json`. Internal resource links do not update public recruitment configuration.

## Verification

Required:

- migration 009 after 001–008;
- member/staff RLS separation;
- metadata save and optimistic conflicts;
- member link visible to ordinary member;
- staff link hidden from ordinary member;
- deactivation removes member visibility;
- migration of Phase 7 fixed links exactly once;
- `/member/resources` browser fail-closed route;
- full unit/type/build/browser/local integration/hosted edge/diff checks;
- remote dry-run showing only migration 009 before production apply.

## Out of scope

- Google OAuth/API sync
- Apps Script automation
- Notion API/content mirror
- Discord/GitHub API metadata sync
- custom wiki/editor/ATS
- public resource directory
- ACLs beyond member/staff
- link-health monitoring
