import { corsHeaders, currentSemester, errorResponse, HttpError, json, requireStaff } from "../_shared/security.ts";

type Body =
  | { action?: "create_team"; name?: string }
  | { action?: "rename_team"; team_id?: string; expected_version?: number; name?: string }
  | { action?: "assign_member"; team_id?: string; profile_id?: string; expected_team_id?: string | null }
  | { action?: "remove_member"; team_id?: string; profile_id?: string; expected_team_id?: string }
  | { action?: "delete_team"; team_id?: string; expected_version?: number };

function cleanName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (name.length < 1 || name.length > 100) throw new HttpError(400, "팀 이름은 1~100자로 입력해 주세요.");
  return name;
}

function cleanId(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new HttpError(400, `${label}을 확인해 주세요.`);
  }
  return value;
}

function expectedVersion(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw new HttpError(400, "팀 버전을 확인해 주세요.");
  return Number(value);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "POST 요청만 허용됩니다." });
  try {
    const { client } = await requireStaff(req);
    const body = await req.json() as Body;
    const semester = await currentSemester(client);

    if (body.action === "create_team") {
      const { data, error } = await client.from("teams")
        .insert({ semester, name: cleanName(body.name) })
        .select("id,semester,name,version").single();
      if (error?.code === "23505") throw new HttpError(409, "같은 이름의 팀이 이미 있습니다.");
      if (error || !data) throw error ?? new Error("team create failed");
      return json(req, 200, { ok: true, team: data });
    }

    if (body.action === "rename_team") {
      const teamId = cleanId(body.team_id, "팀");
      const version = expectedVersion(body.expected_version);
      const { data, error } = await client.from("teams")
        .update({ name: cleanName(body.name), version: version + 1 })
        .eq("id", teamId).eq("semester", semester).eq("version", version)
        .select("id,semester,name,version").maybeSingle();
      if (error?.code === "23505") throw new HttpError(409, "같은 이름의 팀이 이미 있습니다.");
      if (error) throw error;
      if (!data) throw new HttpError(409, "팀 정보가 변경되었습니다. 새로고침 후 다시 시도해 주세요.");
      return json(req, 200, { ok: true, team: data });
    }

    if (body.action === "assign_member" || body.action === "remove_member") {
      const profileId = cleanId(body.profile_id, "회원");
      const targetTeamId = body.action === "assign_member" ? cleanId(body.team_id, "팀") : null;
      const expectedTeamId = body.expected_team_id == null ? null : cleanId(body.expected_team_id, "현재 팀");
      if (body.action === "remove_member" && expectedTeamId === null) throw new HttpError(400, "현재 팀을 확인해 주세요.");
      const { data, error } = await client.rpc("move_team_member_atomic", {
        p_semester: semester,
        p_profile_id: profileId,
        p_expected_team_id: expectedTeamId,
        p_target_team_id: targetTeamId,
      });
      if (error?.code === "P0001" && error.message?.includes("team membership changed")) throw new HttpError(409, "팀 배정이 변경되었습니다. 새로고침 후 다시 시도해 주세요.");
      if (error?.code === "23503" || error?.code === "23514") throw new HttpError(400, "활동 회원과 팀 정보를 확인해 주세요.");
      if (error) throw error;
      return json(req, 200, { ok: true, team_id: data ?? null });
    }

    if (body.action === "delete_team") {
      const teamId = cleanId(body.team_id, "팀");
      const version = expectedVersion(body.expected_version);
      const members = await client.from("team_members").select("profile_id", { count: "exact", head: true })
        .eq("team_id", teamId).eq("semester", semester);
      if (members.error) throw members.error;
      if ((members.count ?? 0) > 0) throw new HttpError(409, "팀원이 남아 있는 팀은 삭제할 수 없습니다.");
      const submissions = await client.from("submissions").select("id", { count: "exact", head: true })
        .eq("team_id", teamId).eq("semester", semester);
      if (submissions.error) throw submissions.error;
      if ((submissions.count ?? 0) > 0) throw new HttpError(409, "제출 기록이 있는 팀은 삭제할 수 없습니다.");
      const { data, error } = await client.from("teams").delete()
        .eq("id", teamId).eq("semester", semester).eq("version", version)
        .select("id").maybeSingle();
      if (error) throw error;
      if (!data) throw new HttpError(409, "팀 정보가 변경되었습니다. 새로고침 후 다시 시도해 주세요.");
      return json(req, 200, { ok: true });
    }

    throw new HttpError(400, "지원하지 않는 팀 관리 작업입니다.");
  } catch (error) {
    return errorResponse(req, error);
  }
});
