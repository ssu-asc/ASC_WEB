# Phase 9 Context — Staff Shared Secrets

## Why this phase exists

Phase 8 introduced generic staff/member resource links and a Google handover metadata concept. The operator now needs two different staff-only information classes:

1. non-secret handover memo such as Google account address, Instagram handle, GitHub organization, ownership notes;
2. actual shared passwords/secrets for ASC-owned organization accounts.

Masking plaintext only in the UI is insufficient. Shared passwords require encrypted-at-rest storage, explicit reveal, short-lived browser plaintext, and auditability.

## Confirmed decisions

- Create a global `운영진 메모` for non-secret handover notes.
- Shared credentials are organization-global, not semester-scoped.
- Use Supabase Vault for encrypted password/secret storage.
- Do not implement a custom AES master-key scheme when Vault is available.
- Browser roles never receive direct Vault or shared-secret-table access.
- A dedicated `staff-secrets` Edge Function is the only browser-facing credential API.
- Secret values are not returned by list operations and are fetched only on explicit reveal/copy.
- Revealed plaintext lives only briefly in React state and is auto-cleared.
- Secret access/update actions are audited without recording the secret value.
- Existing Phase 8 resource hub and member 자료실 remain unchanged.
- Step-up MFA/re-auth before reveal is deferred; V1 relies on active-staff authorization + audit + explicit reveal.

## Delivery boundary

Phase 9 may add production migration 010 and deploy `staff-secrets` after local verification. Public GitHub Pages deployment, entering real organization passwords, ProjectDB production write-token verification, and git integration remain separate release/operator actions.

No real shared credential is ever used as a test fixture or written to source control.

## Primary design

See `docs/superpowers/specs/2026-09-16-staff-shared-secrets-design.md`.
