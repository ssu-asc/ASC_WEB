export type PortalProjectType = "individual" | "team";

export interface ProjectDbMember {
  memberId: string;
  name: string;
}

export interface BuildProjectDbReportInput {
  submissionId: string;
  semester: string;
  projectType: PortalProjectType;
  projectName: string;
  roundKey: string;
  submittedAt: string;
  codeRepositoryUrl: string | null;
  reportMarkdown: string;
  individual?: ProjectDbMember;
  team?: { name: string; members: ProjectDbMember[] };
}

export interface BuiltProjectDbReport {
  path: string;
  markdown: string;
}

function yearFromSemester(semester: string): string {
  const year = semester.match(/^(\d{4})/)?.[1];
  if (!year) throw new Error("학기 연도를 확인할 수 없습니다.");
  return year;
}

function pathSegment(value: string, fallback: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f/\\]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, 96);
  if (normalized && normalized !== "." && normalized !== "..") return normalized;
  return fallback.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "item";
}

function memberLabel(member: ProjectDbMember): string {
  return `${member.memberId}_${member.name}`;
}

function koreaDate(iso: string): string {
  const time = new Date(iso).valueOf();
  if (!Number.isFinite(time)) throw new Error("제출 시각을 확인할 수 없습니다.");
  return new Date(time + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

export function buildProjectDbReport(input: BuildProjectDbReportInput): BuiltProjectDbReport {
  const year = yearFromSemester(input.semester);
  if (!input.submissionId) throw new Error("제출 식별자가 필요합니다.");
  if (!input.projectName.trim()) throw new Error("프로젝트명이 필요합니다.");
  if (!input.roundKey.trim()) throw new Error("프로젝트 회차가 필요합니다.");
  if (!input.reportMarkdown.trim() || input.reportMarkdown.trimStart().startsWith("---")) {
    throw new Error("ProjectDB 본문은 frontmatter 없는 Markdown이어야 합니다.");
  }

  let quadName: string;
  let members: ProjectDbMember[];
  let ownerSegment: string;

  if (input.projectType === "individual") {
    if (!input.individual) throw new Error("개인 프로젝트 회원 정보가 필요합니다.");
    quadName = "개인";
    members = [input.individual];
    ownerSegment = pathSegment(input.individual.memberId, `member-${input.submissionId.slice(0, 8)}`);
  } else if (input.projectType === "team") {
    if (!input.team || input.team.members.length === 0) throw new Error("팀 프로젝트 팀원 정보가 필요합니다.");
    quadName = input.team.name;
    members = input.team.members;
    ownerSegment = pathSegment(input.team.name, `team-${input.submissionId.slice(0, 8)}`);
  } else {
    throw new Error("프로젝트 유형을 확인할 수 없습니다.");
  }

  const roundSegment = pathSegment(input.roundKey, `round-${input.submissionId.slice(0, 8)}`);
  const projectSegment = pathSegment(input.projectName, `project-${input.submissionId.slice(0, 8)}`);
  const projectFolder = `${roundSegment}-${projectSegment}`;
  const path = input.projectType === "individual"
    ? `reports/${year}/개인/${ownerSegment}-${projectFolder}/report-01.md`
    : `reports/${year}/${ownerSegment}/${projectFolder}/report-01.md`;

  const memberValues = members.map((member) => yamlString(memberLabel(member))).join(", ");
  const frontmatter = [
    "---",
    `source: ${yamlString("asc_web")}`,
    `project_type: ${yamlString(input.projectType)}`,
    `project_name: ${yamlString(input.projectName)}`,
    `quad_name: ${yamlString(quadName)}`,
    `members: [${memberValues}]`,
    "report_number: 1",
    `date: ${yamlString(koreaDate(input.submittedAt))}`,
    `status: ${yamlString("진행 중")}`,
    `portal_submission_id: ${yamlString(input.submissionId)}`,
  ];
  if (input.codeRepositoryUrl) frontmatter.push(`code_repository_url: ${yamlString(input.codeRepositoryUrl)}`);
  frontmatter.push("---", "");

  const body = input.reportMarkdown.endsWith("\n") ? input.reportMarkdown : `${input.reportMarkdown}\n`;
  return { path, markdown: `${frontmatter.join("\n")}\n${body}` };
}
