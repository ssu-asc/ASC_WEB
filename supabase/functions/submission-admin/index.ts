import { corsHeaders, errorResponse, HttpError, json, requireStaff } from "../_shared/security.ts";
import { buildProjectDbReport, type BuildProjectDbReportInput, type ProjectDbMember } from "../_shared/projectdb-report.ts";

type Body = {
  action?: "review" | "retry_projectdb_sync";
  submission_id?: string;
  status?: "revision_requested" | "approved";
  review_note?: string | null;
  expected_version?: number;
};

type SubmissionRow = {
  id: string;
  assignment_id: string;
  semester: string;
  project_type: "individual" | "team";
  owner_id: string | null;
  team_id: string | null;
  title: string;
  summary: string;
  code_repository_url: string | null;
  report_filename: string | null;
  report_markdown: string | null;
  report_bytes: number | null;
  report_repository_url: string | null;
  report_path: string | null;
  submitted_ref: string | null;
  status: "submitted" | "revision_requested" | "approved";
  review_note: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  version: number;
};

type ArchiveRecord = {
  schema_version: 1;
  submission_id: string;
  semester: string;
  project_type: "individual" | "team";
  title: string;
  summary: string;
  team_name: string | null;
  member_count: number;
  code_repository_url: string | null;
  report: { repository_url: string; path: string; ref: string };
  approved_at: string;
};

type ProjectDbConfig = {
  token: string;
  repository: string;
  branch: string;
  repositoryUrl: string;
  headers: Record<string, string>;
};

type Publication = {
  report_repository_url: string;
  report_path: string;
  submitted_ref: string;
} | null;

function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function projectDbConfig(): ProjectDbConfig {
  const token = Deno.env.get("PROJECTDB_TOKEN")?.trim();
  if (!token) throw new Error("PROJECTDB_TOKEN이 설정되지 않았습니다.");
  const repository = Deno.env.get("PROJECTDB_REPOSITORY")?.trim() || "ssu-asc/ProjectDB";
  const branch = Deno.env.get("PROJECTDB_BRANCH")?.trim() || "main";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("PROJECTDB_REPOSITORY 설정이 올바르지 않습니다.");
  return {
    token,
    repository,
    branch,
    repositoryUrl: `https://github.com/${repository}`,
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "ASC-Member-Portal",
    },
  };
}

async function putProjectDbFile(config: ProjectDbConfig, path: string, content: string, message: string): Promise<string> {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const endpoint = `https://api.github.com/repos/${config.repository}/contents/${encodedPath}`;
  let existingSha: string | undefined;
  const existing = await fetch(`${endpoint}?ref=${encodeURIComponent(config.branch)}`, { headers: config.headers });
  if (existing.ok) {
    const body = await existing.json();
    if (typeof body?.sha !== "string") throw new Error("ProjectDB 기존 파일 SHA를 확인할 수 없습니다.");
    existingSha = body.sha;
  } else if (existing.status !== 404) {
    throw new Error(`ProjectDB 기존 기록 확인 실패 (${existing.status})`);
  }

  const put = await fetch(endpoint, {
    method: "PUT",
    headers: { ...config.headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: base64Utf8(content),
      branch: config.branch,
      ...(existingSha ? { sha: existingSha } : {}),
    }),
  });
  if (!put.ok) {
    const text = (await put.text()).slice(0, 500);
    throw new Error(`ProjectDB 동기화 실패 (${put.status}): ${text}`);
  }
  const result = await put.json();
  const commitSha = typeof result?.commit?.sha === "string" ? result.commit.sha : "";
  if (!/^[0-9a-f]{40}$/i.test(commitSha)) throw new Error("ProjectDB commit SHA를 확인할 수 없습니다.");
  return commitSha;
}

async function loadArchiveRecord(client: any, submission: SubmissionRow, approvedAt: string): Promise<ArchiveRecord> {
  if (!submission.report_repository_url || !submission.report_path || !submission.submitted_ref) {
    throw new HttpError(409, "기존 제출의 ProjectDB 참조 정보가 없습니다.");
  }
  let teamName: string | null = null;
  let memberCount = 1;
  if (submission.project_type === "individual") {
    if (!submission.owner_id) throw new HttpError(409, "개인 제출의 회원 정보가 없습니다.");
  } else {
    if (!submission.team_id) throw new HttpError(409, "팀 제출의 팀 정보가 없습니다.");
    const { data: team, error: teamError } = await client.from("teams").select("name").eq("id", submission.team_id).single();
    if (teamError || !team) throw teamError ?? new Error("team not found");
    teamName = team.name;
    const { data: teamMembers, error: memberError } = await client.from("team_members")
      .select("profile_id").eq("team_id", submission.team_id).eq("semester", submission.semester);
    if (memberError || !teamMembers || teamMembers.length === 0) throw memberError ?? new Error("team members not found");
    memberCount = teamMembers.length;
  }
  return {
    schema_version: 1,
    submission_id: submission.id,
    semester: submission.semester,
    project_type: submission.project_type,
    title: submission.title,
    summary: submission.summary,
    team_name: teamName,
    member_count: memberCount,
    code_repository_url: submission.code_repository_url,
    report: { repository_url: submission.report_repository_url, path: submission.report_path, ref: submission.submitted_ref },
    approved_at: approvedAt,
  };
}

async function loadPortalReportInput(client: any, submission: SubmissionRow): Promise<BuildProjectDbReportInput> {
  if (!submission.report_markdown || !submission.report_filename || !submission.report_bytes) {
    throw new HttpError(409, "Markdown 제출 본문이 없습니다.");
  }
  const { data: assignment, error: assignmentError } = await client.from("assignments")
    .select("id,title,round_key,project_type").eq("id", submission.assignment_id).single();
  if (assignmentError || !assignment) throw assignmentError ?? new Error("assignment not found");
  if (assignment.project_type !== submission.project_type) throw new HttpError(409, "프로젝트 유형이 제출 정보와 일치하지 않습니다.");

  const common = {
    submissionId: submission.id,
    semester: submission.semester,
    projectType: submission.project_type,
    projectName: assignment.title,
    roundKey: assignment.round_key,
    submittedAt: submission.submitted_at,
    codeRepositoryUrl: submission.code_repository_url,
    reportMarkdown: submission.report_markdown,
  } as const;

  if (submission.project_type === "individual") {
    if (!submission.owner_id) throw new HttpError(409, "개인 제출의 회원 정보가 없습니다.");
    const { data: owner, error: ownerError } = await client.from("profiles")
      .select("member_id,name").eq("id", submission.owner_id).single<{ member_id: string; name: string }>();
    if (ownerError || !owner) throw ownerError ?? new Error("owner not found");
    return { ...common, projectType: "individual", individual: { memberId: owner.member_id, name: owner.name } };
  }

  if (!submission.team_id) throw new HttpError(409, "팀 제출의 팀 정보가 없습니다.");
  const { data: team, error: teamError } = await client.from("teams").select("name").eq("id", submission.team_id).single<{ name: string }>();
  if (teamError || !team) throw teamError ?? new Error("team not found");
  const { data: teamLinks, error: linkError } = await client.from("team_members")
    .select("profile_id").eq("team_id", submission.team_id).eq("semester", submission.semester).returns<Array<{ profile_id: string }>>();
  if (linkError || !teamLinks || teamLinks.length === 0) throw linkError ?? new Error("team members not found");
  const profileIds = teamLinks.map((row) => row.profile_id);
  const { data: profiles, error: profileError } = await client.from("profiles")
    .select("id,member_id,name").in("id", profileIds).returns<Array<{ id: string; member_id: string; name: string }>>();
  if (profileError || !profiles || profiles.length !== profileIds.length) throw profileError ?? new Error("team profiles not found");
  const members: ProjectDbMember[] = profiles
    .map((profile) => ({ memberId: profile.member_id, name: profile.name }))
    .sort((a, b) => a.memberId.localeCompare(b.memberId));
  return { ...common, projectType: "team", team: { name: team.name, members } };
}

async function syncMarkdownReport(client: any, submission: SubmissionRow, config: ProjectDbConfig): Promise<Publication> {
  const input = await loadPortalReportInput(client, submission);
  const built = buildProjectDbReport(input);
  const commitSha = await putProjectDbFile(config, built.path, built.markdown, `Publish portal report ${submission.id}`);
  return {
    report_repository_url: config.repositoryUrl,
    report_path: built.path,
    submitted_ref: commitSha,
  };
}

async function syncLegacyArchive(client: any, submission: SubmissionRow, approvedAt: string, config: ProjectDbConfig): Promise<null> {
  const record = await loadArchiveRecord(client, submission, approvedAt);
  const path = `portal-index/${submission.semester}/${submission.project_type}/${submission.id}/v${submission.version}.json`;
  await putProjectDbFile(config, path, `${JSON.stringify(record, null, 2)}\n`, `Archive portal submission ${submission.id}`);
  return null;
}

async function syncProjectDb(client: any, submission: SubmissionRow, approvedAt: string): Promise<Publication> {
  const config = projectDbConfig();
  return submission.report_markdown
    ? await syncMarkdownReport(client, submission, config)
    : await syncLegacyArchive(client, submission, approvedAt, config);
}

async function claimSyncAttempt(client: any, submissionId: string, version: number, attemptId: string) {
  const { data, error } = await client.from("submissions").update({
    projectdb_sync_status: "pending",
    projectdb_sync_error: null,
    projectdb_sync_attempt: attemptId,
  }).eq("id", submissionId).eq("version", version).eq("status", "approved").select("id").maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(409, "제출 상태가 변경되어 ProjectDB 동기화를 시작하지 못했습니다.");
}

async function persistSyncState(client: any, submissionId: string, version: number, attemptId: string, values: Record<string, unknown>) {
  const { data, error } = await client.from("submissions").update(values)
    .eq("id", submissionId).eq("version", version).eq("projectdb_sync_attempt", attemptId).select("id").maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(409, "더 최근의 ProjectDB 동기화 시도가 시작되었습니다.");
}

function expectedVersion(body: Body): number {
  if (!Number.isInteger(body.expected_version) || Number(body.expected_version) < 1) throw new HttpError(400, "검토 버전 정보가 필요합니다.");
  return Number(body.expected_version);
}

function successSyncValues(publication: Publication) {
  return {
    projectdb_sync_status: "synced",
    projectdb_sync_error: null,
    projectdb_synced_at: new Date().toISOString(),
    ...(publication ?? {}),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "POST 요청만 허용됩니다." });
  try {
    const { client, profile: staff } = await requireStaff(req);
    const body = await req.json() as Body;
    if (!body.submission_id) throw new HttpError(400, "제출물을 선택해 주세요.");
    const { data: submission, error: submissionError } = await client.from("submissions")
      .select("id,assignment_id,semester,project_type,owner_id,team_id,title,summary,code_repository_url,report_filename,report_markdown,report_bytes,report_repository_url,report_path,submitted_ref,status,review_note,submitted_at,reviewed_at,version")
      .eq("id", body.submission_id).maybeSingle<SubmissionRow>();
    if (submissionError || !submission) throw new HttpError(404, "제출물을 찾을 수 없습니다.");

    const requestedVersion = expectedVersion(body);
    if (submission.version !== requestedVersion) throw new HttpError(409, "제출물이 변경되었습니다. 새로고침 후 다시 검토해 주세요.");

    if (body.action === "retry_projectdb_sync") {
      if (submission.status !== "approved") throw new HttpError(409, "승인된 제출물만 ProjectDB 동기화를 다시 시도할 수 있습니다.");
      const attemptId = crypto.randomUUID();
      const approvedAt = submission.reviewed_at ?? submission.submitted_at;
      await claimSyncAttempt(client, submission.id, submission.version, attemptId);
      try {
        const publication = await syncProjectDb(client, submission, approvedAt);
        await persistSyncState(client, submission.id, submission.version, attemptId, successSyncValues(publication));
        return json(req, 200, { ok: true, projectdb_sync_status: "synced" });
      } catch (error) {
        if (error instanceof HttpError && error.status === 409) throw error;
        const message = error instanceof Error ? error.message.slice(0, 1000) : "ProjectDB 동기화 실패";
        await persistSyncState(client, submission.id, submission.version, attemptId, { projectdb_sync_status: "failed", projectdb_sync_error: message });
        return json(req, 200, { ok: true, projectdb_sync_status: "failed", projectdb_sync_error: message });
      }
    }

    if (body.action !== "review" || (body.status !== "revision_requested" && body.status !== "approved")) throw new HttpError(400, "검토 상태를 확인해 주세요.");
    const note = body.review_note?.trim() || null;
    if (note && note.length > 4000) throw new HttpError(400, "운영진 메모는 4000자 이하로 입력해 주세요.");
    const reviewedAt = new Date().toISOString();
    const nextVersion = submission.version + 1;
    const syncAttemptId = body.status === "approved" ? crypto.randomUUID() : null;
    const { data: updated, error: updateError } = await client.from("submissions").update({
      status: body.status, version: nextVersion, review_note: note, reviewed_at: reviewedAt, reviewed_by: staff.id,
      projectdb_sync_status: body.status === "approved" ? "pending" : "not_requested",
      projectdb_sync_error: null, projectdb_synced_at: null, projectdb_sync_attempt: syncAttemptId,
    }).eq("id", submission.id).eq("version", submission.version).eq("status", submission.status).select("id").maybeSingle();
    if (updateError) throw updateError;
    if (!updated) throw new HttpError(409, "제출물이 변경되었습니다. 새로고침 후 다시 검토해 주세요.");

    if (body.status === "revision_requested") return json(req, 200, { ok: true, status: body.status, version: nextVersion, projectdb_sync_status: "not_requested" });

    const approvedSubmission = { ...submission, version: nextVersion, status: "approved" as const, review_note: note, reviewed_at: reviewedAt };
    try {
      const publication = await syncProjectDb(client, approvedSubmission, reviewedAt);
      await persistSyncState(client, submission.id, nextVersion, syncAttemptId!, successSyncValues(publication));
      return json(req, 200, { ok: true, status: "approved", version: nextVersion, projectdb_sync_status: "synced" });
    } catch (error) {
      if (error instanceof HttpError && error.status === 409) throw error;
      const message = error instanceof Error ? error.message.slice(0, 1000) : "ProjectDB 동기화 실패";
      await persistSyncState(client, submission.id, nextVersion, syncAttemptId!, { projectdb_sync_status: "failed", projectdb_sync_error: message });
      return json(req, 200, { ok: true, status: "approved", version: nextVersion, projectdb_sync_status: "failed", projectdb_sync_error: message });
    }
  } catch (error) {
    return errorResponse(req, error);
  }
});
