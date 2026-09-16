# Staff Shared Secrets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a staff-only handover memo and Vault-backed shared-credential store with explicit reveal/copy, short-lived plaintext, audit logging, and no browser-direct Vault access.

**Architecture:** Keep Phase 8 resource links unchanged. Add forward migration `202609160010_staff_shared_secrets.sql` that enables Supabase Vault, creates one global staff memo row, secret metadata/audit tables, and service-role-only SQL functions for create/update/reveal/activate state. Add a dedicated `staff-secrets` Edge Function as the only application boundary that can call those SQL functions. Extend `/member/operations/settings` with `운영진 메모`, existing `링크 모음`, and `공용 계정 / 비밀정보`; plaintext is fetched only by explicit reveal/copy and kept in React state for at most 30 seconds.

**Tech Stack:** Next.js 15.5.x, React 19, TypeScript 5, Supabase Auth/Postgres/RLS/Edge Functions, Supabase Vault (`supabase_vault` extension), Node test runner, local Supabase CLI integration tests.

**Spec:** `docs/superpowers/specs/2026-09-16-staff-shared-secrets-design.md`

## Global Constraints

- Shared credential data is organization-global, not semester-scoped.
- `resource_links` and `/member/resources` from Phase 8 remain unchanged.
- Supabase Vault is the encrypted-at-rest secret store; do not implement custom AES key management or pgsodium transparent-column encryption.
- Browser roles receive no direct access to Vault, secret metadata, audit data, or service-role-only secret RPCs.
- Secret plaintext is never stored in ordinary portal tables, localStorage, sessionStorage, IndexedDB, URL state, CSV/XLSX, logs, or analytics.
- `reveal` is the only action that returns plaintext. Its response uses `Cache-Control: no-store`.
- Reveal/copy plaintext is held in component state only, auto-cleared within 30 seconds, and cleared on hide/edit/deactivate/unmount.
- V1 uses deactivate/reactivate, not permanent secret deletion.
- Existing Phase 8 `google_account_email` metadata is migrated to non-secret staff memo text and becomes runtime-deprecated.
- Ordinary members must not read staff memo, shared-secret metadata, audit events, or plaintext.
- Keep existing public ASC routes and ProjectDB/team/schedule semantics unchanged.

---

### Task 1: Add Vault-backed schema and service-only secret RPCs

**Files:**
- Create: `supabase/migrations/202609160010_staff_shared_secrets.sql`
- Modify: `tests/member-contract.test.mjs`
- Modify: `tests/live-supabase.mjs`

**Interfaces:**
- Produces table `public.staff_private_settings(id boolean primary key, staff_memo text, version bigint, updated_by uuid, updated_at timestamptz)`.
- Produces table `public.staff_shared_secrets(id uuid, label text, account_identifier text, login_url text, vault_secret_id uuid, active boolean, version bigint, created_by uuid, updated_by uuid, created_at timestamptz, updated_at timestamptz)`.
- Produces table `public.staff_shared_secret_audit(id bigint identity, secret_id uuid, actor_profile_id uuid, action text, created_at timestamptz)`.
- Produces service-role-only SQL functions:
  - `public.create_staff_shared_secret_atomic(p_label text, p_account_identifier text, p_login_url text, p_secret text, p_actor uuid)`
  - `public.update_staff_shared_secret_atomic(p_secret_id uuid, p_expected_version bigint, p_label text, p_account_identifier text, p_login_url text, p_secret text, p_actor uuid)`
  - `public.reveal_staff_shared_secret(p_secret_id uuid, p_actor uuid)`
  - `public.set_staff_shared_secret_active(p_secret_id uuid, p_expected_version bigint, p_active boolean, p_actor uuid)`
  - `public.update_staff_private_settings_atomic(p_expected_version bigint, p_staff_memo text, p_actor uuid)`
- Functions revoke execute from `public`, `anon`, `authenticated`; grant execute to `service_role` only.

- [ ] **Step 1: Write failing static contract tests**

Add a contract test that requires:

```js
const migration = read('supabase/migrations/202609160010_staff_shared_secrets.sql');
assert.match(migration, /create extension if not exists supabase_vault with schema vault/i);
assert.match(migration, /create table if not exists public\.staff_private_settings/i);
assert.match(migration, /create table if not exists public\.staff_shared_secrets/i);
assert.match(migration, /create table if not exists public\.staff_shared_secret_audit/i);
assert.match(migration, /vault\.create_secret/i);
assert.match(migration, /vault\.update_secret/i);
assert.match(migration, /vault\.decrypted_secrets/i);
assert.match(migration, /create_staff_shared_secret_atomic/i);
assert.match(migration, /update_staff_shared_secret_atomic/i);
assert.match(migration, /reveal_staff_shared_secret/i);
assert.match(migration, /set_staff_shared_secret_active/i);
assert.match(migration, /update_staff_private_settings_atomic/i);
assert.match(migration, /grant execute[^;]*to service_role/i);
assert.doesNotMatch(migration, /grant execute[^;]*to authenticated/i);
assert.doesNotMatch(migration, /password\s+text|secret_value\s+text/i);
```

- [ ] **Step 2: Run the targeted test and verify RED**

Run:

```bash
rtk npm test -- --test-name-pattern="staff shared secrets migration"
```

Expected: FAIL because migration 010 does not exist.

- [ ] **Step 3: Implement migration 010**

Use:

```sql
create extension if not exists supabase_vault with schema vault;
```

Create the three portal tables above. `staff_shared_secrets` stores only `vault_secret_id`, never plaintext.

For memo migration, insert the singleton row if absent. If old `staff_workspace_settings.google_account_email` values exist, seed memo lines such as:

```text
Google (2026-2): asc.operations@example.com
```

only when the singleton memo is empty.

Secret create flow must:

```sql
new_id := gen_random_uuid();
vault_id := vault.create_secret(
  p_secret,
  'asc-staff-secret-' || new_id::text,
  'ASC staff shared credential'
);
```

then insert metadata + `created` audit row in the same function transaction.

Secret update flow must first lock/read the metadata row and compare `p_expected_version`; only after the version matches may it call `vault.update_secret(...)` when `p_secret is not null`.

Reveal flow selects `decrypted_secret` from `vault.decrypted_secrets` using the stored Vault UUID, writes a `revealed` audit row, and returns the plaintext only for active metadata rows.

Activation flow updates only after version match, increments version, and writes `deactivated` or `reactivated` audit action.

Memo update uses one singleton row with optimistic version.

Enable RLS on portal tables. Grant active staff select access only to `staff_private_settings`; revoke direct browser access entirely for `staff_shared_secrets` and `staff_shared_secret_audit`.

Explicitly revoke browser-role access to Vault objects used by the portal where permitted and, critically, never grant them access.

- [ ] **Step 4: Add live local integration coverage for the SQL boundary**

After local reset and staff/member setup:

```js
const memberMemo = await clients.a.from('staff_private_settings').select('staff_memo');
assert.equal(memberMemo.data.length, 0);

const staffMemo = await clients.staff.from('staff_private_settings').select('staff_memo,version').single();
assert.equal(staffMemo.error, null);

const memberSecrets = await clients.a.from('staff_shared_secrets').select('id');
assert.notEqual(memberSecrets.error, null);

const staffDirectSecrets = await clients.staff.from('staff_shared_secrets').select('id');
assert.notEqual(staffDirectSecrets.error, null);
```

Do not put any production credential in tests. Use a disposable local-only value such as `LocalSharedSecret!123`.

- [ ] **Step 5: Run local Supabase integration and verify migration resets cleanly**

Run:

```bash
rtk npm run test:integration
```

Expected: migrations 001–010 apply during both reset cycles and existing integration remains green.

---

### Task 2: Add `staff-secrets` Edge Function and client API

**Files:**
- Create: `supabase/functions/staff-secrets/index.ts`
- Modify: `supabase/config.toml`
- Modify: `src/lib/member-api.ts`
- Modify: `tests/member-contract.test.mjs`
- Modify: `tests/live-supabase.mjs`

**Interfaces:**
- Edge actions: `list`, `create`, `update`, `reveal`, `deactivate`, `reactivate`, `list_audit`.
- `list` returns metadata only.
- `reveal` returns `{ ok: true, secret_id, secret }` and sets `Cache-Control: no-store`.
- Client API exports:
  - `readStaffPrivateSettings`
  - `saveStaffPrivateSettings`
  - `listStaffSharedSecrets`
  - `createStaffSharedSecret`
  - `updateStaffSharedSecret`
  - `revealStaffSharedSecret`
  - `setStaffSharedSecretActive`
  - `listStaffSharedSecretAudit`

- [ ] **Step 1: Write failing contracts for the function and client API**

Require:

```js
const fn = read('supabase/functions/staff-secrets/index.ts');
assert.match(fn, /requireStaff\(req\)/);
for (const action of ['list','create','update','reveal','deactivate','reactivate','list_audit']) {
  assert.match(fn, new RegExp(action));
}
assert.match(fn, /Cache-Control[^\n]*no-store/i);
assert.doesNotMatch(fn, /console\.log\([^)]*(secret|password)/i);
assert.match(read('supabase/config.toml'), /\[functions\.staff-secrets\]/);
```

Client source must expose all APIs named above.

- [ ] **Step 2: Run targeted contracts and verify RED**

Run:

```bash
rtk npm test -- --test-name-pattern="staff secret edge boundary"
```

Expected: FAIL because the function/API do not exist.

- [ ] **Step 3: Implement `staff-secrets`**

Every request begins with:

```ts
const { client, profile } = await requireStaff(req);
```

Do not log request bodies.

Validation:

```text
label: trimmed 1..100
account_identifier: trimmed <= 320
login_url: blank/null or https absolute URL
secret: 1..2048 for create; blank means unchanged on update
expected_version: integer >= 1 where required
```

`list` queries metadata through the service client and never joins Vault.

`create/update/reveal/deactivate/reactivate` call the migration RPCs.

`list_audit` returns at most 50 newest audit rows joined to actor `profiles.name/member_id`; no plaintext secret or Vault metadata is returned.

For `reveal`, return a custom `Response` or `json()` equivalent with:

```text
Cache-Control: no-store, private
```

- [ ] **Step 4: Add client types and helpers**

Add:

```ts
export interface StaffPrivateSettings { staff_memo: string; version: number; updated_at: string; }
export interface StaffSharedSecret { id: string; label: string; account_identifier: string; login_url: string | null; active: boolean; version: number; updated_at: string; }
export interface StaffSharedSecretAudit { id: number; secret_id: string; actor_name: string | null; actor_member_id: string | null; action: string; created_at: string; }
```

No type includes plaintext except the direct return type of `revealStaffSharedSecret`.

- [ ] **Step 5: Extend local integration**

Test:

```text
ordinary member -> every staff-secrets action returns 403
staff -> save memo succeeds
stale memo expected_version -> 409
staff -> create credential succeeds
list -> metadata only and JSON does not contain test plaintext
staff -> reveal returns disposable test plaintext
DB metadata row -> contains vault UUID but not plaintext
reveal -> audit action exists
update with wrong expected_version + replacement secret -> 409 and old secret still reveals
valid update -> new secret reveals
member -> cannot reveal
inactive -> reveal fails
reactivate -> reveal works again
list_audit -> metadata only
```

- [ ] **Step 6: Run integration and typecheck**

Run:

```bash
rtk npm run test:integration
rtk npm run typecheck
```

Expected: PASS.

---

### Task 3: Replace Google-account metadata with staff memo and add shared-secret UI

**Files:**
- Modify: `src/app/member/operations/settings/page.tsx`
- Modify: `src/lib/member-api.ts`
- Modify: `src/styles/member.module.css` only if current classes cannot express the layout cleanly
- Modify: `tests/member-contract.test.mjs`

**Interfaces:**
- Settings page sections are exactly conceptually separated as `운영진 메모`, `링크 모음`, `공용 계정 / 비밀정보`, plus `최근 비밀정보 접근 기록`.
- Secret plaintext exists only in short-lived component state keyed by secret ID.

- [ ] **Step 1: Write failing UI contracts**

Require:

```js
const page = read('src/app/member/operations/settings/page.tsx');
for (const label of ['운영진 메모', '링크 모음', '공용 계정 / 비밀정보', '최근 비밀정보 접근 기록']) {
  assert.match(page, new RegExp(label));
}
assert.match(page, /type=["']password["']/);
assert.match(page, /비밀번호\/토큰은 메모에 적지/);
assert.match(page, /보기/);
assert.match(page, /복사/);
assert.match(page, /비활성화/);
assert.match(page, /재활성화/);
assert.match(page, /30_000|30000/);
assert.match(page, /navigator\.clipboard/);
assert.doesNotMatch(page, /localStorage|sessionStorage|IndexedDB/);
assert.doesNotMatch(page, /credential.*CSV|비밀번호.*CSV/i);
```

- [ ] **Step 2: Run targeted test and verify RED**

Run:

```bash
rtk npm test -- --test-name-pattern="staff shared-secret UI"
```

Expected: FAIL because the section is not implemented.

- [ ] **Step 3: Implement memo UI**

Use `readStaffPrivateSettings` + `saveStaffPrivateSettings`.

Textarea copy:

```text
Google: asc.operations@gmail.com
Instagram: @ssu_asc
GitHub: ssu-asc
기타 인수인계 메모
```

Show warning:

```text
비밀번호/토큰은 메모에 적지 말고 아래 공용 계정 / 비밀정보에 저장하세요.
```

Use explicit save and optimistic version.

- [ ] **Step 4: Implement credential list/create/edit/deactivate/reactivate**

Default card never contains plaintext, only masked text `••••••••••••`.

Create form fields:

```text
이름(label)
계정/아이디(account_identifier)
로그인 주소(login_url, optional)
비밀번호/비밀값(type=password)
```

Update allows blank secret input to keep the existing Vault value.

Deactivate is the V1 delete-equivalent. Inactive rows remain available to staff with `재활성화` but cannot reveal.

- [ ] **Step 5: Implement reveal/copy lifecycle**

State shape:

```ts
const [revealed, setRevealed] = useState<Record<string, string>>({});
```

When revealed, schedule a 30-second cleanup timer per ID. Cleanup on hide/edit/deactivate and component unmount.

`보기` calls reveal only when plaintext is not already loaded.

`복사` calls reveal if needed, writes to `navigator.clipboard.writeText(secret)`, then clears that secret from page state immediately after copy.

Explain that OS clipboard history cannot be remotely erased.

- [ ] **Step 6: Implement audit list**

Load recent 50 entries and show actor, action label, time. Do not display Vault UUID or plaintext.

- [ ] **Step 7: Run targeted tests, typecheck and build**

Run:

```bash
rtk npm test -- --test-name-pattern="staff shared-secret UI"
rtk npm run typecheck
rtk npm run build
```

Expected: PASS.

---

### Task 4: Update GSD/operator docs and browser/hosted smoke coverage

**Files:**
- Modify: `.planning/PROJECT.md`
- Modify: `.planning/REQUIREMENTS.md`
- Modify: `.planning/ROADMAP.md`
- Modify: `.planning/STATE.md`
- Modify: `.planning/phases/09-staff-shared-secrets/09-CONTEXT.md`
- Modify: `.planning/phases/09-staff-shared-secrets/09-SPEC.md`
- Create: `.planning/phases/09-staff-shared-secrets/09-PROGRESS.md`
- Create: `.planning/phases/09-staff-shared-secrets/09-SUMMARY.md`
- Create: `.planning/phases/09-staff-shared-secrets/09-VERIFICATION.md`
- Modify: `docs/member-portal-setup.md`
- Modify: `tests/live-edge-smoke.mjs`

**Interfaces:**
- Phase 9 becomes authoritative for staff memo/shared credentials.
- Phase 8 remains authoritative for resource links.
- Hosted smoke adds `staff-secrets` preflight and invalid-JWT reachability only; it never sends a real secret.

- [ ] **Step 1: Update project requirements**

Document:

```text
운영진 메모 = non-secret handover information
공용 계정 / 비밀정보 = Vault-backed secret storage
staff-secrets = dedicated privileged function
reveal/copy = explicit, audited, no-store, short-lived
no permanent delete in V1
```

Remove any authoritative requirement that says passwords/Google credentials can never be stored at all; replace it with the more precise rule that secrets are stored only through Vault and never in ordinary portal tables.

- [ ] **Step 2: Update operator guide**

Add migration 010 and `staff-secrets` deployment command. Explain Vault at-rest protection and the active-staff-session limitation. Tell operators not to enter real shared passwords in test fixtures or screenshots.

- [ ] **Step 3: Extend hosted smoke**

Add `staff-secrets` to the existing endpoint list. Verify:

```text
OPTIONS -> 204 and exact CORS origin
invalid JWT POST -> 401 HTTP response
```

No real secret body is sent.

- [ ] **Step 4: Run final local gate**

Run:

```bash
rtk npm test
rtk npm run typecheck
rtk npm run build
rtk npm run test:browser
rtk npm run test:integration
rtk git diff --check
```

Expected: all green.

---

### Task 5: Apply production migration 010 and deploy secret function

**Files:**
- No additional source files unless verification exposes a defect.

**Interfaces:**
- Remote migration history becomes current through `202609160010`.
- Hosted `staff-secrets` becomes ACTIVE.
- Hosted `operations-settings` is redeployed only if memo behavior changed in its source.

- [ ] **Step 1: Dry-run production DB**

Run:

```bash
rtk npx supabase db push --dry-run
```

Expected: only `202609160010_staff_shared_secrets.sql` is pending.

- [ ] **Step 2: Apply migration 010**

Run:

```bash
rtk npx supabase db push --yes
```

Expected: migration 010 applies successfully.

- [ ] **Step 3: Deploy `staff-secrets` using server-side bundle path**

Run:

```bash
rtk npx supabase functions deploy staff-secrets --use-api
```

If `operations-settings` source changed for memo, also run:

```bash
rtk npx supabase functions deploy operations-settings --use-api
```

- [ ] **Step 4: Verify hosted boundary**

Run:

```bash
rtk npm run test:edge
rtk npx supabase functions list
rtk npx supabase db push --dry-run
```

Expected: hosted smoke passes, `staff-secrets` is ACTIVE, and remote DB is up to date.

- [ ] **Step 5: Run one final fresh completion gate**

Run:

```bash
rtk npm test && rtk npm run typecheck && rtk npm run build && rtk npm run test:browser && rtk npm run test:integration && rtk npm run test:edge && rtk git diff --check
```

Expected: all commands exit 0 with no failures.
