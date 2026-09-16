import test from "node:test";
import assert from "node:assert/strict";
import {
  parseTabularPaste,
  parseCsv,
  serializeCsv,
  normalizeImportedRows,
  validateSpreadsheetRows,
  createXlsxWorkbook,
  parseXlsxWorkbook,
} from "../src/lib/member-spreadsheet.ts";

test("spreadsheet paste maps positional rows and normalizes role/boolean values", () => {
  const rows = parseTabularPaste("20260001\t홍길동\t부원\tY\tgildong\t활성\n20260002\t김ASC\t운영진\t예\t\t비활성");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].member_id, "20260001");
  assert.equal(rows[0].role, "member");
  assert.equal(rows[0].semester_active, true);
  assert.equal(rows[0].account_active, true);
  assert.equal(rows[0].github_username, "gildong");
  assert.equal(rows[1].role, "staff");
  assert.equal(rows[1].semester_active, true);
  assert.equal(rows[1].account_active, false);
});

test("spreadsheet paste consumes recognized headers and aliases", () => {
  const rows = parseTabularPaste("member_id\tname\trole\tsemester_active\tgithub_username\taccount_active\ttemporary_password\nabc123\tAlice\tmember\tTRUE\talice-gh\t1\tLongTemporary!123");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].member_id, "abc123");
  assert.equal(rows[0].name, "Alice");
  assert.equal(rows[0].github_username, "alice-gh");
  assert.equal(rows[0].temporary_password, "LongTemporary!123");
});

test("normalizeImportedRows accepts Korean and English header aliases", () => {
  const rows = normalizeImportedRows(
    ["로그인 아이디", "이름", "권한", "이번 학기 활동", "GitHub", "계정 상태", "임시 비밀번호"],
    [["member-01", "홍길동", "부원", "YES", "hong", "활성", "Password!1234"]],
  );
  assert.deepEqual(rows.map((row) => ({
    member_id: row.member_id,
    name: row.name,
    role: row.role,
    semester_active: row.semester_active,
    github_username: row.github_username,
    account_active: row.account_active,
    temporary_password: row.temporary_password,
  })), [{
    member_id: "member-01",
    name: "홍길동",
    role: "member",
    semester_active: true,
    github_username: "hong",
    account_active: true,
    temporary_password: "Password!1234",
  }]);
});

test("validation reports duplicate member ids and field-specific errors", () => {
  const errors = validateSpreadsheetRows([
    { row_id: "1", member_id: "dup", name: "A", role: "member", semester_active: true, account_active: true, github_username: null },
    { row_id: "2", member_id: "dup", name: "B", role: "member", semester_active: true, account_active: true, github_username: null },
    { row_id: "3", member_id: "xy", name: "", role: "member", semester_active: true, account_active: true, github_username: "bad user" },
  ]);
  assert.equal(errors.filter((error) => error.code === "duplicate_member_id").length, 2);
  assert.equal(errors.some((error) => error.row_id === "3" && error.code === "invalid_member_id"), true);
  assert.equal(errors.some((error) => error.row_id === "3" && error.code === "invalid_name"), true);
  assert.equal(errors.some((error) => error.row_id === "3" && error.code === "invalid_github_username"), true);
});

test("csv parser handles quoted commas newlines and escaped quotes", () => {
  const parsed = parseCsv('member_id,name,github_username\r\nabc123,"Hong, Gil","quote""user"\r\ndef456,"Line\nBreak",');
  assert.deepEqual(parsed, [
    ["member_id", "name", "github_username"],
    ["abc123", "Hong, Gil", 'quote"user'],
    ["def456", "Line\nBreak", ""],
  ]);
});

test("csv serialization round trips spreadsheet rows deterministically", () => {
  const rows = [{
    row_id: "1",
    member_id: "abc123",
    name: "Hong, Gil",
    role: "member",
    semester_active: true,
    github_username: 'quote"user',
    account_active: false,
    temporary_password: "Password!1234",
  }];
  const csv = serializeCsv(rows);
  assert.match(csv, /^로그인 아이디,이름,권한,이번 학기 활동,GitHub,계정 상태,임시 비밀번호\r?\n/);
  const parsed = parseCsv(csv);
  assert.equal(parsed[1][0], "abc123");
  assert.equal(parsed[1][1], "Hong, Gil");
  assert.equal(parsed[1][4], 'quote"user');
  assert.equal(parsed[1][5], "비활성");
  const publicExport = serializeCsv(rows, false);
  assert.match(publicExport, /^로그인 아이디,이름,권한,이번 학기 활동,GitHub,계정 상태\r?\n/);
  assert.doesNotMatch(publicExport, /임시 비밀번호/);
});

test("xlsx export and import round trip the normalized member sheet", async () => {
  const rows = [{
    row_id: "1",
    member_id: "abc123",
    name: "홍길동",
    role: "member",
    semester_active: true,
    github_username: "hong",
    account_active: false,
  }, {
    row_id: "2",
    member_id: "staff01",
    name: "운영진",
    role: "staff",
    semester_active: true,
    github_username: null,
    account_active: true,
  }];
  const bytes = await createXlsxWorkbook(rows, { includeTemporaryPassword: false });
  assert.equal(bytes[0], 0x50); assert.equal(bytes[1], 0x4b, "xlsx must be a ZIP container");
  const table = await parseXlsxWorkbook(bytes);
  assert.deepEqual(table[0], ["로그인 아이디", "이름", "권한", "이번 학기 활동", "GitHub", "계정 상태"]);
  const normalized = normalizeImportedRows(table[0], table.slice(1));
  assert.deepEqual(normalized.map((row) => [row.member_id, row.name, row.role, row.semester_active, row.github_username, row.account_active]), [
    ["abc123", "홍길동", "member", true, "hong", false],
    ["staff01", "운영진", "staff", true, null, true],
  ]);
});

test("xlsx template contains supported headers only and includes optional password", async () => {
  const bytes = await createXlsxWorkbook([], { includeTemporaryPassword: true });
  const table = await parseXlsxWorkbook(bytes);
  assert.deepEqual(table, [["로그인 아이디", "이름", "권한", "이번 학기 활동", "GitHub", "계정 상태", "임시 비밀번호"]]);
});
