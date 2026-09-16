# Spreadsheet Member Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace expandable per-member forms with a spreadsheet-like roster that supports direct editing, multi-row paste, batch save, and CSV/XLSX import/export while keeping Supabase Auth/profile/membership data consistent.

**Architecture:** Keep Supabase as the system of record. Parse/edit tabular data locally, validate before write, then send explicit row batches to a new privileged `member-bulk` Edge Function that performs independent row operations and returns row-level results plus one-time generated credentials for newly created accounts. Load the XLSX library dynamically only from the member-management route.

**Tech Stack:** Next.js 15.5.x, React 19, TypeScript 5, Supabase Auth/Postgres/Edge Functions, focused OOXML/XLSX reader-writer in the member spreadsheet module, Node built-in test runner.

**Execution ruling:** The approved plan originally named ExcelJS. During implementation, XLSX interoperability was delivered with a focused dependency-free OOXML ZIP/worksheet reader-writer instead. This keeps spreadsheet code scoped to the Member route, avoids a new runtime dependency, and is covered by XLSX export/import round-trip tests. The user-facing requirement and file workflow are unchanged.

**Spec:** `docs/superpowers/specs/2026-09-15-member-operations-redesign.md`

## Global Constraints

- Supabase remains the authoritative member/account source; Google Sheets API/OAuth sync is out of scope.
- Main editable columns are login ID, name, role, semester-active, GitHub username, and account-active.
- Normal active members derive `individual_required=true` and `team_required=true`; staff derive both false.
- Plaintext temporary passwords are never persisted in the database.
- Generated temporary passwords are returned only in the successful bulk operation response.
- Existing rows carry optimistic `expected_version` values.
- The last active staff account cannot be deactivated/demoted.
- Bulk processing reports row-level success/failure; successful independent rows remain applied when another row fails.
- XLSX code is dynamically imported only on the roster route.
- All shell commands in this repository begin with `rtk`.

---

### Task 1: Add spreadsheet normalization, paste parsing, and import/export domain helpers

**Files:**
- Create: `src/lib/member-spreadsheet.ts`
- Create: `tests/member-spreadsheet.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produce `SpreadsheetMemberRow`, `SpreadsheetValidationError`, and deterministic header mapping.
- Produce `parseTabularPaste(text)`, `parseCsv(text)`, `serializeCsv(rows)`, `normalizeImportedRows(headers, rows)`, and `validateSpreadsheetRows(rows)`.
- XLSX file parsing/writing will use dynamically imported `exceljs`; no grid library is introduced.

- [ ] **Step 1: Write failing spreadsheet parser tests**

Cover exact accepted headers and aliases:

```text
로그인 아이디 / member_id / id
이름 / name
권한 / role
이번 학기 활동 / semester_active
GitHub / github_username
계정 상태 / account_active
임시 비밀번호 / temporary_password
```

Add assertions for:

```js
const rows = parseTabularPaste("20260001\t홍길동\t부원\tY\tgildong\t활성\n20260002\t김ASC\t운영진\tY\t\t활성");
assert.equal(rows.length, 2);
assert.equal(rows[0].member_id, "20260001");
assert.equal(rows[1].role, "staff");

assert.deepEqual(validateSpreadsheetRows([
  { row_id: "1", member_id: "dup", name: "A", role: "member", semester_active: true, account_active: true, github_username: null },
  { row_id: "2", member_id: "dup", name: "B", role: "member", semester_active: true, account_active: true, github_username: null },
]).map((e) => e.code), ["duplicate_member_id"]);
```

CSV tests must cover quoted commas and escaped quotes.

- [ ] **Step 2: Run the focused test and verify failure**

```bash
rtk npm test -- --test-name-pattern="spreadsheet|tabular paste|csv"
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Install ExcelJS**

```bash
rtk npm install exceljs
```

Expected: `package.json` and lockfile add ExcelJS without changing the public page code path.

- [ ] **Step 4: Implement spreadsheet row types and normalization**

Use:

```ts
export type SpreadsheetRole = "member" | "staff";

export interface SpreadsheetMemberRow {
  row_id: string;
  member_id: string;
  name: string;
  role: SpreadsheetRole;
  semester_active: boolean;
  github_username: string | null;
  account_active: boolean;
  expected_version?: number;
  temporary_password?: string;
  existing_profile_id?: string;
}
```

Boolean parser accepts `Y`, `YES`, `TRUE`, `1`, `활성`, `예` as true and `N`, `NO`, `FALSE`, `0`, `비활성`, `아니오` as false, case-insensitively.

Role parser accepts `부원/member` and `운영진/staff` only.

`validateSpreadsheetRows` validates member ID with the same `^[a-z0-9][a-z0-9_-]{2,31}$` rule, name 1–80 characters, GitHub username rule, duplicate member IDs, and optional temporary password 12–128 characters.

- [ ] **Step 5: Implement TSV/CSV helpers**

`parseTabularPaste` treats tab as column separator and newline as row separator. If the first pasted row maps to recognized headers, consume it as headers; otherwise map positional columns in the six-main-column order.

`parseCsv` uses a state machine that handles quoted fields, commas, `\r\n`/`\n`, and doubled quotes. Do not parse CSV by `split(',')`.

`serializeCsv` writes UTF-8 compatible CSV text and quotes any field containing comma, quote, or newline.

- [ ] **Step 6: Run tests**

```bash
rtk npm test
rtk npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit spreadsheet parsing primitives**

```bash
rtk git add src/lib/member-spreadsheet.ts tests/member-spreadsheet.test.mjs package.json package-lock.json
rtk git commit -m "feat: add member spreadsheet parsing"
```

---

### Task 2: Add privileged bulk member apply API with generated one-time credentials

**Files:**
- Create: `supabase/functions/member-bulk/index.ts`
- Modify: `supabase/config.toml`
- Modify: `src/lib/member-api.ts`
- Modify: `supabase/functions/member-admin/index.ts`
- Test: `tests/member-contract.test.mjs`
- Test: `tests/live-supabase.mjs`

**Interfaces:**
- Produce `member-bulk` Edge Function accepting at most 200 rows per request.
- Produce `applyMemberBatch(client, rows)` returning row-level results and generated credentials.

- [ ] **Step 1: Add failing contract/integration tests**

Contract response:

```ts
export interface BulkMemberResult {
  row_id: string;
  member_id: string;
  ok: boolean;
  version?: number;
  created?: boolean;
  error?: string;
}

export interface GeneratedCredential {
  member_id: string;
  temporary_password: string;
}

export interface BulkMemberResponse {
  ok: true;
  results: BulkMemberResult[];
  credentials: GeneratedCredential[];
}
```

Integration cases:

```js
// staff bulk-creates two members, one with supplied password and one generated password
// response exposes generated password only for the row that needed generation
// created profiles/memberships exist and member rows have true/true requirements
// bulk-created staff has false/false requirements
// existing member update respects expected_version
// one invalid row fails while another valid row succeeds
// non-staff member-bulk invocation returns 403
// attempt to deactivate/demote the last active staff remains blocked
```

- [ ] **Step 2: Run focused tests and confirm failure**

```bash
rtk npm test -- --test-name-pattern="member-bulk|generated credential|bulk member"
```

Expected: FAIL.

- [ ] **Step 3: Implement server-side random temporary password generation**

Use `crypto.getRandomValues` with a restricted alphabet and 20 characters. Guarantee at least one uppercase, lowercase, digit, and symbol before shuffling with additional random bytes. The password is kept only in function memory/response and sent directly to `auth.admin.createUser`.

- [ ] **Step 4: Implement `member-bulk` independent row processing**

Request:

```ts
{ action: "apply"; rows: SpreadsheetMemberRow[] }
```

Server behavior per row:

1. validate/normalize `member_id`, name, role, booleans, GitHub username;
2. find profile by member ID;
3. if existing: require `expected_version`, reject attempts to self-demote/self-deactivate, then call `update_member_admin_atomic` using requirements derived from role;
4. if new: choose supplied valid password or generate one, create Auth user with internal email, insert profile, insert current-semester membership with role-derived requirements;
5. if profile/membership creation fails after Auth creation, call `auth.admin.deleteUser(userId)` best-effort and return a failed row result;
6. continue processing later rows after any independent failure;
7. return generated credential only after the corresponding new row fully succeeds.

Reject requests with 0 or more than 200 rows.

- [ ] **Step 5: Keep single-member semantics aligned**

Update `member-admin` so single create/update uses the same role-derived requirements as bulk operations. Do not let an ordinary UI role transition leave a staff account as a required submitter.

- [ ] **Step 6: Add client wrapper**

```ts
export async function applyMemberBatch(
  client: SupabaseClient,
  rows: SpreadsheetMemberRow[],
): Promise<BulkMemberResponse> {
  return invokePortal(client, "member-bulk", { action: "apply", rows });
}
```

- [ ] **Step 7: Run integration tests**

```bash
rtk npm test
rtk npm run test:integration
```

Expected: PASS with row-level partial success behavior.

- [ ] **Step 8: Commit bulk API**

```bash
rtk git add supabase/functions/member-bulk supabase/functions/member-admin supabase/config.toml src/lib/member-api.ts tests/member-contract.test.mjs tests/live-supabase.mjs
rtk git commit -m "feat: add bulk member account operations"
```

---

### Task 3: Replace member management with an editable spreadsheet grid

**Files:**
- Create: `src/component/member/MemberSpreadsheet.tsx`
- Modify: `src/app/member/operations/members/page.tsx`
- Modify: `src/styles/member.module.css`
- Test: `tests/member-browser.mjs`
- Test: `tests/member-spreadsheet.test.mjs`

**Interfaces:**
- Consumes `SemesterRoster`, spreadsheet helpers, and `applyMemberBatch`.
- Produces a dirty local grid with explicit save; no write happens per keystroke.

- [ ] **Step 1: Add failing browser checks for spreadsheet controls**

Require staff member-management page to expose:

```text
행 추가
붙여넣기
가져오기
내보내기
변경사항 저장
```

and a real table/grid with the six main columns.

- [ ] **Step 2: Run browser suite and confirm failure**

```bash
rtk npm run test:browser
```

Expected: FAIL because the old expandable editor remains.

- [ ] **Step 3: Implement grid state model**

Convert `SemesterRoster.rows` into `SpreadsheetMemberRow[]`, preserving `existing_profile_id` and `expected_version`.

Track:

```ts
const [rows, setRows] = useState<SpreadsheetMemberRow[]>([]);
const [baseline, setBaseline] = useState<Map<string, SpreadsheetMemberRow>>(new Map());
const [selected, setSelected] = useState<Set<string>>(new Set());
const [results, setResults] = useState<Map<string, BulkMemberResult>>(new Map());
```

Dirty rows are rows whose six editable values differ from baseline or that have no existing profile ID.

- [ ] **Step 4: Implement editable cells and row actions**

Use native inputs/selects/checkboxes inside a semantic table:

- member ID is editable only for a new unsaved row; existing IDs are immutable;
- role select has `부원`, `운영진`;
- semester/account status use checkboxes or explicit selects;
- GitHub is optional;
- row selection supports select-all;
- bulk actions set role, semester activity, or account activity only in local state;
- “행 추가” appends an empty new row with a stable client `row_id`.

Do not add a heavy third-party data-grid dependency.

- [ ] **Step 5: Implement save workflow**

On `변경사항 저장`:

1. derive dirty rows;
2. run `validateSpreadsheetRows` and highlight exact invalid rows/cells;
3. call `applyMemberBatch` with valid dirty rows;
4. show row-level success/error messages;
5. show a credential panel if response has generated credentials;
6. reload the roster after successful rows, preserving failed unsaved rows where practical.

- [ ] **Step 6: Implement paste dialog/action**

The “붙여넣기” action opens a textarea. Paste parses through `parseTabularPaste`, previews normalized rows, and merges them by `member_id`: matching existing IDs update local rows; new IDs append rows. Duplicate IDs in the pasted block are rejected before merge.

- [ ] **Step 7: Run browser/type/unit checks**

```bash
rtk npm test
rtk npm run typecheck
rtk npm run test:browser
```

Expected: PASS.

- [ ] **Step 8: Commit spreadsheet grid**

```bash
rtk git add src/component/member/MemberSpreadsheet.tsx src/app/member/operations/members/page.tsx src/styles/member.module.css tests/member-browser.mjs tests/member-spreadsheet.test.mjs
rtk git commit -m "feat: replace member editor with spreadsheet grid"
```

---

### Task 4: Add CSV/XLSX import preview, export, template, and credential download

**Files:**
- Modify: `src/component/member/MemberSpreadsheet.tsx`
- Modify: `src/lib/member-spreadsheet.ts`
- Modify: `src/styles/member.module.css`
- Test: `tests/member-spreadsheet.test.mjs`
- Test: `tests/member-browser.mjs`

**Interfaces:**
- Produce route-local dynamic functions `readXlsxFile(file)`, `downloadXlsx(rows, filename)`, and `downloadCsv(rows, filename)`.
- Import always previews before modifying local grid; it never writes to Supabase directly.

- [ ] **Step 1: Add failing import/export normalization tests**

Test deterministic six-column output plus optional temporary-password import field. Ensure exported rows map roles/statuses to Korean display values and re-import to the same normalized internal values.

- [ ] **Step 2: Implement CSV file import/export**

For `.csv`:

- read with `file.text()`;
- parse via `parseCsv`;
- normalize headers through `normalizeImportedRows`;
- show preview counts and validation errors;
- only `적용` merges preview into local grid;
- export prepends UTF-8 BOM so Excel opens Korean text cleanly.

- [ ] **Step 3: Implement XLSX dynamic import/export with ExcelJS**

Load only on file action:

```ts
const ExcelJS = await import("exceljs");
const workbook = new ExcelJS.Workbook();
```

Import:

```ts
await workbook.xlsx.load(await file.arrayBuffer());
const sheet = workbook.worksheets[0];
```

Read the first row as headers and subsequent non-empty rows as data before passing through the same normalization/validation path as CSV.

Export creates a workbook with one worksheet named `ASC 회원`, six main headers, and current grid rows. Template export creates only the supported headers, including optional `임시 비밀번호`, with no sample data row that could be imported accidentally.

- [ ] **Step 4: Add import preview UI**

Preview shows:

- filename/type;
- total rows;
- valid rows;
- invalid rows with row number/reason;
- duplicate member IDs;
- buttons `취소` and `그리드에 적용`.

No server write happens from the preview dialog.

- [ ] **Step 5: Add one-time credential copy/download**

When bulk response contains generated credentials, show them only in the current React state with:

- `클립보드 복사` as tab-separated `아이디\t임시 비밀번호`;
- `CSV 다운로드` using `serializeCsv`;
- a warning that closing/reloading the page discards this plaintext list.

Do not save credentials to localStorage/sessionStorage.

- [ ] **Step 6: Run all member-management checks**

```bash
rtk npm test
rtk npm run typecheck
rtk npm run build
rtk npm run test:browser
```

Expected: PASS.

- [ ] **Step 7: Commit file interoperability**

```bash
rtk git add src/component/member/MemberSpreadsheet.tsx src/lib/member-spreadsheet.ts src/styles/member.module.css tests/member-spreadsheet.test.mjs tests/member-browser.mjs
rtk git commit -m "feat: add csv and xlsx member workflows"
```

---

### Task 5: Finalize spreadsheet integration, docs, deployment, and regression gates

**Files:**
- Modify: `tests/live-supabase.mjs`
- Modify: `.planning/REQUIREMENTS.md`
- Modify: `.planning/ROADMAP.md`
- Modify: `.planning/STATE.md`
- Modify: `docs/member-portal-setup.md`

**Interfaces:**
- No new runtime API. This task proves and documents the completed member-management subsystem.

- [ ] **Step 1: Extend integration coverage for batch edge cases**

Verify:

- two successful creates in one batch;
- supplied vs generated password behavior;
- generated password can authenticate the created user;
- created staff gets false/false submit requirements;
- existing member update increments version;
- stale version returns a failed row without undoing another successful row;
- invalid GitHub/member ID returns row-specific error;
- Auth rollback leaves no orphan user when profile creation is forced to fail in the test fixture;
- last staff protection remains intact.

- [ ] **Step 2: Update GSD/operator docs**

Document:

- spreadsheet grid behavior;
- paste format;
- CSV/XLSX headers;
- one-time generated credential handling;
- `member-bulk` deployment;
- Google Sheets direct sync explicitly deferred.

- [ ] **Step 3: Run final gates for the whole portal**

```bash
rtk npm test
rtk npm run typecheck
rtk npm run build
rtk npm run test:browser
rtk npm run test:integration
rtk git diff --check
```

Expected: every command exits 0.

- [ ] **Step 4: Deploy the new Edge Function after local verification**

```bash
rtk npx supabase functions deploy member-bulk
rtk npx supabase functions deploy member-admin
```

No new secret is required for spreadsheet import/export; do not expose Supabase service credentials in logs/chat.

- [ ] **Step 5: Commit final spreadsheet verification/docs**

```bash
rtk git add tests/live-supabase.mjs .planning docs/member-portal-setup.md
rtk git commit -m "docs: finalize spreadsheet member management"
```
