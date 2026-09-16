# ASC Resource Hub & Link Management Design

**Date:** 2026-09-16
**Status:** Chat design approved; written spec pending final user review

## Goal

Generalize the current fixed Google operations settings into a semester-scoped ASC link hub that serves both staff operations and member study/resources without copying Notion/Drive/GitHub/Discord content into ASC_WEB.

The final model is:

- staff store a non-secret Google operations account identifier for handover/reference;
- staff manage a reusable collection of external links;
- each link is either visible to all active semester members or only to active staff;
- members get a new `자료실` page containing member-visible resources such as existing Notion study pages, Drive folders, GitHub repositories, Discord, and other links;
- staff use the same resource collection for staff-only recruitment/operations links;
- external service permissions remain authoritative. ASC membership controls discovery inside ASC_WEB, not the external service's own access policy.

## Existing System Boundary

The current portal already has:

- Supabase Auth/profile/semester membership and staff authorization;
- `staff_workspace_settings` with four fixed Google URL columns for the current semester;
- an authenticated `operations-settings` Edge Function;
- staff `/member/operations/settings` UI;
- staff toolbar runtime lookup of `operations_drive_url`;
- Google Forms/Sheets for recruitment and existing Notion/Drive/GitHub/Discord assets outside ASC_WEB.

Phase 8 replaces the fixed four-link model without changing project submission, team, review, ProjectDB, or schedule semantics.

## Architecture Choice

Use two database concepts instead of embedding a document system:

1. `staff_workspace_settings` remains one row per semester and becomes staff metadata only, primarily `google_account_email` plus optimistic version/audit fields.
2. `resource_links` stores external resources as rows with title, URL, audience, service, category, ordering, active state, and optimistic version.

ASC_WEB remains a link/index layer. It does not call Notion APIs, Google APIs, Discord APIs, or GitHub APIs to mirror external content.

## Data Model

### staff_workspace_settings

Keep the existing table for compatibility and add:

```text
google_account_email text null
```

The existing fixed columns:

```text
form_url
candidate_sheet_url
operations_drive_url
interview_template_url
```

become deprecated compatibility columns after their values are migrated to `resource_links`. New UI/API code must not depend on them.

`google_account_email` is reference metadata only. It is not a login credential and must not be used for OAuth or password recovery.

Validation:

- null/blank is allowed;
- otherwise normalize trim + lowercase;
- accept a conventional email-like address up to 254 characters;
- never store a password, OAuth token, service-account key, recovery code, or secret.

### resource_links

Create a new table:

```text
id uuid primary key
semester text not null references semesters(id)
title text not null
description text not null default ''
url text not null
service text not null
category text not null
audience text not null
sort_order integer not null default 100
active boolean not null default true
version bigint not null default 1
created_by uuid null references profiles(id)
updated_by uuid null references profiles(id)
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

Allowed `service` values:

```text
notion
google_drive
google_docs
google_sheets
google_forms
github
discord
other
```

Allowed `category` values:

```text
study
project
ctf
recruitment
operations
other
```

Allowed `audience` values:

```text
member
staff
```

`member` means active members of that semester may discover the link. Active staff may also see member links.

`staff` means only active staff may discover the link through ASC_WEB.

URLs must be absolute HTTPS URLs. Do not restrict member resources to Google domains because existing Notion, GitHub, and Discord links are required.

## Forward Migration

Add migration `202609160009_resource_hub.sql` after deployed migration 008.

Migration responsibilities:

1. add `google_account_email` to `staff_workspace_settings`;
2. create `resource_links` and indexes/constraints/RLS;
3. migrate each non-null fixed URL from `staff_workspace_settings` into one `resource_links` row for the same semester;
4. preserve the old columns for rollback/compatibility, but stop using them in runtime code;
5. use deterministic conflict-safe migration behavior so applying the migration once does not duplicate links.

Initial migrated mappings:

| Existing field | Title | Service | Category | Audience |
|---|---|---|---|---|
| `form_url` | 지원서 | `google_forms` | `recruitment` | `staff` |
| `candidate_sheet_url` | 지원자 현황 | `google_sheets` | `recruitment` | `staff` |
| `operations_drive_url` | 운영 Drive | `google_drive` | `operations` | `staff` |
| `interview_template_url` | 면접 Template | `google_docs` | `recruitment` | `staff` |

## Authorization / RLS

`resource_links` uses RLS.

Read policy:

- active staff can read active and inactive links for the current/relevant semester because they manage the collection;
- ordinary authenticated users can read only `active=true`, `audience='member'` rows for semesters they can access through `private.has_semester_access(semester)`;
- ordinary members can never read `audience='staff'` rows.

Browser direct mutation is not granted.

Create/update/delete/reorder operations run only through the authenticated staff Edge Function.

`staff_workspace_settings` remains staff-readable only.

## Edge Function

Keep one `operations-settings` Edge Function rather than adding another function.

Supported actions become:

```text
save_metadata
create_link
update_link
deactivate_link
reorder_links
```

`save_metadata` updates `google_account_email` using optimistic `expected_version`.

`create_link` validates and inserts one current-semester resource.

`update_link` requires `resource_id` and `expected_version` and updates only the current-semester row.

`deactivate_link` soft-deletes with `active=false` and an optimistic version check. The staff UI may call this "삭제" while preserving the database row.

`reorder_links` accepts an ordered list of visible resource IDs and writes deterministic `sort_order` values. It must reject resources outside the current semester.

All actions call `requireStaff(req)` before privileged work.

## Client API

Replace the fixed `StaffWorkspaceSettings` interface with:

```ts
interface StaffWorkspaceMetadata {
  semester: string;
  google_account_email: string | null;
  version: number;
  updated_at: string;
}

interface ResourceLink {
  id: string;
  semester: string;
  title: string;
  description: string;
  url: string;
  service: ResourceService;
  category: ResourceCategory;
  audience: "member" | "staff";
  sort_order: number;
  active: boolean;
  version: number;
}
```

Client helpers:

```text
readStaffResourceHub(...)
saveStaffWorkspaceMetadata(...)
createResourceLink(...)
updateResourceLink(...)
deactivateResourceLink(...)
reorderResourceLinks(...)
readMemberResources(...)
```

Staff reads include inactive rows for management. Member reads only return member-visible active rows through RLS.

## Staff UX

Route remains:

```text
/member/operations/settings
```

Page title remains `운영진 설정`.

### Google operations account

Show one field:

```text
Google 운영 계정
asc.operations@gmail.com
```

Copy explains that this is handover/reference metadata only and no Google password/token is stored.

### Link collection

Replace the four fixed URL inputs with a link management table/card list.

Each link shows:

- title;
- service;
- category;
- audience (`회원 공개` / `운영진 전용`);
- optional description;
- open link;
- edit;
- delete/deactivate;
- simple move up/down ordering.

`+ 링크 추가` opens a compact form using native dark controls.

The UI must not introduce a heavy data-grid or drag-and-drop dependency.

Staff toolbar always shows `운영진 설정` and `자료실`. It no longer performs a network request to discover `operations_drive_url`, and no special hard-coded Drive shortcut is rendered. Staff-only resources are accessed from `운영진 설정`; member-visible resources are accessed from `자료실`.

## Member Resource Hub

Add route:

```text
/member/resources
```

Add `자료실` to ordinary member navigation and staff navigation.

Page behavior:

- fetch current semester `audience='member'`, `active=true` resources through normal authenticated Supabase reads;
- display card/list items ordered by `sort_order`, title;
- show service label/icon treatment, title, description, category, and `열기 ↗`;
- provide lightweight category filtering for `전체 / 스터디 / 프로젝트 / CTF / 기타`;
- do not embed Notion/Google content in iframes;
- use `target="_blank" rel="noopener noreferrer"` for external links;
- explicit empty/loading/error states.

`/member/resources` shows only the member-visible collection for both members and staff. Staff-only resources are never shown on this route and remain under `운영진 설정`.

## External Permission Boundary

ASC_WEB controls whether a link is discoverable through the portal. It does not override the external service.

Examples:

- a Notion page configured as "anyone with the link" remains externally reachable by anyone who obtains that URL;
- a Google Drive folder restricted to specific Google accounts/groups still requires those Google permissions even after an ASC member sees the link;
- staff-only recruitment/operations resources must use external provider permissions appropriate to their sensitivity; ASC_WEB visibility alone is not treated as access control for the destination.

The UI/operator documentation must state this boundary explicitly.

## Existing Notion Study Content

Do not migrate or copy existing Notion study content.

Staff create `resource_links` that point to the existing Notion pages. Suggested defaults:

```text
service = notion
category = study
audience = member
```

This preserves existing Notion assets and avoids API integration or duplicate content maintenance.

## Google Account Handover

The Google account field is informational.

When the operating account changes:

1. add the new Google account/Group to Form, response Sheet, Drive folders, Docs/templates as appropriate;
2. transfer ownership where Google permits it, or copy resources when necessary;
3. remove old staff access after verification;
4. update `google_account_email` in ASC_WEB;
5. update only resource links whose URL changed because the item was copied/recreated.

No ASC_WEB redeploy is required for these runtime edits.

## Public Recruitment Boundary

The public `/apply` route continues using the existing static recruitment configuration (`public/data/apply.json`).

A staff resource named `지원서` is an internal shortcut/handover reference only. Changing it must not silently change the public recruitment CTA.

If a Google Form is copied and its URL changes, staff must separately update the public recruitment configuration for the next static deployment.

## Error / Concurrency Handling

- stale metadata/link updates return 409 with refresh/retry copy;
- malformed URL/title/service/category/audience return 400 with explicit Korean messages;
- members attempting staff mutations return 403;
- members attempting to read staff-only resources receive no rows through RLS;
- a resource belonging to another semester cannot be mutated through the current-semester API;
- deactivated resources disappear from member reads immediately;
- failed external destinations are not actively health-checked by ASC_WEB in V1.

## Testing

### Domain/static contract

Verify:

- migration 009 creates resource model and migrates fixed settings;
- runtime source no longer uses the four fixed Google URL columns;
- toolbar contains `자료실` and no hard-coded Drive discovery fetch;
- settings UI contains Google account + link collection controls;
- resource hub contains category filters and safe external links.

### Local Supabase integration

Verify:

- migration 009 applies after 001–008;
- staff can save Google account metadata;
- ordinary member cannot read metadata or mutate links;
- staff creates a `member` Notion link and ordinary member can read it;
- staff creates a `staff` Google Drive link and ordinary member cannot read it;
- stale link update conflicts;
- deactivated link disappears from member query;
- migrated 008 fixed URL fixtures become resource rows exactly once.

### Browser

Verify fail-closed static routes for:

```text
/member/resources/
/member/operations/settings/
```

and existing member routes at responsive widths.

### Final gates

```text
npm test
npm run typecheck
npm run build
npm run test:browser
npm run test:integration
npm run test:edge
git diff --check
supabase db push --dry-run
```

Before production migration, dry-run must show only migration 009 pending.

## Deployment

After all local gates pass:

1. apply migration 009 to the linked ASC_WEB Supabase project;
2. redeploy `operations-settings` (use the API bundling route if a newly created/updated function route needs gateway registration consistency);
3. run hosted Edge smoke;
4. confirm remote migration history is current;
5. do not deploy GitHub Pages automatically unless separately requested.

## Out of Scope

- Google OAuth or Google API synchronization;
- automatic Google Form response ingestion;
- Apps Script automation in V1;
- Notion API integration or content mirroring;
- Discord API integration;
- GitHub API resource metadata sync;
- a custom Notion/wiki/ATS editor;
- public resource directory;
- per-study/per-team ACL beyond `member` and `staff` audiences;
- link health monitoring.
