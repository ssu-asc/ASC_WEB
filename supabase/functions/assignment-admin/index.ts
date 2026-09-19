import { corsHeaders, currentSemester, errorResponse, HttpError, json, requireStaff } from "../_shared/security.ts";

type ProjectType = "individual" | "team";
type Body =
  | { action?: "create"; project_type?: ProjectType; title?: string; description?: string; opens_at?: string; due_at?: string; all_day?: boolean }
  | { action?: "create_series"; first_type?: ProjectType; title_prefix?: string; description?: string; first_opens_at?: string; first_due_at?: string; interval_weeks?: number; count?: number }
  | { action?: "update"; assignment_id?: string; expected_version?: number; title?: string; description?: string; opens_at?: string; due_at?: string; all_day?: boolean }
  | { action?: "deactivate"; assignment_id?: string; expected_version?: number };

function cleanType(value: unknown): ProjectType {
  if (value !== "individual" && value !== "team") throw new HttpError(400, "프로젝트 종류를 확인해 주세요.");
  return value;
}
function cleanTitle(value: unknown, max = 160): string {
  const title = typeof value === "string" ? value.trim() : "";
  if (!title || title.length > max) throw new HttpError(400, `제목은 1~${max}자로 입력해 주세요.`);
  return title;
}
function cleanDescription(value: unknown): string {
  const description = typeof value === "string" ? value.trim() : "";
  if (description.length > 4000) throw new HttpError(400, "설명은 4000자 이하로 입력해 주세요.");
  return description;
}
function cleanDate(value: unknown, label: string): string {
  if (typeof value !== "string") throw new HttpError(400, `${label}을 확인해 주세요.`);
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) throw new HttpError(400, `${label}을 확인해 주세요.`);
  return date.toISOString();
}
function kstDate(value: string): string {
  return new Date(new Date(value).valueOf() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function allDayStart(value: string): string {
  return new Date(`${kstDate(value)}T00:00:00+09:00`).toISOString();
}
function allDayEnd(value: string): string {
  return new Date(`${kstDate(value)}T23:59:59.999+09:00`).toISOString();
}
function cleanWindow(opensValue: unknown, dueValue: unknown, allDay = false): { opensAt: string; dueAt: string } {
  const rawOpensAt = cleanDate(opensValue, "제출 시작 시간");
  const rawDueAt = cleanDate(dueValue, "마감 시간");
  const opensAt = allDay ? allDayStart(rawOpensAt) : rawOpensAt;
  const dueAt = allDay ? allDayEnd(rawDueAt) : rawDueAt;
  if (new Date(dueAt).valueOf() <= new Date(opensAt).valueOf()) throw new HttpError(400, "마감 시간은 제출 시작 시간 이후여야 합니다.");
  return { opensAt, dueAt };
}
function cleanVersion(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw new HttpError(400, "프로젝트 버전을 확인해 주세요.");
  return Number(value);
}
function cleanId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new HttpError(400, "프로젝트 회차를 확인해 주세요.");
  }
  return value;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "POST 요청만 허용됩니다." });
  try {
    const { client } = await requireStaff(req);
    const body = await req.json() as Body;
    const semester = await currentSemester(client);

    if (body.action === "create") {
      const allDay = body.all_day === true;
      const window = cleanWindow(body.opens_at, body.due_at, allDay);
      const { data, error } = await client.rpc("create_assignment_atomic", {
        p_semester: semester,
        p_project_type: cleanType(body.project_type),
        p_title: cleanTitle(body.title),
        p_description: cleanDescription(body.description),
        p_opens_at: window.opensAt,
        p_due_at: window.dueAt,
      });
      if (error?.code === "23505") throw new HttpError(409, "프로젝트 회차 번호가 충돌했습니다. 다시 시도해 주세요.");
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : null;
      if (!row) throw new Error("assignment create returned no result");
      const allDayUpdate = await client.from("assignments").update({ all_day: allDay }).eq("id", row.assignment_id);
      if (allDayUpdate.error) throw allDayUpdate.error;
      return json(req, 200, { ok: true, assignment: row });
    }

    if (body.action === "create_series") {
      const window = cleanWindow(body.first_opens_at, body.first_due_at);
      const count = Number(body.count);
      const intervalWeeks = Number(body.interval_weeks);
      if (!Number.isInteger(count) || count < 1 || count > 30) throw new HttpError(400, "프로젝트 회차는 1~30회로 입력해 주세요.");
      if (!Number.isInteger(intervalWeeks) || intervalWeeks < 1 || intervalWeeks > 8) throw new HttpError(400, "반복 간격은 1~8주로 입력해 주세요.");
      const { data, error } = await client.rpc("create_assignment_series_atomic", {
        p_semester: semester,
        p_first_opens_at: window.opensAt,
        p_first_due_at: window.dueAt,
        p_interval_weeks: intervalWeeks,
        p_count: count,
        p_first_type: cleanType(body.first_type),
        p_title_prefix: cleanTitle(body.title_prefix, 120),
        p_description: cleanDescription(body.description),
      });
      if (error?.code === "23505") throw new HttpError(409, "프로젝트 회차 번호가 충돌했습니다. 다시 시도해 주세요.");
      if (error) throw error;
      return json(req, 200, { ok: true, assignments: Array.isArray(data) ? data : [] });
    }

    if (body.action === "update") {
      const assignmentId = cleanId(body.assignment_id);
      const version = cleanVersion(body.expected_version);
      const allDay = body.all_day === true;
      const window = cleanWindow(body.opens_at, body.due_at, allDay);
      const { data, error } = await client.from("assignments")
        .update({
          title: cleanTitle(body.title),
          description: cleanDescription(body.description),
          opens_at: window.opensAt,
          due_at: window.dueAt,
          all_day: allDay,
          version: version + 1,
        })
        .eq("id", assignmentId).eq("semester", semester).eq("version", version).eq("active", true)
        .select("id,version").maybeSingle();
      if (error) throw error;
      if (!data) throw new HttpError(409, "프로젝트 회차가 다른 운영진에 의해 변경되었습니다. 새로고침 후 다시 수정해 주세요.");
      return json(req, 200, { ok: true, assignment: data });
    }

    if (body.action === "deactivate") {
      const assignmentId = cleanId(body.assignment_id);
      const version = cleanVersion(body.expected_version);
      const submissionCount = await client.from("submissions").select("id", { count: "exact", head: true }).eq("assignment_id", assignmentId);
      if (submissionCount.error) throw submissionCount.error;
      if ((submissionCount.count ?? 0) > 0) throw new HttpError(409, "제출 기록이 있는 프로젝트 회차는 삭제할 수 없습니다.");
      const { data, error } = await client.from("assignments")
        .update({ active: false, version: version + 1 })
        .eq("id", assignmentId).eq("semester", semester).eq("version", version).eq("active", true)
        .select("id,version").maybeSingle();
      if (error) throw error;
      if (!data) throw new HttpError(409, "프로젝트 회차가 다른 운영진에 의해 변경되었습니다. 새로고침 후 다시 확인해 주세요.");
      return json(req, 200, { ok: true, assignment: data });
    }

    throw new HttpError(400, "지원하지 않는 프로젝트 관리 작업입니다.");
  } catch (error) {
    return errorResponse(req, error);
  }
});
