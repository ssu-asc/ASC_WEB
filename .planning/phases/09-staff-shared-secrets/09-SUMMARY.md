# Phase 9 Summary — Staff Shared Secrets

## Result

Phase 9 separates non-secret staff handover notes from shared organization credentials and stores shared passwords/tokens with Supabase Vault rather than ordinary database columns.

## Delivered

### 운영진 메모
- one organization-global staff memo
- intended for Google account address, Instagram, GitHub, ownership notes and other non-secret handover information
- explicit warning not to put passwords/tokens in the memo
- optimistic save through `operations-settings`
- ordinary members cannot read it
- historical Phase-8 `google_account_email` values are preserved into the initial memo by migration 010

### Vault-backed shared credentials
- `staff_shared_secrets` stores metadata and Vault UUID only
- secret value is created/updated through Supabase Vault
- no plaintext password/secret column exists
- service-role-only atomic SQL functions bridge the portal to Vault
- browser roles cannot call those functions directly
- dedicated `staff-secrets` Edge Function re-checks active staff

### Secret UX
- list view is masked and does not decrypt values
- explicit `보기` reveals one secret and records an audit event
- explicit `복사` uses the same audited reveal path
- reveal response uses `Cache-Control: no-store, private`
- revealed value exists only in React state and auto-clears after 30 seconds
- hide/edit/deactivate/unmount/copy clears the in-page plaintext
- V1 uses deactivate/reactivate instead of hard delete
- recent 50 access/change events are displayed without secret contents

### Security behavior verified locally
- ordinary member gets 403 for `staff-secrets`
- staff browser session cannot directly query secret metadata/audit tables
- staff browser session cannot directly execute the reveal RPC
- create/list/update/audit responses contain no plaintext
- create/update/state-change Edge responses contain no `vault_secret_id`
- stale update with a replacement secret returns conflict before Vault mutation
- inactive secret cannot reveal; reactivation restores reveal
- audit contains reveal/deactivate events without plaintext

### Hosted Supabase
- migration `202609160010_staff_shared_secrets.sql` applied
- `staff-secrets` ACTIVE v1
- `operations-settings` ACTIVE v4
- hosted preflight/invalid-JWT smoke passes for `staff-secrets`
- remote migration dry-run reports database up to date

## Deliberate limits
- no credential CSV/XLSX export
- no localStorage/sessionStorage/IndexedDB secret persistence
- no custom AES master key or deprecated pgsodium transparent encryption
- no permanent secret delete UI in V1
- no step-up MFA/re-authentication before reveal in V1
- Vault encryption does not prevent explicit reveal by an attacker who has already taken over an authorized active staff session
