import { corsHeaders, currentSemester, errorResponse, HttpError, json, requireSemesterMembership, requireUser } from "../_shared/security.ts";

type Body = {
  assignment_id?: string;
  summary?: string;
  code_repository_url?: string | null;
  report_filename?: string;
  report_markdown?: string;
  expected_version?: number;
};

type ExistingSubmission = { id: string; status: "submitted" | "revision_requested" | "approved"; version: number };

const MAX_MARKDOWN_BYTES = 262_144;

function cleanGithubRepo(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new HttpError(400, "GitHub 저장소 주소를 확인해 주세요.");
  const normalized = value.trim().replace(/\/$/, "");
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized)) {
    throw new HttpError(400, "GitHub 저장소 주소를 확인해 주세요.");
  }
  return normalized;
}

function cleanSummary(value: unknown): string {
  const summary = typeof value === "string" ? value.trim() : "";
  if (summary.length > 4000) throw new HttpError(400, "설명은 4000자 이하로 입력해 주세요.");
  return summary;
}

function cleanMarkdown(filenameValue: unknown, markdownValue: unknown): { filename: string; markdown: string; bytes: number } {
  if (typeof filenameValue !== "string" || typeof markdownValue !== "string") {
    throw new HttpError(400, "Markdown 보고서 파일이 필요합니다.");
  }
  const filename = filenameValue.trim();
  if (!filename || filename.length > 128 || filename.includes("/") || filename.includes("\\") || filename === "." || filename === ".." || !filename.toLowerCase().endsWith(".md")) {
    throw new HttpError(400, "보고서는 안전한 .md 파일 이름으로 올려 주세요.");
  }
  if (markdownValue.includes("\0")) throw new HttpError(400, "보고서에 사용할 수 없는 문자가 포함되어 있습니다.");
  if (!markdownValue.trim()) throw new HttpError(400, "빈 Markdown 파일은 제출할 수 없습니다.");
  if (markdownValue.trimStart().startsWith("---")) {
    throw new HttpError(400, "YAML frontmatter는 ASC_WEB이 자동 생성합니다. 본문만 올려 주세요.");
  }
  const bytes = new TextEncoder().encode(markdownValue).byteLength;
  if (bytes < 1 || bytes > MAX_MARKDOWN_BYTES) throw new HttpError(400, "Markdown 보고서는 256 KiB 이하로 올려 주세요.");
  return { filename, markdown: markdownValue, bytes };
}

async function updateExisting(client: any, existing: ExistingSubmission, expectedVersion: unknown, values: Record<string, unknown>) {
  if (existing.status === "approved") throw new HttpError(409, "승인된 제출물은 운영진이 다시 열기 전까지 수정할 수 없습니다.");
  if (!Number.isInteger(expectedVersion) || expectedVersion !== existing.version) {
    throw new HttpError(409, "다른 사용자가 제출물을 먼저 수정했습니다. 새로고침 후 다시 제출해 주세요.");
  }
  const { data, error } = await client.from("submissions").update({ ...values, version: existing.version + 1 })
    .eq("id", existing.id).eq("version", expectedVersion).eq("status", existing.status)
    .select("id,status,version,first_submitted_at,submitted_at").maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(409, "제출 상태가 방금 변경되었습니다. 새로고침 후 다시 제출해 주세요.");
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "POST 요청만 허용됩니다." });
  try {
    const { client, profile } = await requireUser(req);
    const body = await req.json() as Body;
    const semester = await currentSemester(client);
    const membership = await requireSemesterMembership(client, profile.id, semester);
    if (!body.assignment_id) throw new HttpError(400, "제출 항목을 확인할 수 없습니다.");
    const { data: assignment, error: assignmentError } = await client.from("assignments")
      .select("id,semester,project_type,title,active,opens_at,due_at")
      .eq("id", body.assignment_id).eq("semester", semester).eq("active", true).maybeSingle();
    if (assignmentError || !assignment) throw new HttpError(404, "현재 제출 가능한 항목이 아닙니다.");
    if (!assignment.opens_at || !assignment.due_at) throw new HttpError(409, "제출 일정이 설정되지 않은 프로젝트입니다.");
    const opensAt = new Date(assignment.opens_at).valueOf();
    if (!Number.isFinite(opensAt)) throw new HttpError(409, "제출 시작 시간을 확인할 수 없습니다.");
    if (Date.now() < opensAt) throw new HttpError(409, `아직 제출 기간이 아닙니다. ${assignment.opens_at} 이후 제출할 수 있습니다.`);
    if (assignment.project_type === "individual" && !membership.individual_required) throw new HttpError(403, "개인 프로젝트 제출 대상이 아닙니다.");
    if (assignment.project_type === "team" && !membership.team_required) throw new HttpError(403, "팀 프로젝트 제출 대상이 아닙니다.");

    let ownerId: string | null = null;
    let teamId: string | null = null;
    if (assignment.project_type === "individual") {
      ownerId = profile.id;
    } else {
      const { data: teamLink, error: teamLinkError } = await client.from("team_members")
        .select("team_id").eq("profile_id", profile.id).eq("semester", semester).maybeSingle<{ team_id: string }>();
      if (teamLinkError) throw teamLinkError;
      if (!teamLink) throw new HttpError(409, "팀 미배정 — 운영진에게 문의해 주세요.");
      teamId = teamLink.team_id;
    }

    const report = cleanMarkdown(body.report_filename, body.report_markdown);
    const payload = {
      title: assignment.title,
      summary: cleanSummary(body.summary),
      code_repository_url: cleanGithubRepo(body.code_repository_url),
      report_filename: report.filename,
      report_markdown: report.markdown,
      report_bytes: report.bytes,
      report_repository_url: null,
      report_path: null,
      submitted_ref: null,
    };

    const existingQuery = client.from("submissions").select("id,status,version")
      .eq("assignment_id", assignment.id);
    const { data: existing, error: existingError } = assignment.project_type === "individual"
      ? await existingQuery.eq("owner_id", ownerId).is("team_id", null).maybeSingle<ExistingSubmission>()
      : await existingQuery.eq("team_id", teamId).is("owner_id", null).maybeSingle<ExistingSubmission>();
    if (existingError) throw existingError;

    const submittedAt = new Date().toISOString();
    const values = {
      assignment_id: assignment.id, semester, project_type: assignment.project_type,
      owner_id: ownerId, team_id: teamId, ...payload,
      status: "submitted", submitted_at: submittedAt,
      projectdb_sync_status: "not_requested", projectdb_sync_error: null, projectdb_synced_at: null, projectdb_sync_attempt: null,
    };
    if (existing) {
      const data = await updateExisting(client, existing, body.expected_version, values);
      return json(req, 200, { ok: true, submission: data, team_id: teamId });
    }
    const { data, error } = await client.from("submissions")
      .insert({ ...values, first_submitted_at: submittedAt })
      .select("id,status,version,first_submitted_at,submitted_at").single();
    if (error || !data) throw error ?? new Error("submission write failed");
    return json(req, 200, { ok: true, submission: data, team_id: teamId });
  } catch (error) {
    return errorResponse(req, error);
  }
});
