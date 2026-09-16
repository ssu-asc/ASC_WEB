# ASC Staff Shared Secrets Design

**Date:** 2026-09-16
**Status:** Implemented and locally/hosted verified (2026-09-16)

## Goal

Add a staff-only handover memo and a small encrypted shared-credential vault for organization accounts such as ASC Google, Instagram, and GitHub without ever storing shared passwords as plaintext portal rows or loading them into the browser until an active staff member explicitly reveals or copies one.

Phase 9 is intentionally separate from the Phase 8 resource hub because the moment ASC_WEB stores passwords it becomes a secret-management boundary rather than a normal link-management feature.

## Security primitive

Use **Supabase Vault** for password/secret storage instead of implementing custom application-layer AES key management.

Supabase Vault stores secrets encrypted and authenticated at rest and exposes decrypted values only on demand. Phase 9 must not grant browser roles access to `vault.secrets`, `vault.decrypted_secrets`, or Vault helper functions.

The portal will access Vault only through service-role-only SQL functions invoked by a staff-authenticated Edge Function.

Do not use the deprecated pgsodium transparent-column-encryption pattern.

## Scope

Phase 9 adds two related but separate capabilities:

1. **운영진 메모** — non-secret staff handover text for account names, social handles, operational notes, ownership notes, etc.
2. **공용 계정 / 비밀정보** — encrypted shared passwords/secrets for organization-owned accounts.

The existing Phase 8 resource-link hub remains unchanged.

## Global vs semester scope

Shared ASC accounts such as Google, Instagram, and GitHub normally survive semester boundaries. Therefore Phase 9 data is **organization-global**, not semester-scoped.

Phase 8 `resource_links` remain semester-scoped because study/recruitment/resources change by semester.

## Migration 010

Add forward-only migration:

```text
202609160010_staff_shared_secrets.sql
```

It must:

1. enable Supabase Vault with `create extension if not exists supabase_vault with schema vault`;
2. create one global staff memo/settings row;
3. migrate any existing non-null Phase 8 `google_account_email` metadata into the staff memo so handover data is not lost;
4. create shared-secret metadata and audit tables;
5. create service-role-only SQL functions that are the only portal path to Vault create/update/reveal operations;
6. grant no direct authenticated/anon access to Vault or shared-secret tables;
7. leave Phase 8 resource-link data untouched.

The old `staff_workspace_settings.google_account_email` column may remain for compatibility but must become runtime-deprecated after migration 010.

## Staff memo

Create a singleton table such as:

```text
staff_private_settings
- id boolean primary key default true check (id)
- staff_memo text not null default ''
- version bigint not null default 1
- updated_by uuid null references profiles(id)
- updated_at timestamptz not null default now()
```

Rules:

- active staff may read it;
- browser clients do not directly update it;
- updates go through `operations-settings` or another existing privileged staff function with optimistic `expected_version`;
- maximum memo length: 20,000 characters;
- UI explicitly warns: **비밀번호/토큰은 메모에 적지 말고 아래 공용 계정에 저장**.

Migration of old Google account metadata:

- if one or more semester rows contain `google_account_email`, seed the memo with non-secret handover lines that preserve semester + account address;
- do not overwrite an existing non-empty staff memo.

## Shared credential metadata

Create `staff_shared_secrets` with metadata only:

```text
id uuid primary key
label text not null
account_identifier text not null default ''
login_url text null
vault_secret_id uuid not null unique
active boolean not null default true
version bigint not null default 1
created_by uuid null references profiles(id)
updated_by uuid null references profiles(id)
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

Examples:

```text
label: ASC Google
account_identifier: asc.operations@gmail.com
login_url: https://accounts.google.com/

label: ASC Instagram
account_identifier: @ssu_asc
login_url: https://www.instagram.com/

label: ASC GitHub
account_identifier: ssu-asc
login_url: https://github.com/login
```

The plaintext password/secret is **never** stored in this table.

Validation:

- label: 1–100 chars;
- account identifier: 0–320 chars;
- login URL: null or absolute HTTPS URL;
- secret value: 1–2048 chars;
- no secret content is written to an audit row, error message, title, description, or log statement.

## Vault mapping

Each metadata row points to one Vault secret by `vault_secret_id`.

Vault secret names should be generated server-side from the credential UUID, for example:

```text
asc-staff-secret-<credential-uuid>
```

Do not use account names or usernames as Vault secret names because they may change and may disclose metadata unnecessarily.

## Service-role-only database functions

Create SQL functions callable only by `service_role`. Revoke them from `public`, `anon`, and `authenticated`.

Recommended interface:

```text
create_staff_shared_secret_atomic(..., p_secret text) -> metadata row
update_staff_shared_secret_atomic(..., p_expected_version bigint, p_secret text null) -> metadata row
reveal_staff_shared_secret(p_secret_id uuid, p_actor uuid) -> plaintext secret
set_staff_shared_secret_active(..., p_expected_version bigint, p_active boolean) -> metadata row
```

Implementation rules:

- create generates the credential UUID, calls `vault.create_secret`, then inserts metadata in the same transaction;
- update validates the metadata row and `expected_version` **before** calling `vault.update_secret`; it calls `vault.update_secret` only when a new plaintext secret is supplied;
- reveal joins the metadata row to `vault.decrypted_secrets`, inserts an audit event in the same transaction, and returns the plaintext only when the metadata row is active;
- stale versions fail before any Vault mutation, so neither metadata nor encrypted secret value changes;
- cross-row ID substitution must not reveal another secret through an update function;
- functions use explicit `search_path=''` / schema-qualified names following the rest of the portal security style.

The browser never receives execute permission on these functions. Only the Edge Function's service client calls them.

## Audit log

Create `staff_shared_secret_audit`:

```text
id bigint generated always as identity primary key
secret_id uuid not null references staff_shared_secrets(id)
actor_profile_id uuid null references profiles(id)
action text not null
created_at timestamptz not null default now()
```

Allowed actions:

```text
created
updated
revealed
deactivated
reactivated
```

Audit rows contain no password/secret value.

The staff UI shows the most recent 50 events with actor name, action, and time under `최근 비밀정보 접근 기록`.

A copy operation counts as a reveal/access event; no separate clipboard audit event is required in V1.

## Edge Function

Add a dedicated function:

```text
staff-secrets
```

This is separate from `operations-settings` so the secret-management boundary is easy to audit and test.

Every action starts with `requireStaff(req)`.

Supported actions:

```text
list
create
update
reveal
deactivate
reactivate
list_audit
```

### list

Returns metadata only. Never decrypts or returns secret values.

### create

Accepts metadata + plaintext secret over HTTPS, immediately passes it to the service-role-only database function, and never logs the request body.

### update

Requires `expected_version`. Metadata can change without changing the secret. Supplying a new secret replaces the Vault value atomically.

### reveal

Requires a single active credential ID. Calls the database reveal function, which writes the audit row before returning the plaintext.

Response headers must include:

```text
Cache-Control: no-store
```

The plaintext is returned only in this explicit response.

### deactivate/reactivate

Soft-toggle metadata with optimistic version checks. Inactive secrets cannot be revealed.

### list_audit

Returns recent audit metadata only; no secret values.

## UI

Extend `/member/operations/settings` with three sections:

```text
운영진 메모
링크 모음
공용 계정 / 비밀정보
```

### 운영진 메모

A multiline textarea for non-secret handover information such as:

```text
Google: asc.operations@gmail.com
Instagram: @ssu_asc
GitHub: ssu-asc
기타 인수인계 메모
```

Show an explicit warning not to place passwords/tokens in this memo.

### 공용 계정 / 비밀정보

Each active credential card/row shows:

```text
label
account identifier
optional login link
password: ••••••••••••
[보기] [복사] [수정] [비활성화]
```

Create/edit form uses `type="password"` and browser autocomplete settings appropriate for a new password/secret entry.

Do not preload decrypted values while listing credentials.

### Reveal behavior

`보기`:

1. call `staff-secrets` `reveal`;
2. store returned plaintext only in component React state;
3. display it for at most 30 seconds;
4. automatically clear it;
5. clear it immediately on manual hide, route unmount, sign-out, or credential edit/deactivate.

Masked display before reveal must not contain plaintext in the DOM.

V1 does not permanently delete Vault values from the UI. `비활성화` blocks reveal and removes a credential from normal active use while preserving encrypted history/auditability; staff can `재활성화` it later.

### Copy behavior

`복사` may call the same reveal path if the secret is not currently loaded, write the value to `navigator.clipboard`, then clear the in-page plaintext state promptly.

The system cannot erase OS clipboard history; UI should make that limitation clear.

## Browser storage and export rules

Secret plaintext must never be written to:

- localStorage;
- sessionStorage;
- IndexedDB;
- URL/query/hash;
- normal CSV/XLSX exports;
- console logs;
- analytics payloads;
- React state outside the short-lived reveal/create/edit interaction.

Do not add a credential CSV export.

## RLS and privileges

`staff_private_settings`:

- authenticated active staff may select;
- anon/ordinary members get no rows;
- no browser insert/update/delete grants.

`staff_shared_secrets` and `staff_shared_secret_audit`:

- enable RLS as defense-in-depth;
- no direct browser grants, even for staff;
- all reads/actions flow through `staff-secrets`.

`vault.*`:

- explicitly revoke browser-role access to the Vault schema/tables/views/functions used by the portal;
- never grant portal browser roles access to `vault.secrets`, `vault.decrypted_secrets`, `vault.create_secret`, or `vault.update_secret`;
- only service-role-only security-definer database functions bridge the portal to Vault.

## Threat model and limitation

Vault encryption protects secrets at rest and in backups, and the portal avoids loading plaintext until explicit reveal. It does **not** protect a shared password from an attacker who has already taken over an active staff session with permission to reveal it.

V1 therefore provides:

- staff authorization;
- explicit reveal only;
- no preload;
- short-lived client plaintext;
- no-store responses;
- audit trail;
- optimistic writes.

Step-up authentication/MFA before reveal is a possible later hardening phase, not part of Phase 9 unless ASC enables an MFA policy first.

## Existing resource hub

Phase 8 remains unchanged:

- `/member/resources` stays member-visible-link-only;
- `resource_links` remain semester-scoped;
- staff-only resource links remain managed in `운영진 설정`;
- external provider permissions remain authoritative.

## Production deployment

After local verification:

1. dry-run remote DB and verify only migration 010 is pending;
2. apply migration 010;
3. deploy `staff-secrets`;
4. deploy `operations-settings` only if its memo action changed;
5. verify both functions are ACTIVE;
6. run hosted CORS/reachability smoke for `staff-secrets` without sending a real secret;
7. never put test passwords or production shared credentials in source control or test logs.

## Required tests

Static/unit contracts:

- migration enables Supabase Vault and denies browser secret access;
- no portal source uses a plaintext DB password column;
- staff memo and credential UI exist;
- no `localStorage`/`sessionStorage`/credential export path;
- reveal response uses no-store behavior.

Local Supabase integration:

- ordinary member cannot read staff memo;
- ordinary member receives 403 from every `staff-secrets` action;
- staff can save memo with optimistic conflict protection;
- staff creates a credential and list response contains metadata only;
- direct DB rows contain Vault UUID but no plaintext;
- reveal returns the original secret only to staff;
- audit row is created for reveal;
- update with a new secret changes reveal result and stale update returns 409;
- deactivate blocks reveal;
- reactivate restores reveal;
- Vault-backed migration survives the normal local reset cycle.

Browser/build:

- staff settings route stays fail-closed;
- secret is masked until explicit interaction;
- no plaintext fixture is shipped in static output;
- existing member/resource/project routes remain intact.

Hosted smoke:

- `staff-secrets` route exists and returns an HTTP 401 for invalid JWT rather than CORS/fetch failure;
- supported ASC origins pass OPTIONS preflight;
- hosted smoke never creates or reveals a real secret.

## Out of scope

- personal staff passwords;
- MFA/TOTP seed management;
- automatic browser autofill integration;
- downloadable password exports;
- external password-manager browser extensions;
- public/member credential access;
- automatic password rotation on Google/Instagram/GitHub;
- syncing passwords from another password manager;
- step-up MFA/re-authentication before each reveal in V1.
