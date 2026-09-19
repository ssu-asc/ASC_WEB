import type { ProjectType } from "./member-domain";

export interface ReportTemplateMember {
  member_id: string;
  name: string;
}

export interface BuildReportTemplateInput {
  projectName: string;
  projectType: ProjectType;
  opensAt: string | null;
  dueAt: string | null;
  individual: ReportTemplateMember;
  team?: {
    name: string;
    members: ReportTemplateMember[];
  } | null;
}

function formatDate(value: string | null): string {
  if (!value) return "날짜 미정";
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return "날짜 확인 필요";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function activityPeriod(opensAt: string | null, dueAt: string | null): string {
  return `${formatDate(opensAt)} ~ ${formatDate(dueAt)}`;
}

function memberLabel(member: ReportTemplateMember): string {
  return `${member.name} (${member.member_id})`;
}

function teamContributionRows(members: ReportTemplateMember[]): string {
  if (members.length === 0) return "| 팀원 | 역할 | 수행 작업 | 산출물 링크 | 기여도 |\n|---|---|---|---|---|\n| - | | | | |";
  const header = "| 팀원 | 역할 | 수행 작업 | 산출물 링크 | 기여도 |\n|---|---|---|---|---|";
  const rows = members.map((member) => `| ${memberLabel(member)} | | | | |`).join("\n");
  return `${header}\n${rows}`;
}

export function buildProjectReportTemplate(input: BuildReportTemplateInput): string {
  const period = activityPeriod(input.opensAt, input.dueAt);
  if (input.projectType === "team") {
    const members = input.team?.members ?? [];
    const teamName = input.team?.name ?? "팀 미배정";
    const memberText = members.length > 0 ? members.map(memberLabel).join(", ") : "팀원을 확인해 주세요.";
    return `# [프로젝트 진행 보고서] ${input.projectName}

- **팀:** ${teamName}
- **팀원:** ${memberText}
- **활동 기간:** ${period}

## 팀 전체 진행 현황

- **이번 회차 목표:** 
- **현재 진행률:** 0%
- **주요 달성 사항:** 

## 개인별 기여 내역

> 각 팀원이 이번 회차에 구체적으로 무엇을 했는지 작성합니다. 산출물 링크(GitHub 커밋, PR, 분석한 코드 주소 등)가 있다면 함께 적어 주세요.

${teamContributionRows(members)}

## 이슈 및 해결 방안

- **문제 상황:** 
- **해결 현황:** 

## 다음 회차 목표

- 

## 참고 자료

- 
`;
  }

  return `# [개인 프로젝트 진행 보고서] ${input.projectName}

- **작성자:** ${memberLabel(input.individual)}
- **활동 기간:** ${period}

## 프로젝트 진행 현황

- **이번 회차 목표:** 
- **현재 진행률:** 0%
- **주요 달성 사항:** 

## 수행 내역

> 이번 회차에 직접 수행한 작업을 구체적으로 적어 주세요. 산출물 링크(GitHub 커밋, PR, 분석 자료, 데모 등)가 있다면 함께 적어 주세요.

- 

## 이슈 및 해결 방안

- **문제 상황:** 
- **해결 현황:** 

## 다음 회차 목표

- 

## 참고 자료

- 
`;
}

export function stripProjectDbFrontmatter(markdown: string): { markdown: string; stripped: boolean } {
  const normalized = markdown.replace(/^\uFEFF/, "");
  const lines = normalized.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { markdown: normalized, stripped: false };
  const closingIndex = lines.slice(1).findIndex((line) => line.trim() === "---");
  if (closingIndex < 0) return { markdown: normalized, stripped: false };
  const bodyStart = closingIndex + 2;
  const body = lines.slice(bodyStart).join("\n").replace(/^\n+/, "");
  return { markdown: body, stripped: true };
}
