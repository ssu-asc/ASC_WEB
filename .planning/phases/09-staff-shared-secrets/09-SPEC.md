# Phase 9 Spec — Staff Shared Secrets

**Status:** Implemented, locally verified, and hosted Supabase backend deployed (2026-09-16)

## Objective

Add a staff-only global handover memo plus encrypted shared credentials for ASC-owned organization accounts while keeping plaintext passwords out of ordinary portal tables, browser persistence, exports, logs, and default page loads.

## Storage

### Staff memo

Create one global `staff_private_settings` singleton row with:

- `staff_memo text`
- optimistic `version`
- updater/timestamp audit fields

Use it for non-secret information only, such as Google account address, Instagram handle, GitHub organization, and handover notes.

### Shared credential metadata

Create `staff_shared_secrets` with:

- UUID ID
- label
- account identifier
- optional HTTPS login URL
- `vault_secret_id`
- active state
- optimistic version
- creator/updater/timestamps

The table never stores plaintext password/secret values.

### Encrypted secret

Enable Supabase Vault and store each password/secret through `vault.create_secret` / `vault.update_secret`.

Browser roles receive no direct access to Vault tables/views/functions.

## Migration 010

Create `202609160010_staff_shared_secrets.sql`.

It must:

1. enable `supabase_vault` in schema `vault`;
2. create the global memo/settings row/table;
3. preserve existing non-null Phase 8 Google account metadata by seeding non-secret memo text;
4. create secret metadata and audit tables;
5. create service-role-only atomic SQL functions for create/update/reveal/activate/deactivate;
6. deny anon/authenticated direct secret and Vault access;
7. leave Phase 8 resource links unchanged.

## Staff secret Edge Function

Add `staff-secrets` with actions:

- `list`
- `create`
- `update`
- `reveal`
- `deactivate`
- `reactivate`
- `list_audit`

All actions require active staff.

`list` returns metadata only.

`reveal` is the only plaintext-returning action and must return `Cache-Control: no-store`.

Create/update must never log request bodies or secret contents.

## Audit

Create `staff_shared_secret_audit` with actor, secret ID, action, and timestamp only.

Audit actions:

- created
- updated
- revealed
- deactivated
- reactivated

No secret value is recorded.

## UI

Extend `/member/operations/settings` with:

1. `운영진 메모`
2. existing `링크 모음`
3. `공용 계정 / 비밀정보`

Credential rows display masked values by default and provide:

- 보기
- 복사
- 수정
- 비활성화 / 재활성화

The browser does not fetch decrypted values during list loading.

Explicit reveal stores plaintext only in short-lived React state, auto-clears within 30 seconds, and clears on hide/unmount/edit/deactivate/sign-out.

Copy uses the same audited reveal path. No credential export is added.

The staff UI shows the most recent 50 audit events (actor/action/time) and V1 does not permanently delete Vault values from the UI.

## Security rules

Never persist secret plaintext in:

- ordinary Postgres portal tables
- localStorage
- sessionStorage
- IndexedDB
- query/hash URLs
- CSV/XLSX
- console logs
- analytics

Direct browser access to `staff_shared_secrets`, audit data, Vault, and service-role-only RPCs is denied. RLS is enabled on secret metadata/audit tables as defense-in-depth, and browser roles are explicitly revoked from the Vault objects used by the portal.

An attacker who already owns an active staff session can still explicitly reveal shared secrets; Vault encryption at rest does not prevent that. Step-up authentication/MFA is a later hardening option.

## Verification

Required checks:

- migration 010 applies after 001–009 and survives local reset cycles;
- ordinary member cannot read memo or use `staff-secrets`;
- staff memo save uses optimistic conflict handling;
- create/list does not expose plaintext;
- reveal returns the exact test secret only to staff and writes audit;
- update secret changes reveal result and stale version conflicts;
- deactivate blocks reveal; reactivate restores it;
- static source contains no plaintext password column/export/browser persistence path;
- build/browser fail-closed checks remain green;
- hosted `staff-secrets` preflight and invalid-JWT reachability pass without creating a real secret;
- remote dry-run shows only migration 010 before production apply.

## Out of scope

- personal staff passwords
- MFA/TOTP seeds
- downloadable password exports
- password-manager synchronization
- automatic provider password rotation
- step-up MFA/re-auth before reveal in V1
- member/public credential access
