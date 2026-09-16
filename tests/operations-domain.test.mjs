import test from "node:test";
import assert from "node:assert/strict";
import {
  calendarDateForScheduleItem,
  mergeScheduleItems,
  computeSubmissionOverview,
  computeProjectRoundOverview,
  buildProjectDbRecord,
  validateEventDraft,
} from "../src/lib/member-domain.ts";
import { validateSubmissionDraft } from "../src/lib/submission-upload.ts";

const assignmentIndividual = {
  id: "a-ind", semester: "2026-2", project_type: "individual", title: "개인 프로젝트",
  description: "", opens_at: "2026-11-23T15:00:00.000Z", due_at: "2026-11-30T14:59:00.000Z", round_key: "round-0001", active: true, version: 1,
};
const assignmentTeam = {
  id: "a-team", semester: "2026-2", project_type: "team", title: "팀 프로젝트",
  description: "", opens_at: null, due_at: null, round_key: "final", active: true, version: 1,
};
const profiles = [
  { id: "u1", member_id: "20260001", name: "김하나", role: "member", active: true, github_username: "hana" },
  { id: "u2", member_id: "20260002", name: "이둘", role: "member", active: true, github_username: null },
  { id: "u3", member_id: "20260003", name: "박셋", role: "member", active: true, github_username: null },
];
const memberships = profiles.map((p) => ({ profile_id: p.id, semester: "2026-2", active: true, individual_required: true, team_required: true }));

test("submission draft accepts markdown upload and optional GitHub code repository", () => {
  const result = validateSubmissionDraft({
    summary: "설명",
    code_repository_url: "https://github.com/ssu-asc/code",
    report_filename: "report.md",
    report_markdown: "# 보고서\n\n내용",
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.bytes, new TextEncoder().encode("# 보고서\n\n내용").byteLength);
});

test("submission draft rejects invalid code repository and invalid markdown", () => {
  assert.equal(validateSubmissionDraft({
    summary: "", code_repository_url: "https://example.com/repo",
    report_filename: "report.md", report_markdown: "body",
  }).ok, false);
  assert.equal(validateSubmissionDraft({
    summary: "", code_repository_url: "",
    report_filename: "report.pdf", report_markdown: "body",
  }).ok, false);
  assert.equal(validateSubmissionDraft({
    summary: "", code_repository_url: "",
    report_filename: "report.md", report_markdown: "---\ntitle: member-controlled\n---\nbody",
  }).ok, false);
});

test("overview distinguishes individual missing, team unassigned, submitted and waived", () => {
  const rows = computeSubmissionOverview({
    semester: "2026-2", profiles, memberships,
    assignments: [assignmentIndividual, assignmentTeam],
    teams: [{ id: "t1", semester: "2026-2", name: "Team One" }],
    teamMembers: [{ team_id: "t1", profile_id: "u1", semester: "2026-2" }, { team_id: "t1", profile_id: "u2", semester: "2026-2" }],
    submissions: [{
      id: "s1", assignment_id: "a-ind", semester: "2026-2", project_type: "individual", owner_id: "u1", team_id: null,
      title: "개인1", summary: "", code_repository_url: null, report_repository_url: "https://github.com/a/b", report_path: "README.md",
      submitted_ref: "0123456789abcdef0123456789abcdef01234567", status: "submitted", review_note: null, submitted_at: "2026-09-15T00:00:00Z",
      projectdb_sync_status: "not_requested", projectdb_sync_error: null, projectdb_synced_at: null,
    }],
  });
  const u1Individual = rows.find((r) => r.profile.id === "u1" && r.assignment.project_type === "individual");
  const u2Individual = rows.find((r) => r.profile.id === "u2" && r.assignment.project_type === "individual");
  const u1Team = rows.find((r) => r.profile.id === "u1" && r.assignment.project_type === "team");
  const u3Team = rows.find((r) => r.profile.id === "u3" && r.assignment.project_type === "team");
  assert.equal(u1Individual?.state, "submitted");
  assert.equal(u2Individual?.state, "not_submitted");
  assert.equal(u1Team?.state, "not_submitted");
  assert.equal(u3Team?.state, "not_assigned");
});

test("round overview excludes staff and collapses team work to one row per team", () => {
  const teamAssignment = { ...assignmentTeam, opens_at: "2026-12-01T00:00:00.000Z", due_at: "2026-12-07T23:59:00.000Z", round_key: "round-0002" };
  const staff = { id: "staff", member_id: "staff01", name: "운영진", role: "staff", active: true, github_username: null, version: 1 };
  const memberProfiles = profiles.map((profile) => ({ ...profile, version: 1 }));
  const allProfiles = [...memberProfiles, staff];
  const allMemberships = [
    ...memberships,
    { profile_id: staff.id, semester: "2026-2", active: true, individual_required: false, team_required: false },
  ];
  const submissions = [
    {
      id: "s-ind", assignment_id: assignmentIndividual.id, semester: "2026-2", project_type: "individual", owner_id: "u1", team_id: null,
      title: "개인1", summary: "", code_repository_url: null, report_repository_url: "https://github.com/a/b", report_path: "README.md",
      submitted_ref: "0123456789abcdef0123456789abcdef01234567", status: "submitted", review_note: null,
      first_submitted_at: "2026-12-01T00:00:00.000Z", submitted_at: "2026-12-01T00:00:00.000Z",
      projectdb_sync_status: "not_requested", projectdb_sync_error: null, projectdb_synced_at: null, version: 1,
    },
    {
      id: "s-team", assignment_id: teamAssignment.id, semester: "2026-2", project_type: "team", owner_id: null, team_id: "t1",
      title: "팀1", summary: "", code_repository_url: null, report_repository_url: "https://github.com/a/b", report_path: "README.md",
      submitted_ref: "0123456789abcdef0123456789abcdef01234567", status: "approved", review_note: null,
      first_submitted_at: "2026-12-05T00:00:00.000Z", submitted_at: "2026-12-05T00:00:00.000Z",
      projectdb_sync_status: "synced", projectdb_sync_error: null, projectdb_synced_at: "2026-12-05T01:00:00.000Z", version: 2,
    },
  ];
  const overview = computeProjectRoundOverview({
    semester: "2026-2", profiles: allProfiles, memberships: allMemberships,
    assignments: [assignmentIndividual, teamAssignment],
    teams: [{ id: "t1", semester: "2026-2", name: "Team One", version: 1 }],
    teamMembers: [{ team_id: "t1", profile_id: "u1", semester: "2026-2" }, { team_id: "t1", profile_id: "u2", semester: "2026-2" }],
    submissions,
    now: new Date("2026-12-03T00:00:00.000Z"),
  });
  const individual = overview.summaries.find((summary) => summary.assignment.id === assignmentIndividual.id);
  const team = overview.summaries.find((summary) => summary.assignment.id === teamAssignment.id);
  assert.equal(individual?.total_expected, 3, "staff must not be counted as an individual submitter");
  assert.equal(individual?.submitted, 1);
  assert.equal(individual?.late, 1, "late count uses first submission time");
  assert.equal(overview.detailsByAssignment[assignmentIndividual.id].some((row) => row.display_name === "운영진"), false);
  assert.equal(team?.total_expected, 1, "two teammates collapse to one expected team submission");
  assert.equal(team?.submitted, 1);
  assert.equal(team?.approved, 1);
  assert.equal(overview.detailsByAssignment[teamAssignment.id].length, 1);
  assert.deepEqual(overview.detailsByAssignment[teamAssignment.id][0].member_names.sort(), ["김하나", "이둘"].sort());
  assert.deepEqual(overview.unassignedByAssignment[teamAssignment.id].map((profile) => profile.id), ["u3"]);
});

test("month calendar uses project deadline but general events keep their start date", () => {
  const items = mergeScheduleItems({
    assignments: [assignmentIndividual],
    events: [{ id: "calendar-event", semester: "2026-2", title: "세미나", category: "seminar", description: "", start_at: "2026-10-01T10:00:00Z", end_at: "2026-10-01T12:00:00Z", link_url: null, version: 1 }],
  });
  const project = items.find((item) => item.source === "assignment");
  const event = items.find((item) => item.source === "event");
  assert.equal(calendarDateForScheduleItem(project), assignmentIndividual.due_at);
  assert.equal(calendarDateForScheduleItem(event), event.start_at);
});

test("schedule renders scheduled project rounds as open-to-deadline ranges", () => {
  const items = mergeScheduleItems({
    assignments: [assignmentIndividual, assignmentTeam],
    events: [{ id: "e1", semester: "2026-2", title: "세미나", category: "seminar", description: "", start_at: "2026-10-01T10:00:00Z", end_at: null, link_url: null, version: 1 }],
  });
  assert.equal(items.length, 2, "unscheduled legacy assignment must not appear");
  const project = items.find((item) => item.source === "assignment");
  assert.equal(project?.title, "개인 프로젝트");
  assert.equal(project?.start_at, assignmentIndividual.opens_at);
  assert.equal(project?.end_at, assignmentIndividual.due_at);
  assert.equal(project?.project_type, "individual");
  assert.equal(items[0].start_at <= items[1].start_at, true);
});

test("event draft rejects invalid interval and non-http link", () => {
  assert.equal(validateEventDraft({ title: "회의", category: "meeting", description: "", start_at: "2026-10-02T12:00:00Z", end_at: "2026-10-01T12:00:00Z", link_url: null }).ok, false);
  assert.equal(validateEventDraft({ title: "회의", category: "meeting", description: "", start_at: "2026-10-01T12:00:00Z", end_at: null, link_url: "javascript:alert(1)" }).ok, false);
});

test("ProjectDB record pins the reviewed report without publishing member identities or operational notes", () => {
  const record = buildProjectDbRecord({
    submission: {
      id: "s1", assignment_id: "a-team", semester: "2026-2", project_type: "team", owner_id: null, team_id: "t1",
      title: "팀 프로젝트", summary: "요약", code_repository_url: "https://github.com/ssu-asc/code", report_repository_url: "https://github.com/ssu-asc/report",
      report_path: "docs/report.md", submitted_ref: "v1.0.0", status: "approved", review_note: "내부 메모", submitted_at: "2026-09-15T00:00:00Z",
      projectdb_sync_status: "pending", projectdb_sync_error: null, projectdb_synced_at: null,
    },
    members: profiles.slice(0, 2), teamName: "Team One", approvedAt: "2026-09-15T02:00:00Z",
  });
  assert.equal(record.schema_version, 1);
  assert.equal(record.report.ref, "v1.0.0");
  assert.equal(record.member_count, 2);
  assert.equal("review_note" in record, false);
  assert.equal("members" in record, false);
  assert.equal(JSON.stringify(record).includes("20260001"), false);
  assert.equal(JSON.stringify(record).includes("김하나"), false);
  assert.equal(JSON.stringify(record).includes("hana"), false);
});
