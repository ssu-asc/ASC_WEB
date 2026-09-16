import test from "node:test";
import assert from "node:assert/strict";
import { buildProjectDbReport } from "../supabase/functions/_shared/projectdb-report.ts";

const base = {
  submissionId: "11111111-1111-4111-8111-111111111111",
  semester: "2026-2",
  projectName: "Web Scanner / 심화",
  roundKey: "round-0002",
  submittedAt: "2026-09-16T01:30:00.000Z",
  codeRepositoryUrl: "https://github.com/ssu-asc/web-scanner",
  reportMarkdown: "# 개요\n\n회원이 올린 본문\n",
};

test("individual portal report uses personal ProjectDB path and trusted frontmatter", () => {
  const result = buildProjectDbReport({
    ...base,
    projectType: "individual",
    individual: { memberId: "20260001", name: "김하나" },
  });

  assert.equal(result.path, "reports/2026/개인/20260001-round-0002-Web-Scanner-심화/report-01.md");
  assert.match(result.markdown, /^---\nsource: "asc_web"\nproject_type: "individual"/);
  assert.match(result.markdown, /project_name: "Web Scanner \/ 심화"/);
  assert.match(result.markdown, /quad_name: "개인"/);
  assert.match(result.markdown, /members: \["20260001_김하나"\]/);
  assert.match(result.markdown, /report_number: 1/);
  assert.match(result.markdown, /date: "2026-09-16"/);
  assert.match(result.markdown, /portal_submission_id: "11111111-1111-4111-8111-111111111111"/);
  assert.match(result.markdown, /code_repository_url: "https:\/\/github.com\/ssu-asc\/web-scanner"/);
  assert.ok(result.markdown.endsWith("# 개요\n\n회원이 올린 본문\n"));
  assert.doesNotMatch(result.markdown, /cl_level|contributions/);
});

test("team portal report uses fixed team path and trusted member list", () => {
  const result = buildProjectDbReport({
    ...base,
    projectType: "team",
    codeRepositoryUrl: null,
    team: {
      name: "A조 / 레드팀",
      members: [
        { memberId: "20260001", name: "김하나" },
        { memberId: "20260002", name: "이둘" },
      ],
    },
  });

  assert.equal(result.path, "reports/2026/A조-레드팀/round-0002-Web-Scanner-심화/report-01.md");
  assert.match(result.markdown, /project_type: "team"/);
  assert.match(result.markdown, /quad_name: "A조 \/ 레드팀"/);
  assert.match(result.markdown, /members: \["20260001_김하나", "20260002_이둘"\]/);
  assert.doesNotMatch(result.markdown, /code_repository_url:/);
});

test("ProjectDB path sanitizer removes traversal and falls back safely", () => {
  const result = buildProjectDbReport({
    ...base,
    projectName: "../../\\\u0000",
    roundKey: "round-0003",
    projectType: "individual",
    individual: { memberId: "2026/../001", name: "테스트" },
  });
  assert.doesNotMatch(result.path, /\.\.|\\|\u0000/);
  assert.match(result.path, /^reports\/2026\/개인\//);
  assert.ok(result.path.endsWith("/report-01.md"));
});
