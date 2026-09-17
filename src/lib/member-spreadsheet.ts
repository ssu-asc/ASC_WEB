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

export type SpreadsheetValidationCode =
  | "duplicate_member_id"
  | "invalid_member_id"
  | "invalid_name"
  | "invalid_github_username"
  | "invalid_temporary_password";

export interface SpreadsheetValidationError {
  row_id: string;
  field: keyof SpreadsheetMemberRow | "member_id";
  code: SpreadsheetValidationCode;
  message: string;
}

const MAIN_HEADERS = [
  "member_id",
  "name",
  "role",
] as const;

const HEADER_ALIASES = new Map<string, keyof SpreadsheetMemberRow>([
  ["로그인 아이디", "member_id"],
  ["member_id", "member_id"],
  ["id", "member_id"],
  ["이름", "name"],
  ["name", "name"],
  ["권한", "role"],
  ["role", "role"],
  ["이번 학기 활동", "semester_active"],
  ["semester_active", "semester_active"],
  ["github", "github_username"],
  ["github_username", "github_username"],
  ["계정 상태", "account_active"],
  ["account_active", "account_active"],
  ["임시 비밀번호", "temporary_password"],
  ["temporary_password", "temporary_password"],
]);

function normalizeHeader(value: unknown): string {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function parseRole(value: unknown): SpreadsheetRole {
  const normalized = String(value ?? "").trim().toLocaleLowerCase();
  if (normalized === "부원" || normalized === "member") return "member";
  if (normalized === "운영진" || normalized === "staff") return "staff";
  throw new Error(`알 수 없는 권한 값입니다: ${String(value ?? "")}`);
}

function parseBoolean(value: unknown): boolean {
  const normalized = String(value ?? "").trim().toLocaleLowerCase();
  if (["y", "yes", "true", "1", "활성", "예"].includes(normalized)) return true;
  if (["n", "no", "false", "0", "비활성", "아니오"].includes(normalized)) return false;
  throw new Error(`알 수 없는 상태 값입니다: ${String(value ?? "")}`);
}

function normalizeRow(
  source: Record<string, unknown>,
  rowId: string,
): SpreadsheetMemberRow {
  const memberId = String(source.member_id ?? "").trim().toLocaleLowerCase();
  const name = String(source.name ?? "").trim();
  const github = String(source.github_username ?? "").trim();
  const password = String(source.temporary_password ?? "");
  return {
    row_id: rowId,
    member_id: memberId,
    name,
    role: parseRole(source.role ?? "member"),
    semester_active: parseBoolean(source.semester_active ?? "true"),
    github_username: github || null,
    account_active: parseBoolean(source.account_active ?? "true"),
    ...(password ? { temporary_password: password } : {}),
  };
}

function mappedHeaders(headers: unknown[]): Array<keyof SpreadsheetMemberRow | null> {
  return headers.map((header) => HEADER_ALIASES.get(normalizeHeader(header)) ?? null);
}

export function normalizeImportedRows(headers: unknown[], rows: unknown[][]): SpreadsheetMemberRow[] {
  const mapping = mappedHeaders(headers);
  if (!mapping.some(Boolean)) throw new Error("지원하는 회원관리 헤더를 찾을 수 없습니다.");
  return rows
    .filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""))
    .map((row, index) => {
      const source: Record<string, unknown> = {};
      mapping.forEach((field, columnIndex) => {
        if (field) source[field] = row[columnIndex] ?? "";
      });
      return normalizeRow(source, `import-${index + 1}`);
    });
}

export function parseTabularPaste(text: string): SpreadsheetMemberRow[] {
  const table = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.split("\t"))
    .filter((row) => row.some((cell) => cell.trim() !== ""));
  if (table.length === 0) return [];

  const firstMapping = mappedHeaders(table[0]);
  const headerCount = firstMapping.filter(Boolean).length;
  if (headerCount >= 2 && firstMapping.includes("member_id")) {
    return normalizeImportedRows(table[0], table.slice(1)).map((row, index) => ({ ...row, row_id: `paste-${index + 1}` }));
  }

  return table.map((cells, index) => {
    const source: Record<string, unknown> = {};
    MAIN_HEADERS.forEach((field, columnIndex) => { source[field] = cells[columnIndex] ?? ""; });
    if (cells.length > MAIN_HEADERS.length) source.temporary_password = cells[MAIN_HEADERS.length] ?? "";
    return normalizeRow(source, `paste-${index + 1}`);
  });
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field.length === 0) {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function quoteCsv(value: unknown): string {
  const text = String(value ?? "");
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

export function spreadsheetMatrix(rows: SpreadsheetMemberRow[], includeTemporaryPassword = true): string[][] {
  const header = ["로그인 아이디", "이름", "권한"];
  if (includeTemporaryPassword) header.push("임시 비밀번호");
  return [
    header,
    ...rows.map((row) => {
      const values = [
        row.member_id,
        row.name,
        row.role === "staff" ? "운영진" : "부원",
      ];
      if (includeTemporaryPassword) values.push(row.temporary_password ?? "");
      return values;
    }),
  ];
}

export function serializeCsv(rows: SpreadsheetMemberRow[], includeTemporaryPassword = true): string {
  return spreadsheetMatrix(rows, includeTemporaryPassword)
    .map((row) => row.map(quoteCsv).join(","))
    .join("\r\n");
}

export function validateSpreadsheetRows(rows: SpreadsheetMemberRow[]): SpreadsheetValidationError[] {
  const errors: SpreadsheetValidationError[] = [];
  const byId = new Map<string, SpreadsheetMemberRow[]>();
  for (const row of rows) {
    const id = row.member_id.trim().toLocaleLowerCase();
    byId.set(id, [...(byId.get(id) ?? []), row]);
    if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(id)) {
      errors.push({ row_id: row.row_id, field: "member_id", code: "invalid_member_id", message: "아이디는 영문, 숫자, 밑줄, 하이픈으로 3~32자 입력해 주세요." });
    }
    if (row.name.trim().length < 1 || row.name.trim().length > 80) {
      errors.push({ row_id: row.row_id, field: "name", code: "invalid_name", message: "이름은 1~80자로 입력해 주세요." });
    }
    if (row.github_username && !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(row.github_username.trim())) {
      errors.push({ row_id: row.row_id, field: "github_username", code: "invalid_github_username", message: "GitHub 아이디 형식을 확인해 주세요." });
    }
    if (row.temporary_password !== undefined && (row.temporary_password.length < 12 || row.temporary_password.length > 128 || row.temporary_password.trim().length === 0)) {
      errors.push({ row_id: row.row_id, field: "temporary_password", code: "invalid_temporary_password", message: "임시 비밀번호는 12~128자로 입력해 주세요." });
    }
  }
  for (const [memberId, duplicateRows] of byId) {
    if (!memberId || duplicateRows.length < 2) continue;
    for (const row of duplicateRows) {
      errors.push({ row_id: row.row_id, field: "member_id", code: "duplicate_member_id", message: "같은 아이디가 여러 행에 있습니다." });
    }
  }
  return errors;
}

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function fixedDosTimestamp(): { time: number; date: number } {
  return { time: 0, date: ((2026 - 1980) << 9) | (1 << 5) | 1 };
}

function storedZip(entries: Array<{ name: string; text: string }>): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;
  const timestamp = fixedDosTimestamp();

  for (const entry of entries) {
    const name = utf8Encoder.encode(entry.name);
    const data = utf8Encoder.encode(entry.text);
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length + data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, timestamp.time, true);
    localView.setUint16(12, timestamp.date, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, 0, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    localParts.push(local);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, timestamp.time, true);
    centralView.setUint16(14, timestamp.date, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, localOffset, true);
    central.set(name, 46);
    centralParts.push(central);
    localOffset += local.length;
  }

  const centralDirectory = concatBytes(centralParts);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralDirectory.length, true);
  endView.setUint32(16, localOffset, true);
  endView.setUint16(20, 0, true);
  return concatBytes([...localParts, centralDirectory, end]);
}

function xmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function xmlUnescape(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replaceAll("&apos;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&amp;", "&");
}

function columnName(index: number): string {
  let value = index + 1;
  let output = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    output = String.fromCharCode(65 + remainder) + output;
    value = Math.floor((value - 1) / 26);
  }
  return output;
}

function worksheetXml(matrix: string[][]): string {
  const rows = matrix.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
}

export async function createXlsxWorkbook(
  rows: SpreadsheetMemberRow[],
  options: { includeTemporaryPassword?: boolean } = {},
): Promise<Uint8Array> {
  const includeTemporaryPassword = options.includeTemporaryPassword ?? true;
  const matrix = spreadsheetMatrix(rows, includeTemporaryPassword);
  const entries = [
    {
      name: "[Content_Types].xml",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="ASC 회원" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      name: "xl/styles.xml",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    },
    { name: "xl/worksheets/sheet1.xml", text: worksheetXml(matrix) },
    {
      name: "docProps/app.xml",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>ASC_WEB</Application></Properties>`,
    },
    {
      name: "docProps/core.xml",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>ASC_WEB</dc:creator><cp:lastModifiedBy>ASC_WEB</cp:lastModifiedBy></cp:coreProperties>`,
    },
  ];
  return storedZip(entries);
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const minimum = Math.max(0, bytes.length - 0xffff - 22);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (bytes[offset] === 0x50 && bytes[offset + 1] === 0x4b && bytes[offset + 2] === 0x05 && bytes[offset + 3] === 0x06) return offset;
  }
  throw new Error("XLSX ZIP 디렉터리를 찾을 수 없습니다.");
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") throw new Error("이 브라우저에서는 압축된 XLSX를 읽을 수 없습니다.");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzipEntries(input: Uint8Array): Promise<Map<string, Uint8Array>> {
  const bytes = input;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = findEndOfCentralDirectory(bytes);
  const totalEntries = view.getUint16(endOffset + 10, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  let offset = centralOffset;
  const entries = new Map<string, Uint8Array>();

  for (let index = 0; index < totalEntries; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("XLSX ZIP 중앙 디렉터리가 손상되었습니다.");
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const filenameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = utf8Decoder.decode(bytes.subarray(offset + 46, offset + 46 + filenameLength));
    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error("XLSX ZIP 로컬 헤더가 손상되었습니다.");
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(dataOffset, dataOffset + compressedSize);
    const data = method === 0 ? compressed : method === 8 ? await inflateRaw(compressed) : (() => { throw new Error(`지원하지 않는 XLSX 압축 방식입니다: ${method}`); })();
    entries.set(name, data);
    offset += 46 + filenameLength + extraLength + commentLength;
  }
  return entries;
}

function attributeValue(attributes: string, name: string): string | null {
  const match = attributes.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return match ? xmlUnescape(match[1]) : null;
}

function sharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) =>
    [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((text) => xmlUnescape(text[1])).join("")
  );
}

function columnIndexFromRef(ref: string): number {
  const letters = ref.match(/^([A-Z]+)/i)?.[1]?.toUpperCase();
  if (!letters) return 0;
  let value = 0;
  for (const char of letters) value = value * 26 + char.charCodeAt(0) - 64;
  return value - 1;
}

function cellValue(attributes: string, body: string, strings: string[]): string {
  const type = attributeValue(attributes, "t") ?? "";
  if (type === "inlineStr") {
    return [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => xmlUnescape(match[1])).join("");
  }
  const raw = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? "";
  if (type === "s") return strings[Number.parseInt(raw, 10)] ?? "";
  if (type === "b") return raw === "1" ? "TRUE" : "FALSE";
  return xmlUnescape(raw);
}

function worksheetTable(xml: string, strings: string[]): string[][] {
  const output: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    const body = rowMatch[1];
    for (const cellMatch of body.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const ref = attributeValue(cellMatch[1], "r") ?? "A1";
      const index = columnIndexFromRef(ref);
      while (row.length <= index) row.push("");
      row[index] = cellValue(cellMatch[1], cellMatch[2], strings);
    }
    while (row.length > 0 && row[row.length - 1] === "") row.pop();
    if (row.some((value) => value !== "")) output.push(row);
  }
  return output;
}

export async function parseXlsxWorkbook(input: Uint8Array | ArrayBuffer): Promise<string[][]> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const entries = await unzipEntries(bytes);
  const sheet = entries.get("xl/worksheets/sheet1.xml");
  if (!sheet) throw new Error("XLSX의 첫 번째 워크시트를 찾을 수 없습니다.");
  const shared = entries.get("xl/sharedStrings.xml");
  const strings = shared ? sharedStrings(utf8Decoder.decode(shared)) : [];
  return worksheetTable(utf8Decoder.decode(sheet), strings);
}
