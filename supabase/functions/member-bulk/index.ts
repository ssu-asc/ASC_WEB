import {
  corsHeaders,
  currentSemester,
  errorResponse,
  generateTemporaryPassword,
  HttpError,
  internalEmail,
  json,
  requireStaff,
  validateTemporaryPassword,
} from "../_shared/security.ts";

type Role = "member" | "staff";

type BulkRow = {
  row_id?: string;
  member_id?: string;
  name?: string;
  role?: Role;
  semester_active?: boolean;
  github_username?: string | null;
  account_active?: boolean;
  expected_version?: number;
  temporary_password?: string;
};

type Body = { action?: "apply"; rows?: BulkRow[] };

type NormalizedRow = {
  row_id: string;
  member_id: string;
  name: string;
  role: Role;
  semester_active: boolean;
  github_username: string | null;
  account_active: boolean;
  expected_version?: number;
  temporary_password?: string;
};

function cleanName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (name.length < 1 || name.length > 80) throw new HttpError(400, "이름은 1~80자로 입력해 주세요.");
  return name;
}

function cleanRole(value: unknown): Role {
  if (value !== "member" && value !== "staff") throw new HttpError(400, "권한을 확인해 주세요.");
  return value;
}

function cleanGithub(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(value.trim())) {
    throw new HttpError(400, "GitHub 아이디 형식을 확인해 주세요.");
  }
  return value.trim();
}

function cleanBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new HttpError(400, `${label} 값을 확인해 주세요.`);
  return value;
}

function cleanRow(value: BulkRow, index: number): NormalizedRow {
  const rowId = typeof value.row_id === "string" && value.row_id.trim() ? value.row_id.trim().slice(0, 100) : `row-${index + 1}`;
  const memberId = typeof value.member_id === "string" ? value.member_id.trim().toLowerCase() : "";
  internalEmail(memberId);
  const temporaryPassword = value.temporary_password === undefined || value.temporary_password === ""
    ? undefined
    : validateTemporaryPassword(value.temporary_password);
  if (value.expected_version !== undefined && (!Number.isInteger(value.expected_version) || value.expected_version < 1)) {
    throw new HttpError(400, "회원 버전을 확인해 주세요.");
  }
  return {
    row_id: rowId,
    member_id: memberId,
    name: cleanName(value.name),
    role: cleanRole(value.role),
    semester_active: cleanBoolean(value.semester_active, "학기 활동"),
    github_username: cleanGithub(value.github_username),
    account_active: cleanBoolean(value.account_active, "계정 상태"),
    expected_version: value.expected_version,
    temporary_password: temporaryPassword,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof HttpError || error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "회원 정보를 저장하지 못했습니다.";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "POST 요청만 허용됩니다." });

  try {
    const { client, profile: staff } = await requireStaff(req);
    const body = await req.json() as Body;
    if (body.action !== "apply" || !Array.isArray(body.rows)) throw new HttpError(400, "일괄 회원 작업 형식을 확인해 주세요.");
    if (body.rows.length === 0 || body.rows.length > 200) throw new HttpError(400, "한 번에 1~200명의 회원을 처리할 수 있습니다.");
    const semester = await currentSemester(client);
    const results: Array<{ row_id: string; member_id: string; ok: boolean; version?: number; created?: boolean; error?: string }> = [];
    const credentials: Array<{ member_id: string; temporary_password: string }> = [];

    for (let index = 0; index < body.rows.length; index += 1) {
      const input = body.rows[index];
      let fallbackRowId = typeof input?.row_id === "string" && input.row_id.trim() ? input.row_id.trim().slice(0, 100) : `row-${index + 1}`;
      let fallbackMemberId = typeof input?.member_id === "string" ? input.member_id.trim().toLowerCase() : "";
      try {
        const row = cleanRow(input ?? {}, index);
        fallbackRowId = row.row_id;
        fallbackMemberId = row.member_id;
        const { data: target, error: targetError } = await client.from("profiles")
          .select("id,member_id,role,active,version")
          .eq("member_id", row.member_id)
          .maybeSingle();
        if (targetError) throw targetError;

        const required = row.role === "member";
        if (target) {
          if (!Number.isInteger(row.expected_version) || row.expected_version !== target.version) {
            throw new HttpError(409, "회원 정보가 변경되었습니다. 새로고침 후 다시 저장해 주세요.");
          }
          if (target.id === staff.id && (!row.account_active || row.role !== "staff")) {
            throw new HttpError(400, "현재 로그인한 운영진 계정은 비활성화하거나 부원으로 변경할 수 없습니다.");
          }
          const { data: version, error: updateError } = await client.rpc("update_member_admin_atomic", {
            p_target_id: target.id,
            p_semester: semester,
            p_expected_version: row.expected_version,
            p_name: row.name,
            p_role: row.role,
            p_active: row.account_active,
            p_github_username: row.github_username,
            p_semester_active: row.semester_active,
            p_individual_required: required,
            p_team_required: required,
          });
          if (updateError) {
            if (updateError.code === "40001") throw new HttpError(409, "회원 정보가 변경되었습니다. 새로고침 후 다시 저장해 주세요.");
            if (updateError.code === "23514") throw new HttpError(409, "마지막 활성 운영진 계정은 해제할 수 없습니다.");
            throw updateError;
          }
          results.push({ row_id: row.row_id, member_id: row.member_id, ok: true, version: Number(version), created: false });
          continue;
        }

        const generated = !row.temporary_password;
        const password = row.temporary_password ?? generateTemporaryPassword();
        validateTemporaryPassword(password);
        const { data: authResult, error: authError } = await client.auth.admin.createUser({
          email: internalEmail(row.member_id),
          password,
          email_confirm: true,
          user_metadata: { asc_member_id: row.member_id, asc_name: row.name },
        });
        if (authError || !authResult.user) throw new HttpError(409, authError?.message ?? "계정을 만들지 못했습니다.");
        const userId = authResult.user.id;
        try {
          const { data: profileRow, error: profileError } = await client.from("profiles")
            .insert({
              id: userId,
              member_id: row.member_id,
              name: row.name,
              role: row.role,
              active: row.account_active,
              github_username: row.github_username,
            })
            .select("version")
            .single<{ version: number }>();
          if (profileError || !profileRow) throw profileError ?? new Error("profile create failed");
          const { error: membershipError } = await client.from("semester_memberships").insert({
            profile_id: userId,
            semester,
            active: row.semester_active,
            individual_required: required,
            team_required: required,
          });
          if (membershipError) throw membershipError;
          results.push({ row_id: row.row_id, member_id: row.member_id, ok: true, version: profileRow.version, created: true });
          if (generated) credentials.push({ member_id: row.member_id, temporary_password: password });
        } catch (error) {
          try { await client.auth.admin.deleteUser(userId); } catch { /* best-effort rollback */ }
          throw error;
        }
      } catch (error) {
        results.push({ row_id: fallbackRowId, member_id: fallbackMemberId, ok: false, error: errorMessage(error) });
      }
    }

    return json(req, 200, { ok: true, results, credentials });
  } catch (error) {
    return errorResponse(req, error);
  }
});
