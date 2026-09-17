"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMemberSession } from "./MemberSession";
import {
  applyMemberBatch,
  resetMemberPassword,
  type BulkMemberResult,
  type GeneratedCredential,
  type RosterRecord,
} from "@/lib/member-api";
import {
  createXlsxWorkbook,
  normalizeImportedRows,
  parseCsv,
  parseTabularPaste,
  parseXlsxWorkbook,
  serializeCsv,
  validateSpreadsheetRows,
  type SpreadsheetMemberRow,
  type SpreadsheetRole,
  type SpreadsheetValidationError,
} from "@/lib/member-spreadsheet";
import styles from "@/styles/member.module.css";

type Props = {
  records: RosterRecord[];
  onReload: () => void;
};

type BulkAction = "" | "role:member" | "role:staff";
type ImportPreview = { label: string; rows: SpreadsheetMemberRow[]; errors: SpreadsheetValidationError[] };

function recordToRow(record: RosterRecord): SpreadsheetMemberRow {
  return {
    row_id: record.profile.id,
    member_id: record.profile.member_id,
    name: record.profile.name,
    role: record.profile.role,
    semester_active: record.membership.active,
    github_username: record.profile.github_username,
    account_active: record.profile.active,
    expected_version: record.profile.version,
    existing_profile_id: record.profile.id,
  };
}

function baselineMap(rows: SpreadsheetMemberRow[]): Map<string, SpreadsheetMemberRow> {
  return new Map(rows.map((row) => [row.row_id, { ...row }]));
}

function rowSignature(row: SpreadsheetMemberRow): string {
  return JSON.stringify([
    row.member_id,
    row.name,
    row.role,
    row.temporary_password ?? "",
  ]);
}

function uniqueRowId(prefix = "row"): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function downloadText(filename: string, content: string, type = "text/csv;charset=utf-8") {
  const blob = new Blob(["\uFEFF", content], { type });
  downloadBlob(filename, blob);
}

function downloadBytes(filename: string, bytes: Uint8Array) {
  downloadBlob(filename, new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
}

function mergeRows(current: SpreadsheetMemberRow[], incoming: SpreadsheetMemberRow[]): SpreadsheetMemberRow[] {
  const next = current.map((row) => ({ ...row }));
  const indexByMemberId = new Map(next.map((row, index) => [row.member_id.toLocaleLowerCase(), index]));
  for (const row of incoming) {
    const key = row.member_id.toLocaleLowerCase();
    const existingIndex = indexByMemberId.get(key);
    if (existingIndex !== undefined) {
      const existing = next[existingIndex];
      next[existingIndex] = {
        ...existing,
        name: row.name,
        role: row.role,
        ...(existing.existing_profile_id ? {} : { temporary_password: row.temporary_password }),
      };
      continue;
    }
    const appended = { ...row, row_id: uniqueRowId("import") };
    indexByMemberId.set(key, next.length);
    next.push(appended);
  }
  return next;
}

export function MemberSpreadsheet({ records, onReload }: Props) {
  const { client } = useMemberSession();
  const initialRows = useMemo(() => records.map(recordToRow), [records]);
  const [rows, setRows] = useState<SpreadsheetMemberRow[]>(initialRows);
  const [baseline, setBaseline] = useState<Map<string, SpreadsheetMemberRow>>(() => baselineMap(initialRows));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Map<string, BulkMemberResult>>(new Map());
  const [validationErrors, setValidationErrors] = useState<SpreadsheetValidationError[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [bulkAction, setBulkAction] = useState<BulkAction>("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [credentials, setCredentials] = useState<GeneratedCredential[]>([]);
  const [resettingMemberId, setResettingMemberId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const fresh = records.map(recordToRow);
    setRows(fresh);
    setBaseline(baselineMap(fresh));
    setSelected(new Set());
    setResults(new Map());
    setValidationErrors([]);
  }, [records]);

  const dirtyRows = useMemo(() => rows.filter((row) => {
    const original = baseline.get(row.row_id);
    return !original || rowSignature(original) !== rowSignature(row);
  }), [rows, baseline]);

  const errorRows = useMemo(() => new Set(validationErrors.map((error) => error.row_id)), [validationErrors]);

  const updateRow = <K extends keyof SpreadsheetMemberRow>(rowId: string, key: K, value: SpreadsheetMemberRow[K]) => {
    setRows((current) => current.map((row) => row.row_id === rowId ? { ...row, [key]: value } : row));
    setResults((current) => { const next = new Map(current); next.delete(rowId); return next; });
  };

  const addRow = () => {
    setRows((current) => [...current, {
      row_id: uniqueRowId("new"), member_id: "", name: "", role: "member",
      semester_active: true, github_username: null, account_active: true,
    }]);
  };

  const toggleSelected = (rowId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      next.has(rowId) ? next.delete(rowId) : next.add(rowId);
      return next;
    });
  };

  const toggleAll = () => setSelected(selected.size === rows.length ? new Set() : new Set(rows.map((row) => row.row_id)));

  const removeUnsavedSelected = () => {
    setRows((current) => current.filter((row) => !selected.has(row.row_id) || Boolean(row.existing_profile_id)));
    setSelected(new Set());
  };

  const applyBulkAction = () => {
    if (!bulkAction || selected.size === 0) return;
    setRows((current) => current.map((row) => {
      if (!selected.has(row.row_id)) return row;
      if (bulkAction === "role:member") return { ...row, role: "member" as SpreadsheetRole };
      return { ...row, role: "staff" as SpreadsheetRole };
    }));
  };

  const previewIncoming = (label: string, incoming: SpreadsheetMemberRow[]) => {
    const simplified = incoming.map((row) => ({
      ...row,
      semester_active: true,
      github_username: null,
      account_active: true,
    }));
    const errors = validateSpreadsheetRows(simplified);
    setImportPreview({ label, rows: simplified, errors });
    setMessage(null);
  };

  const applyImportPreview = () => {
    if (!importPreview || importPreview.errors.length > 0) return;
    setRows((current) => mergeRows(current, importPreview.rows));
    setMessage(`${importPreview.rows.length}개 행을 작업표에 반영했습니다. 아직 서버에는 저장되지 않았습니다.`);
    setImportPreview(null);
    setPasteText("");
    setPasteOpen(false);
  };

  const applyPaste = () => {
    try {
      const incoming = parseTabularPaste(pasteText);
      if (incoming.length === 0) { setMessage("붙여넣을 회원 데이터가 없습니다."); return; }
      previewIncoming("붙여넣기", incoming);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "붙여넣은 데이터를 읽지 못했습니다.");
    }
  };

  const importFile = async (file: File) => {
    try {
      const lower = file.name.toLocaleLowerCase();
      let table: string[][];
      if (lower.endsWith(".csv")) {
        table = parseCsv(await file.text());
      } else if (lower.endsWith(".xlsx")) {
        table = await parseXlsxWorkbook(await file.arrayBuffer());
      } else {
        throw new Error("CSV 또는 XLSX 파일만 가져올 수 있습니다.");
      }
      if (table.length < 2) throw new Error("파일에 회원 행이 없습니다.");
      previewIncoming(file.name, normalizeImportedRows(table[0], table.slice(1)));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "회원 파일을 읽지 못했습니다.");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const exportXlsx = async (template = false) => {
    try {
      const bytes = await createXlsxWorkbook(template ? [] : rows, { includeTemporaryPassword: template });
      downloadBytes(template ? "asc-members-template.xlsx" : "asc-members.xlsx", bytes);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "XLSX 파일을 만들지 못했습니다.");
    }
  };

  const resetPassword = async (row: SpreadsheetMemberRow) => {
    if (!client || !row.existing_profile_id || resettingMemberId) return;
    if (!window.confirm(`${row.name || row.member_id} 회원의 비밀번호를 임시 비밀번호로 초기화할까요?`)) return;
    setResettingMemberId(row.member_id);
    setMessage(null);
    try {
      const result = await resetMemberPassword(client, row.member_id);
      setCredentials((current) => [
        ...current.filter((credential) => credential.member_id !== result.member_id),
        { member_id: result.member_id, temporary_password: result.temporary_password },
      ]);
      setMessage(`${row.name || row.member_id} 회원의 임시 비밀번호를 발급했습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "비밀번호를 초기화하지 못했습니다.");
    } finally {
      setResettingMemberId(null);
    }
  };

  const save = async () => {
    if (!client || busy) return;
    const errors = validateSpreadsheetRows(rows);
    setValidationErrors(errors);
    const invalidRows = new Set(errors.map((error) => error.row_id));
    const validDirty = dirtyRows.filter((row) => !invalidRows.has(row.row_id));
    if (validDirty.length === 0) {
      setMessage(errors.length ? "오류가 있는 행을 수정해 주세요." : "저장할 변경사항이 없습니다.");
      return;
    }
    setBusy(true); setMessage(null); setCredentials([]);
    try {
      const response = await applyMemberBatch(client, validDirty);
      const resultMap = new Map(response.results.map((result) => [result.row_id, result]));
      setResults(resultMap);
      setCredentials(response.credentials);
      const nextRows = rows.map((row) => {
        const result = resultMap.get(row.row_id);
        if (!result?.ok) return row;
        return {
          ...row,
          expected_version: result.version ?? row.expected_version,
          existing_profile_id: row.existing_profile_id ?? `saved:${row.member_id}`,
          temporary_password: undefined,
        };
      });
      setRows(nextRows);
      setBaseline((current) => {
        const next = new Map(current);
        for (const row of nextRows) {
          if (resultMap.get(row.row_id)?.ok) next.set(row.row_id, { ...row });
        }
        return next;
      });
      const succeeded = response.results.filter((result) => result.ok).length;
      const failed = response.results.length - succeeded;
      setMessage(`저장 ${succeeded}명${failed ? ` · 실패 ${failed}명` : ""}${errors.length ? ` · 입력 오류 ${errors.length}곳` : ""}`);
      if (failed === 0 && errors.length === 0) onReload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "회원 변경사항을 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const copyCredentials = async () => {
    if (credentials.length === 0) return;
    const text = credentials.map((credential) => `${credential.member_id}\t${credential.temporary_password}`).join("\n");
    await navigator.clipboard.writeText(text);
    setMessage("새 계정 임시 비밀번호를 클립보드에 복사했습니다.");
  };

  const downloadCredentials = () => {
    const csv = ["로그인 아이디,임시 비밀번호", ...credentials.map((credential) => `${credential.member_id},${credential.temporary_password}`)].join("\r\n");
    downloadText("asc-new-account-credentials.csv", csv);
  };

  return <section className={styles.spreadsheetSection}>
    <div className={styles.sheetToolbar}>
      <div className={styles.actions}>
        <button className={styles.smallButton} type="button" onClick={addRow}>행 추가</button>
        <button className={styles.smallButton} type="button" onClick={() => setPasteOpen((value) => !value)}>붙여넣기</button>
        <button className={styles.smallButton} type="button" onClick={() => fileInput.current?.click()}>가져오기</button>
        <button className={styles.smallButton} type="button" onClick={() => downloadText("asc-members.csv", serializeCsv(rows, false))}>CSV 내보내기</button>
        <button className={styles.smallButton} type="button" onClick={() => void exportXlsx(false)}>XLSX 내보내기</button>
        <button className={styles.smallButton} type="button" onClick={() => void exportXlsx(true)}>템플릿 다운로드</button>
        <input ref={fileInput} className={styles.srOnly} type="file" accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); }} />
      </div>
      <div className={styles.actions}>
        <select className={styles.sheetSelect} value={bulkAction} onChange={(event) => setBulkAction(event.target.value as BulkAction)} aria-label="선택 행 일괄 변경">
          <option value="">선택 행 일괄 변경</option>
          <option value="role:member">부원으로 변경</option>
          <option value="role:staff">운영진으로 변경</option>
        </select>
        <button className={styles.smallButton} type="button" disabled={!bulkAction || selected.size === 0} onClick={applyBulkAction}>적용</button>
        <button className={styles.smallButton} type="button" disabled={selected.size === 0} onClick={removeUnsavedSelected}>신규 행 제거</button>
      </div>
    </div>

    {pasteOpen && <div className={styles.formCard}>
      <h2>Excel / Google Sheets 붙여넣기</h2>
      <p className={styles.helper}>아이디, 이름, 권한 순서의 셀 범위를 그대로 붙여넣거나 헤더와 함께 붙여넣으세요. 신규 계정은 현재 학기 활동·계정 활성 상태로 생성됩니다.</p>
      <textarea className={styles.sheetPaste} rows={7} value={pasteText} onChange={(event) => setPasteText(event.target.value)} placeholder={"20260001\t홍길동\t부원"} />
      <div className={styles.actions}><button className={styles.button} type="button" onClick={applyPaste}>미리보기</button><button className={styles.smallButton} type="button" onClick={() => setPasteOpen(false)}>닫기</button></div>
    </div>}

    {importPreview && <section className={styles.formCard}>
      <h2>가져오기 미리보기</h2>
      <p className={styles.helper}>{importPreview.label} · 전체 {importPreview.rows.length}행 · 유효 {importPreview.rows.length - new Set(importPreview.errors.map((error) => error.row_id)).size}행 · 오류 {new Set(importPreview.errors.map((error) => error.row_id)).size}행</p>
      {importPreview.errors.length > 0 && <ul className={styles.importErrorList}>{importPreview.errors.slice(0, 12).map((error, index) => <li key={`${error.row_id}:${error.code}:${index}`}>{error.row_id} · {error.message}</li>)}</ul>}
      <div className={styles.tableWrap}><table className={styles.roster}><thead><tr><th>아이디</th><th>이름</th><th>권한</th></tr></thead><tbody>{importPreview.rows.slice(0, 10).map((row) => <tr key={row.row_id}><td>{row.member_id}</td><td>{row.name}</td><td>{row.role === "staff" ? "운영진" : "부원"}</td></tr>)}</tbody></table></div>
      <div className={styles.actions}><button className={styles.button} type="button" disabled={importPreview.errors.length > 0} onClick={applyImportPreview}>그리드에 적용</button><button className={styles.smallButton} type="button" onClick={() => setImportPreview(null)}>취소</button></div>
    </section>}

    <p className={styles.helper}>전체 {rows.length}명 · 변경 {dirtyRows.length}행 · 선택 {selected.size}행</p>
    <div className={styles.sheetTableWrap}>
      <table className={`${styles.roster} ${styles.sheetTable}`}>
        <caption className={styles.srOnly}>ASC 회원 편집 작업표</caption>
        <thead><tr>
          <th><input type="checkbox" aria-label="전체 선택" checked={rows.length > 0 && selected.size === rows.length} onChange={toggleAll} /></th>
          <th>로그인 아이디</th><th>이름</th><th>권한</th><th>관리</th><th>결과</th>
        </tr></thead>
        <tbody>{rows.map((row) => {
          const rowResult = results.get(row.row_id);
          const rowErrors = validationErrors.filter((error) => error.row_id === row.row_id);
          const dirty = !baseline.has(row.row_id) || rowSignature(baseline.get(row.row_id)!) !== rowSignature(row);
          return <tr key={row.row_id} data-error={errorRows.has(row.row_id)} data-dirty={dirty}>
            <td data-label="선택"><input type="checkbox" aria-label={`${row.member_id || "신규"} 선택`} checked={selected.has(row.row_id)} onChange={() => toggleSelected(row.row_id)} /></td>
            <td data-label="로그인 아이디"><input className={styles.sheetInput} value={row.member_id} disabled={Boolean(row.existing_profile_id)} onChange={(event) => updateRow(row.row_id, "member_id", event.target.value.toLocaleLowerCase())} placeholder="학번/아이디" /></td>
            <td data-label="이름"><input className={styles.sheetInput} value={row.name} onChange={(event) => updateRow(row.row_id, "name", event.target.value)} /></td>
            <td data-label="권한"><select value={row.role} onChange={(event) => updateRow(row.row_id, "role", event.target.value as SpreadsheetRole)}><option value="member">부원</option><option value="staff">운영진</option></select></td>
            <td data-label="관리">{row.existing_profile_id ? <button className={styles.smallButton} type="button" disabled={resettingMemberId !== null} onClick={() => void resetPassword(row)}>{resettingMemberId === row.member_id ? "초기화 중…" : "비밀번호 초기화"}</button> : <span className={styles.secondary}>저장 후 가능</span>}</td>
            <td data-label="결과" className={styles.sheetResult}>{rowErrors.length > 0 ? <span>{rowErrors[0].message}</span> : rowResult ? <span>{rowResult.ok ? "저장됨" : rowResult.error}</span> : dirty ? <span>변경됨</span> : <span>-</span>}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>

    {rows.length === 0 && <p className={styles.notice}>등록된 회원이 없습니다. 행 추가 또는 붙여넣기로 시작하세요.</p>}
    {message && <p className={styles.notice} role="status">{message}</p>}
    <div className={styles.actions}><button className={styles.button} type="button" disabled={busy || dirtyRows.length === 0} onClick={() => void save()}>{busy ? "저장 중…" : `변경사항 저장${dirtyRows.length ? ` (${dirtyRows.length})` : ""}`}</button></div>

    {credentials.length > 0 && <section className={styles.credentialPanel}>
      <h2>새 계정 임시 비밀번호</h2>
      <p className={styles.helper}>이 목록은 이번 저장 응답에서만 표시됩니다. 필요한 곳에 전달한 뒤 별도로 보관하지 않는 것을 권장합니다.</p>
      <div className={styles.tableWrap}><table className={styles.roster}><thead><tr><th>로그인 아이디</th><th>임시 비밀번호</th></tr></thead><tbody>{credentials.map((credential) => <tr key={credential.member_id}><td>{credential.member_id}</td><td><code>{credential.temporary_password}</code></td></tr>)}</tbody></table></div>
      <div className={styles.actions}><button className={styles.smallButton} type="button" onClick={() => void copyCredentials()}>계정정보 복사</button><button className={styles.smallButton} type="button" onClick={downloadCredentials}>CSV 다운로드</button></div>
    </section>}
  </section>;
}
