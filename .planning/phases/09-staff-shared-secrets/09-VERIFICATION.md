# Phase 9 Verification — Staff Shared Secrets

## Local migration / integration

Command:

```bash
rtk npm run test:integration
```

Result: PASS. Disposable local Supabase applies migrations `001–010` through both reset cycles and verifies real Vault-backed secret operations.

Covered behaviors:
- ordinary member cannot read `staff_private_settings`;
- staff memo save succeeds and stale memo save conflicts;
- browser roles cannot directly select secret metadata/audit rows;
- staff browser role cannot directly call service-role-only reveal RPC;
- ordinary member receives 403 for `staff-secrets` actions;
- staff can create a Vault-backed credential;
- list/create/update/audit responses do not contain plaintext;
- Edge metadata response does not expose `vault_secret_id`;
- explicit reveal returns the local-only test plaintext with `Cache-Control: no-store, private`;
- stale replacement update returns 409 and does not mutate Vault;
- valid replacement updates Vault;
- deactivated secret cannot reveal;
- reactivation restores reveal;
- audit includes reveal/deactivation metadata and no plaintext.

Only disposable local fixtures are used; no production shared password is placed in tests or logs.

## Static/unit contracts

Current test suite contains Phase-9 contracts for:
- Supabase Vault extension usage;
- service-role-only Vault RPC grants;
- absence of plaintext password/secret columns;
- `staff-secrets` staff authorization and no-store reveal boundary;
- staff memo API;
- settings UI masking, password input, 30-second cleanup and no browser persistence/export path;
- removal of runtime `google_account_email` / `save_metadata` flow.

Latest pre-final local gate observed **70 passing tests, 0 failures**.

## Type/build/browser

Latest pre-final local gate:
- `npm run typecheck` — PASS
- `npm run build` — PASS, Next 15.5.25 static export, 20 pages
- `npm run test:browser` — PASS, 14/14 responsive/fail-closed checks
- `git diff --check` — PASS

The existing non-fatal Next workspace-root warning from multiple lockfiles remains unrelated to Phase 9.

## Production DB

Before apply:

```text
Would push these migrations:
 • 202609160010_staff_shared_secrets.sql
```

Migration 010 was then applied successfully.

After deploy:

```text
Remote database is up to date.
```

## Hosted Edge Functions

Hosted function list after Phase 9:
- `operations-settings` — ACTIVE v4
- `staff-secrets` — ACTIVE v1

`npm run test:edge` passes preflight from localhost/127.0.0.1/0.0.0/ASC dev port/GitHub Pages origin and verifies invalid-JWT POST receives HTTP 401 for:
- `team-admin`
- `operations-settings`
- `staff-secrets`

Hosted smoke never sends a real secret.

## Security boundary

Phase 9 protects secrets at rest with Supabase Vault and avoids plaintext preload/persistence. It does not protect against an attacker who already controls an authorized active staff session and explicitly invokes reveal. Step-up MFA/re-authentication remains a future hardening option.

## Final gate

Completion requires one fresh all-command gate after all GSD/docs edits:

```bash
rtk npm test && rtk npm run typecheck && rtk npm run build && rtk npm run test:browser && rtk npm run test:integration && rtk npm run test:edge && rtk git diff --check
```

The completion report must use the actual output of that final run rather than earlier partial evidence.
