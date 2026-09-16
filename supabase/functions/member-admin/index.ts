import { corsHeaders, currentSemester, errorResponse, generateTemporaryPassword, HttpError, internalEmail, json, requireStaff, validateTemporaryPassword } from "../_shared/security.ts";

type Action = "create" | "update" | "reset_password";

type Body = {
  action?: Action;
  member_id?: string;
  name?: string;
  role?: "member" | "staff";
  active?: boolean;
  github_username?: string | null;
  semester_active?: boolean;
  individual_required?: boolean;
  team_required?: boolean;
  temporary_password?: string;
  expected_version?: number;
};

function cleanName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (name.length < 1 || name.length > 80) throw new HttpError(400, "이름은 1~80자로 입력해 주세요.");
  return name;
}
function cleanRole(value: unknown): "member" | "staff" {
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "POST 요청만 허용됩니다." });
  try {
    const { client, profile: staff } = await requireStaff(req);
    const body = await req.json() as Body;
    const action = body.action;
    if (!action) throw new HttpError(400, "작업을 선택해 주세요.");
    const semester = await currentSemester(client);
    const memberId = body.member_id?.trim().toLowerCase() ?? "";
    const email = internalEmail(memberId);

    const { data: target, error: targetError } = await client.from("profiles")
      .select("id,member_id,name,role,active,github_username,version").eq("member_id", memberId).maybeSingle();
    if (targetError) throw targetError;

    if (action === "create") {
      if (target) throw new HttpError(409, "이미 사용 중인 회원 아이디입니다.");
      const password = validateTemporaryPassword(body.temporary_password);
      const name = cleanName(body.name);
      const role = cleanRole(body.role ?? "member");
      const active = body.active !== false;
      const github = cleanGithub(body.github_username);
      const individualRequired = role === "staff" ? false : body.individual_required !== false;
      const teamRequired = role === "staff" ? false : body.team_required !== false;
      const { data: authResult, error: authError } = await client.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { asc_member_id: memberId, asc_name: name },
      });
      if (authError || !authResult.user) throw new HttpError(409, authError?.message ?? "계정을 만들지 못했습니다.");
      const userId = authResult.user.id;
      try {
        const { error: profileError } = await client.from("profiles").insert({ id: userId, member_id: memberId, name, role, active, github_username: github });
        if (profileError) throw profileError;
        const { error: membershipError } = await client.from("semester_memberships").insert({
          profile_id: userId, semester, active: body.semester_active !== false,
          individual_required: individualRequired, team_required: teamRequired,
        });
        if (membershipError) throw membershipError;
      } catch (error) {
        await client.auth.admin.deleteUser(userId);
        throw error;
      }
      return json(req, 200, { ok: true, member_id: memberId });
    }

    if (!target) throw new HttpError(404, "회원을 찾을 수 없습니다.");

    if (action === "reset_password") {
      const password = body.temporary_password === undefined || body.temporary_password === ""
        ? generateTemporaryPassword()
        : validateTemporaryPassword(body.temporary_password);
      validateTemporaryPassword(password);
      const { error } = await client.auth.admin.updateUserById(target.id, { password });
      if (error) throw error;
      return json(req, 200, { ok: true, member_id: memberId, temporary_password: password });
    }

    if (action === "update") {
      const { data: existingMembership, error: existingMembershipError } = await client.from("semester_memberships")
        .select("active,individual_required,team_required")
        .eq("profile_id", target.id).eq("semester", semester).maybeSingle();
      if (existingMembershipError) throw existingMembershipError;
      if (!Number.isInteger(body.expected_version) || Number(body.expected_version) !== target.version) {
        throw new HttpError(409, "회원 정보가 변경되었습니다. 새로고침 후 다시 저장해 주세요.");
      }
      const name = body.name === undefined ? target.name : cleanName(body.name);
      const role = body.role === undefined ? target.role : cleanRole(body.role);
      const active = body.active === undefined ? target.active : body.active;
      const github = body.github_username === undefined ? target.github_username : cleanGithub(body.github_username);
      const roleChanged = role !== target.role;
      const individualRequired = role === "staff" ? false : body.individual_required ?? (roleChanged ? true : existingMembership?.individual_required ?? true);
      const teamRequired = role === "staff" ? false : body.team_required ?? (roleChanged ? true : existingMembership?.team_required ?? true);
      if (target.id === staff.id && (!active || role !== "staff")) {
        throw new HttpError(400, "현재 로그인한 운영진 계정의 권한이나 활성 상태는 여기서 해제할 수 없습니다.");
      }
      const { data: nextVersion, error: updateError } = await client.rpc("update_member_admin_atomic", {
        p_target_id: target.id,
        p_semester: semester,
        p_expected_version: body.expected_version,
        p_name: name,
        p_role: role,
        p_active: active,
        p_github_username: github,
        p_semester_active: body.semester_active ?? existingMembership?.active ?? true,
        p_individual_required: individualRequired,
        p_team_required: teamRequired,
      });
      if (updateError) {
        if (updateError.code === "40001") throw new HttpError(409, "회원 정보가 변경되었습니다. 새로고침 후 다시 저장해 주세요.");
        throw updateError;
      }
      return json(req, 200, { ok: true, member_id: memberId, version: nextVersion });
    }

    throw new HttpError(400, "지원하지 않는 작업입니다.");
  } catch (error) {
    return errorResponse(req, error);
  }
});
