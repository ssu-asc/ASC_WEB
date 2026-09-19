import test from "node:test";
import assert from "node:assert/strict";
import { buildProjectReportTemplate, stripProjectDbFrontmatter } from "../src/lib/project-report-template.ts";

test("team report template mirrors the ProjectDB progress-report structure and fills known context", () => {
  const markdown = buildProjectReportTemplate({
    projectName: "ASC 프로젝트 1회차",
    projectType: "team",
    opensAt: "2026-09-19T08:52:00.000Z",
    dueAt: "2026-10-24T08:52:00.000Z",
    individual: { member_id: "20260001", name: "홍길동" },
    team: {
      name: "1팀",
      members: [
        { member_id: "20260001", name: "홍길동" },
        { member_id: "20260002", name: "김ASC" },
      ],
    },
  });
  assert.match(markdown, /^# \[프로젝트 진행 보고서\] ASC 프로젝트 1회차/m);
  assert.match(markdown, /\*\*팀:\*\* 1팀/);
  assert.match(markdown, /홍길동 \(20260001\), 김ASC \(20260002\)/);
  for (const heading of ["팀 전체 진행 현황", "개인별 기여 내역", "이슈 및 해결 방안", "다음 회차 목표", "참고 자료"]) {
    assert.match(markdown, new RegExp(`## ${heading}`));
  }
  assert.match(markdown, /\| 홍길동 \(20260001\) \| \| \| \| \|/);
  assert.doesNotMatch(markdown.trimStart(), /^---/);
});

test("individual report template removes team-only friction while keeping the same reporting flow", () => {
  const markdown = buildProjectReportTemplate({
    projectName: "개인 프로젝트 1회차",
    projectType: "individual",
    opensAt: null,
    dueAt: null,
    individual: { member_id: "20260001", name: "홍길동" },
  });
  assert.match(markdown, /# \[개인 프로젝트 진행 보고서\] 개인 프로젝트 1회차/);
  assert.match(markdown, /작성자:\*\* 홍길동 \(20260001\)/);
  assert.match(markdown, /## 프로젝트 진행 현황/);
  assert.match(markdown, /## 수행 내역/);
  assert.doesNotMatch(markdown, /개인별 기여 내역/);
});

test("importing a legacy ProjectDB markdown file strips member-controlled frontmatter", () => {
  const source = `---\nproject_name: \"wrong\"\nquad_name: \"wrong\"\n---\n\n# 보고서\n\n본문`;
  const result = stripProjectDbFrontmatter(source);
  assert.equal(result.stripped, true);
  assert.equal(result.markdown, "# 보고서\n\n본문");
});

test("plain markdown import is preserved", () => {
  const source = "# 보고서\n\n본문";
  const result = stripProjectDbFrontmatter(source);
  assert.equal(result.stripped, false);
  assert.equal(result.markdown, source);
});
