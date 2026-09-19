export type MemberRole = "member" | "staff";
export type ProjectType = "individual" | "team";
export type ProjectWindowState = "upcoming" | "open" | "overdue";
export type ReviewState = "submitted" | "revision_requested" | "approved";
export type DisplayState = ReviewState | "not_submitted" | "not_assigned" | "not_required";
export type ProjectDbSyncStatus = "not_requested" | "pending" | "synced" | "failed";
export type EventCategory = "project" | "seminar" | "ctf" | "meeting" | "presentation" | "other";
export type ScheduleSeriesKind = "event" | "project";
export type ScheduleProjectPattern = "individual" | "team" | "alternating";
export type ScheduleRecurrenceFrequency = "none" | "daily" | "weekly" | "monthly";
export type ScheduleRecurrenceEndMode = "count" | "until" | "never";

export interface Profile {
  id: string;
  member_id: string;
  name: string;
  role: MemberRole;
  active: boolean;
  github_username: string | null;
  version: number;
}
export interface Semester {
  id: string;
  title: string;
  active: boolean;
  is_current: boolean;
}
export interface SemesterMembership {
  profile_id: string;
  semester: string;
  active: boolean;
  individual_required: boolean;
  team_required: boolean;
}
export interface Assignment {
  id: string;
  semester: string;
  project_type: ProjectType;
  title: string;
  description: string;
  opens_at: string | null;
  due_at: string | null;
  round_key: string;
  active: boolean;
  version: number;
  all_day: boolean;
  schedule_series_id?: string | null;
  occurrence_index?: number | null;
}
export interface Submission {
  id: string;
  assignment_id: string;
  semester: string;
  project_type: ProjectType;
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
  status: ReviewState;
  first_submitted_at: string;
  submitted_at: string;
  review_note: string | null;
  projectdb_sync_status: ProjectDbSyncStatus;
  projectdb_sync_error: string | null;
  projectdb_synced_at: string | null;
  version: number;
}
export interface Team {
  id: string;
  semester: string;
  name: string;
  version: number;
}
export interface TeamMember {
  team_id: string;
  profile_id: string;
  semester: string;
}
export interface ScheduleEvent {
  id: string;
  semester: string;
  title: string;
  category: EventCategory;
  description: string;
  start_at: string;
  end_at: string | null;
  link_url: string | null;
  version: number;
  all_day: boolean;
  schedule_series_id?: string | null;
  occurrence_index?: number | null;
}

export interface ScheduleSeries {
  id: string;
  semester: string;
  kind: ScheduleSeriesKind;
  title: string;
  description: string;
  event_category: Exclude<EventCategory, "project"> | null;
  project_pattern: ScheduleProjectPattern | null;
  link_url: string | null;
  all_day: boolean;
  first_start_at: string;
  first_end_at: string;
  recurrence_frequency: ScheduleRecurrenceFrequency;
  recurrence_interval: number;
  weekdays: number[];
  end_mode: ScheduleRecurrenceEndMode;
  occurrence_count: number | null;
  until_at: string | null;
  active: boolean;
  version: number;
}
export interface ScheduleItem {
  id: string;
  source: "assignment" | "event";
  title: string;
  category: EventCategory;
  project_type: ProjectType | null;
  description: string;
  start_at: string;
  end_at: string | null;
  link_url: string | null;
  all_day: boolean;
  schedule_series_id?: string | null;
  occurrence_index?: number | null;
}
export interface SubmissionOverviewRow {
  profile: Profile;
  assignment: Assignment;
  team: Team | null;
  state: DisplayState;
  submission: Submission | null;
}

export interface MemberProjectProgressBucket {
  expected: number;
  submitted: number;
  approved: number;
  revision_requested: number;
  missing: number;
  upcoming: number;
  late: number;
  unassigned: number;
}

export type MemberProjectProgressState = "complete" | "waiting" | "revision" | "missing" | "unassigned" | "none";

export interface MemberProjectProgressRow {
  profile: Profile;
  team: Team | null;
  individual: MemberProjectProgressBucket;
  team_projects: MemberProjectProgressBucket;
  overall_state: MemberProjectProgressState;
}
export interface DashboardItem {
  assignment: Assignment;
  state: DisplayState;
  submission: Submission | null;
}

export const STATE_LABELS: Record<DisplayState, string> = {
  not_submitted: "미제출",
  not_assigned: "팀 미배정",
  not_required: "제출 대상 아님",
  submitted: "제출완료",
  revision_requested: "수정요청",
  approved: "승인",
};

/** A reserved internal identity, never a destination for email. */
export function memberIdToEmail(value: string): string {
  const id = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(id)) {
    throw new Error("아이디는 영문, 숫자, 밑줄, 하이픈으로 3~32자 입력해 주세요.");
  }
  return `${id}@members.asc.invalid`;
}

export function authEventAction(event: string): "clear" | "reload" | "ignore" {
  if (event === "SIGNED_OUT") return "clear";
  return ["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED"].includes(event) ? "reload" : "ignore";
}

export function validateNewPassword(password: string, confirmation: string): string | null {
  if (password.length < 12 || password.length > 128 || password.trim().length === 0) {
    return "새 비밀번호는 12~128자로 입력해 주세요.";
  }
  if (password !== confirmation) return "비밀번호 확인이 일치하지 않습니다.";
  return null;
}

export function isActiveStaff(profile: Profile | null): boolean {
  return profile?.active === true && profile.role === "staff";
}

export function hasActiveMembership(
  profile: Profile,
  membership: SemesterMembership | null,
  semester: string,
): boolean {
  return profile.active && membership?.active === true &&
    membership.profile_id === profile.id && membership.semester === semester;
}

export function projectWindowState(
  assignment: Pick<Assignment, "opens_at" | "due_at">,
  now = new Date(),
): ProjectWindowState {
  if (!assignment.opens_at || !assignment.due_at) return "upcoming";
  const opensAt = new Date(assignment.opens_at).valueOf();
  const dueAt = new Date(assignment.due_at).valueOf();
  const current = now.valueOf();
  if (!Number.isFinite(opensAt) || !Number.isFinite(dueAt)) return "upcoming";
  if (current < opensAt) return "upcoming";
  if (current <= dueAt) return "open";
  return "overdue";
}

export function isLateSubmission(
  submission: Pick<Submission, "first_submitted_at">,
  assignment: Pick<Assignment, "due_at">,
): boolean {
  if (!assignment.due_at) return false;
  const first = new Date(submission.first_submitted_at).valueOf();
  const due = new Date(assignment.due_at).valueOf();
  return Number.isFinite(first) && Number.isFinite(due) && first > due;
}

export interface AlternatingRoundPreview {
  ordinal: number;
  project_type: ProjectType;
  title: string;
  description: string;
  opens_at: string;
  due_at: string;
}

export function generateAlternatingRounds(input: {
  firstOpensAt: string;
  firstDueAt: string;
  intervalWeeks: number;
  count: number;
  firstType: ProjectType;
  titlePrefix: string;
  description: string;
}): AlternatingRoundPreview[] {
  const firstOpen = new Date(input.firstOpensAt).valueOf();
  const firstDue = new Date(input.firstDueAt).valueOf();
  if (!Number.isFinite(firstOpen) || !Number.isFinite(firstDue) || firstDue <= firstOpen) {
    throw new Error("첫 마감 시간은 제출 시작 시간 이후여야 합니다.");
  }
  if (!Number.isInteger(input.intervalWeeks) || input.intervalWeeks < 1 || input.intervalWeeks > 8) {
    throw new Error("반복 간격은 1~8주로 입력해 주세요.");
  }
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 30) {
    throw new Error("프로젝트 회차는 1~30회로 입력해 주세요.");
  }
  if (input.firstType !== "individual" && input.firstType !== "team") {
    throw new Error("시작 프로젝트 종류를 확인해 주세요.");
  }
  const prefix = input.titlePrefix.trim();
  if (!prefix || prefix.length > 120) throw new Error("프로젝트 제목 접두어를 확인해 주세요.");
  const intervalMs = input.intervalWeeks * 7 * 24 * 60 * 60 * 1000;
  const duration = firstDue - firstOpen;
  return Array.from({ length: input.count }, (_, index) => {
    const opensAt = firstOpen + intervalMs * index;
    const projectType: ProjectType = index % 2 === 0
      ? input.firstType
      : input.firstType === "individual" ? "team" : "individual";
    return {
      ordinal: index + 1,
      project_type: projectType,
      title: `${prefix} ${index + 1}회차`,
      description: input.description,
      opens_at: new Date(opensAt).toISOString(),
      due_at: new Date(opensAt + duration).toISOString(),
    };
  });
}

/** Input must come from successful queries; a transport error is never an empty roster. */
export function requireQueryData<T>(
  result: { data: T | null; error: unknown },
  label: string,
): T {
  if (result.error || result.data === null) {
    throw new Error(`${label}을 불러오지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.`);
  }
  return result.data;
}

export function buildDashboardItems(input: {
  profile: Profile;
  membership: SemesterMembership | null;
  semester: string;
  assignments: Assignment[];
  submissions: Submission[];
  teamIds: string[];
}): DashboardItem[] {
  const { profile, membership, semester, assignments, submissions, teamIds } = input;
  if (!hasActiveMembership(profile, membership, semester) || !membership) return [];
  return assignments.filter((assignment) => assignment.active && assignment.semester === semester).map((assignment) => {
    const required = assignment.project_type === "individual" ? membership.individual_required : membership.team_required;
    if (!required) return { assignment, state: "not_required", submission: null };
    if (assignment.project_type === "team" && teamIds.length === 0) {
      return { assignment, state: "not_assigned", submission: null };
    }
    const matches = submissions.filter((submission) => submission.assignment_id === assignment.id && (
      assignment.project_type === "individual"
        ? submission.owner_id === profile.id && submission.team_id === null
        : submission.owner_id === null && submission.team_id !== null && teamIds.includes(submission.team_id)
    ));
    if (matches.length > 1) throw new Error("제출 기록이 중복되어 있습니다. 운영진에게 확인을 요청해 주세요.");
    const submission = matches[0] ?? null;
    if (!submission) return { assignment, state: "not_submitted", submission: null };
    if (!["submitted", "revision_requested", "approved"].includes(submission.status)) {
      throw new Error("제출 상태를 확인할 수 없습니다. 운영진에게 확인을 요청해 주세요.");
    }
    return { assignment, state: submission.status, submission };
  });
}

export interface DashboardGroups {
  current: DashboardItem[];
  upcoming: DashboardItem[];
  history: DashboardItem[];
}

export function groupDashboardItems(items: DashboardItem[], now = new Date()): DashboardGroups {
  const scheduled = items
    .filter((item) => item.state !== "not_required" && item.assignment.opens_at && item.assignment.due_at)
    .sort((a, b) => new Date(a.assignment.opens_at!).valueOf() - new Date(b.assignment.opens_at!).valueOf());
  const current: DashboardItem[] = [];
  const upcoming: DashboardItem[] = [];
  const history: DashboardItem[] = [];
  for (const item of scheduled) {
    if (item.state === "approved") {
      history.push(item);
      continue;
    }
    if (projectWindowState(item.assignment, now) === "upcoming") upcoming.push(item);
    else current.push(item);
  }
  return { current, upcoming, history };
}

export function computeSubmissionOverview(input: {
  semester: string;
  profiles: Profile[];
  memberships: SemesterMembership[];
  assignments: Assignment[];
  teams: Team[];
  teamMembers: TeamMember[];
  submissions: Submission[];
}): SubmissionOverviewRow[] {
  const { semester, profiles, memberships, assignments, teams, teamMembers, submissions } = input;
  const membershipByProfile = new Map(memberships.filter((m) => m.semester === semester).map((m) => [m.profile_id, m]));
  const teamById = new Map(teams.filter((team) => team.semester === semester).map((team) => [team.id, team]));
  const teamMembershipByProfile = new Map<string, TeamMember>();
  for (const member of teamMembers.filter((row) => row.semester === semester)) {
    if (teamMembershipByProfile.has(member.profile_id)) throw new Error("한 회원에게 여러 팀이 연결되어 있습니다.");
    teamMembershipByProfile.set(member.profile_id, member);
  }
  const activeAssignments = assignments.filter((assignment) => assignment.semester === semester && assignment.active);
  const rows: SubmissionOverviewRow[] = [];
  for (const profile of profiles.filter((profile) => profile.active)) {
    const membership = membershipByProfile.get(profile.id);
    if (!membership?.active) continue;
    for (const assignment of activeAssignments) {
      const required = assignment.project_type === "individual" ? membership.individual_required : membership.team_required;
      if (!required) {
        rows.push({ profile, assignment, team: null, state: "not_required", submission: null });
        continue;
      }
      if (assignment.project_type === "individual") {
        const matches = submissions.filter((s) => s.assignment_id === assignment.id && s.owner_id === profile.id && s.team_id === null);
        if (matches.length > 1) throw new Error("개인 프로젝트 제출 기록이 중복되어 있습니다.");
        const submission = matches[0] ?? null;
        rows.push({ profile, assignment, team: null, state: submission?.status ?? "not_submitted", submission });
        continue;
      }
      const teamMembership = teamMembershipByProfile.get(profile.id);
      if (!teamMembership) {
        rows.push({ profile, assignment, team: null, state: "not_assigned", submission: null });
        continue;
      }
      const team = teamById.get(teamMembership.team_id) ?? null;
      if (!team) throw new Error("팀 정보가 존재하지 않습니다.");
      const matches = submissions.filter((s) => s.assignment_id === assignment.id && s.owner_id === null && s.team_id === team.id);
      if (matches.length > 1) throw new Error("팀 프로젝트 제출 기록이 중복되어 있습니다.");
      const submission = matches[0] ?? null;
      rows.push({ profile, assignment, team, state: submission?.status ?? "not_submitted", submission });
    }
  }
  return rows;
}

function emptyProgressBucket(): MemberProjectProgressBucket {
  return { expected: 0, submitted: 0, approved: 0, revision_requested: 0, missing: 0, upcoming: 0, late: 0, unassigned: 0 };
}

function summarizeProjectRows(rows: SubmissionOverviewRow[], now = new Date()): MemberProjectProgressBucket {
  const bucket = emptyProgressBucket();
  for (const row of rows) {
    if (row.state === "not_required") continue;
    bucket.expected += 1;
    if (row.submission) {
      bucket.submitted += 1;
      if (isLateSubmission(row.submission, row.assignment)) bucket.late += 1;
    }
    if (row.state === "approved") bucket.approved += 1;
    if (row.state === "revision_requested") bucket.revision_requested += 1;
    if (row.state === "not_submitted") {
      if (projectWindowState(row.assignment, now) === "upcoming") bucket.upcoming += 1;
      else bucket.missing += 1;
    }
    if (row.state === "not_assigned") bucket.unassigned += 1;
  }
  return bucket;
}

export function computeMemberProjectProgress(input: {
  semester: string;
  profiles: Profile[];
  memberships: SemesterMembership[];
  assignments: Assignment[];
  teams: Team[];
  teamMembers: TeamMember[];
  submissions: Submission[];
  now?: Date;
}): MemberProjectProgressRow[] {
  const rows = computeSubmissionOverview(input);
  const now = input.now ?? new Date();
  const membershipByProfile = new Map(input.memberships.filter((membership) => membership.semester === input.semester).map((membership) => [membership.profile_id, membership]));
  const teamById = new Map(input.teams.filter((team) => team.semester === input.semester).map((team) => [team.id, team]));
  const teamLinkByProfile = new Map(input.teamMembers.filter((link) => link.semester === input.semester).map((link) => [link.profile_id, link.team_id]));

  return input.profiles
    .filter((profile) => profile.role === "member" && profile.active && membershipByProfile.get(profile.id)?.active === true)
    .map((profile) => {
      const memberRows = rows.filter((row) => row.profile.id === profile.id);
      const individual = summarizeProjectRows(memberRows.filter((row) => row.assignment.project_type === "individual"), now);
      const teamProjects = summarizeProjectRows(memberRows.filter((row) => row.assignment.project_type === "team"), now);
      const teamId = teamLinkByProfile.get(profile.id);
      const team = teamId ? teamById.get(teamId) ?? null : null;
      let overallState: MemberProjectProgressState = "none";
      if (individual.expected + teamProjects.expected > 0) {
        if (teamProjects.unassigned > 0) overallState = "unassigned";
        else if (individual.missing + teamProjects.missing > 0) overallState = "missing";
        else if (individual.revision_requested + teamProjects.revision_requested > 0) overallState = "revision";
        else if (individual.approved + teamProjects.approved === individual.expected + teamProjects.expected) overallState = "complete";
        else overallState = "waiting";
      }
      return { profile, team, individual, team_projects: teamProjects, overall_state: overallState };
    })
    .sort((a, b) => {
      const rank: Record<MemberProjectProgressState, number> = { unassigned: 0, missing: 1, revision: 2, waiting: 3, none: 4, complete: 5 };
      return rank[a.overall_state] - rank[b.overall_state] || a.profile.name.localeCompare(b.profile.name, "ko");
    });
}

export interface ProjectRoundSummary {
  assignment: Assignment;
  total_expected: number;
  submitted: number;
  late: number;
  revision_requested: number;
  approved: number;
  window: ProjectWindowState;
}

export interface ProjectRoundDetailRow {
  key: string;
  kind: "member" | "team";
  display_name: string;
  secondary: string;
  member_names: string[];
  state: DisplayState;
  late: boolean;
  submission: Submission | null;
}

export interface ProjectRoundOverview {
  summaries: ProjectRoundSummary[];
  detailsByAssignment: Record<string, ProjectRoundDetailRow[]>;
  unassignedByAssignment: Record<string, Profile[]>;
}

export function computeProjectRoundOverview(input: {
  semester: string;
  profiles: Profile[];
  memberships: SemesterMembership[];
  assignments: Assignment[];
  teams: Team[];
  teamMembers: TeamMember[];
  submissions: Submission[];
  now?: Date;
}): ProjectRoundOverview {
  const now = input.now ?? new Date();
  const membershipByProfile = new Map(
    input.memberships.filter((membership) => membership.semester === input.semester).map((membership) => [membership.profile_id, membership]),
  );
  const activeMembers = input.profiles.filter((profile) => {
    const membership = membershipByProfile.get(profile.id);
    return profile.active && profile.role === "member" && membership?.active === true;
  });
  const currentTeams = input.teams.filter((team) => team.semester === input.semester);
  const teamById = new Map(currentTeams.map((team) => [team.id, team]));
  const teamLinkByProfile = new Map<string, TeamMember>();
  for (const link of input.teamMembers.filter((link) => link.semester === input.semester)) {
    if (teamLinkByProfile.has(link.profile_id)) throw new Error("한 회원에게 여러 팀이 연결되어 있습니다.");
    if (!teamById.has(link.team_id)) throw new Error("팀원 정보가 존재하지 않는 팀을 가리키고 있습니다.");
    teamLinkByProfile.set(link.profile_id, link);
  }
  const assignments = input.assignments
    .filter((assignment) => assignment.semester === input.semester && assignment.active && assignment.opens_at && assignment.due_at)
    .sort((a, b) => new Date(a.opens_at!).valueOf() - new Date(b.opens_at!).valueOf());

  const summaries: ProjectRoundSummary[] = [];
  const detailsByAssignment: Record<string, ProjectRoundDetailRow[]> = {};
  const unassignedByAssignment: Record<string, Profile[]> = {};

  for (const assignment of assignments) {
    const rows: ProjectRoundDetailRow[] = [];
    const unassigned: Profile[] = [];
    if (assignment.project_type === "individual") {
      for (const profile of activeMembers) {
        const membership = membershipByProfile.get(profile.id)!;
        if (!membership.individual_required) continue;
        const matches = input.submissions.filter((submission) =>
          submission.assignment_id === assignment.id && submission.owner_id === profile.id && submission.team_id === null,
        );
        if (matches.length > 1) throw new Error("개인 프로젝트 제출 기록이 중복되어 있습니다.");
        const submission = matches[0] ?? null;
        rows.push({
          key: `member:${profile.id}`,
          kind: "member",
          display_name: profile.name,
          secondary: profile.member_id,
          member_names: [profile.name],
          state: submission?.status ?? "not_submitted",
          late: submission ? isLateSubmission(submission, assignment) : false,
          submission,
        });
      }
    } else {
      const requiredMembers = activeMembers.filter((profile) => membershipByProfile.get(profile.id)?.team_required === true);
      const requiredIds = new Set(requiredMembers.map((profile) => profile.id));
      for (const profile of requiredMembers) {
        if (!teamLinkByProfile.has(profile.id)) unassigned.push(profile);
      }
      for (const team of currentTeams) {
        const teamProfiles = input.teamMembers
          .filter((link) => link.semester === input.semester && link.team_id === team.id && requiredIds.has(link.profile_id))
          .map((link) => activeMembers.find((profile) => profile.id === link.profile_id))
          .filter((profile): profile is Profile => Boolean(profile));
        if (teamProfiles.length === 0) continue;
        const matches = input.submissions.filter((submission) =>
          submission.assignment_id === assignment.id && submission.team_id === team.id && submission.owner_id === null,
        );
        if (matches.length > 1) throw new Error("팀 프로젝트 제출 기록이 중복되어 있습니다.");
        const submission = matches[0] ?? null;
        rows.push({
          key: `team:${team.id}`,
          kind: "team",
          display_name: team.name,
          secondary: `${teamProfiles.length}명`,
          member_names: teamProfiles.map((profile) => profile.name),
          state: submission?.status ?? "not_submitted",
          late: submission ? isLateSubmission(submission, assignment) : false,
          submission,
        });
      }
    }
    detailsByAssignment[assignment.id] = rows;
    unassignedByAssignment[assignment.id] = unassigned;
    summaries.push({
      assignment,
      total_expected: rows.length,
      submitted: rows.filter((row) => row.submission !== null).length,
      late: rows.filter((row) => row.late).length,
      revision_requested: rows.filter((row) => row.state === "revision_requested").length,
      approved: rows.filter((row) => row.state === "approved").length,
      window: projectWindowState(assignment, now),
    });
  }

  return { summaries, detailsByAssignment, unassignedByAssignment };
}

export function calendarDateForScheduleItem(item: Pick<ScheduleItem, "source" | "start_at" | "end_at">): string {
  return item.source === "assignment" ? item.end_at ?? item.start_at : item.start_at;
}

export function mergeScheduleItems(input: { assignments: Assignment[]; events: ScheduleEvent[] }): ScheduleItem[] {
  const projectItems: ScheduleItem[] = input.assignments
    .filter((assignment) => assignment.active && assignment.opens_at && assignment.due_at)
    .map((assignment) => ({
      id: `assignment:${assignment.id}`, source: "assignment" as const, title: assignment.title,
      category: "project" as const, project_type: assignment.project_type, description: assignment.description,
      start_at: assignment.opens_at!, end_at: assignment.due_at, link_url: null,
      all_day: assignment.all_day,
      schedule_series_id: assignment.schedule_series_id ?? null,
      occurrence_index: assignment.occurrence_index ?? null,
    }));
  const eventItems: ScheduleItem[] = input.events.map((event) => ({ ...event, source: "event" as const, project_type: null }));
  return [...projectItems, ...eventItems].sort((a, b) => new Date(a.start_at).valueOf() - new Date(b.start_at).valueOf());
}

export interface EventDraft {
  title: string;
  category: EventCategory;
  description: string;
  start_at: string;
  end_at: string | null;
  link_url: string | null;
  all_day: boolean;
}
export function validateEventDraft(draft: EventDraft): { ok: true } | { ok: false; message: string } {
  if (draft.title.trim().length < 1 || draft.title.trim().length > 160) return { ok: false, message: "일정 제목은 1~160자로 입력해 주세요." };
  if (!["project", "seminar", "ctf", "meeting", "presentation", "other"].includes(draft.category)) return { ok: false, message: "일정 분류를 확인해 주세요." };
  if (draft.description.length > 4000) return { ok: false, message: "일정 설명은 4000자 이하로 입력해 주세요." };
  const start = new Date(draft.start_at);
  if (!Number.isFinite(start.valueOf())) return { ok: false, message: "시작 시간을 확인해 주세요." };
  if (draft.end_at) {
    const end = new Date(draft.end_at);
    if (!Number.isFinite(end.valueOf()) || end.valueOf() < start.valueOf()) return { ok: false, message: "종료 시간은 시작 시간 이후여야 합니다." };
  }
  if (draft.link_url) {
    try {
      const url = new URL(draft.link_url);
      if (!["http:", "https:"].includes(url.protocol)) return { ok: false, message: "일정 링크는 http/https 주소만 사용할 수 있습니다." };
    } catch { return { ok: false, message: "일정 링크 형식을 확인해 주세요." }; }
  }
  return { ok: true };
}

export interface ProjectDbArchiveRecord {
  schema_version: 1;
  submission_id: string;
  semester: string;
  project_type: ProjectType;
  title: string;
  summary: string;
  team_name: string | null;
  member_count: number;
  code_repository_url: string | null;
  report: { repository_url: string; path: string; ref: string };
  approved_at: string;
}
export function buildProjectDbRecord(input: { submission: Submission; members: Profile[]; teamName: string | null; approvedAt: string }): ProjectDbArchiveRecord {
  const { submission } = input;
  if (!submission.report_repository_url || !submission.report_path || !submission.submitted_ref) {
    throw new Error("ProjectDB에 게시된 보고서 정보가 없습니다.");
  }
  return {
    schema_version: 1,
    submission_id: submission.id,
    semester: submission.semester,
    project_type: submission.project_type,
    title: submission.title,
    summary: submission.summary,
    team_name: input.teamName,
    member_count: input.members.length,
    code_repository_url: submission.code_repository_url,
    report: { repository_url: submission.report_repository_url, path: submission.report_path, ref: submission.submitted_ref },
    approved_at: input.approvedAt,
  };
}

export function formatDeadline(value: string | null): string {
  if (!value) return "마감 미정";
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return "마감 확인 필요";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}

export type BrowserConfig = { ok: true; url: string; key: string } | { ok: false; message: string };
export function parseBrowserConfig(urlValue: string | undefined, keyValue: string | undefined): BrowserConfig {
  const message = "Member 연결 설정이 필요합니다. 운영진에게 문의해 주세요.";
  const key = keyValue?.trim() ?? "";
  try {
    const url = new URL(urlValue?.trim() ?? "");
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && local)) || url.username || url.password || url.search || url.hash || !key) {
      return { ok: false, message };
    }
    let isPublicKey = /^sb_publishable_[a-zA-Z0-9_-]{8,}$/.test(key);
    // This is only a configuration sanity check, not JWT authentication.
    if (!isPublicKey && key.split(".").length === 3) {
      const encoded = key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const payload: unknown = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=")));
      isPublicKey = typeof payload === "object" && payload !== null && "role" in payload && payload.role === "anon";
    }
    if (!isPublicKey) return { ok: false, message };
    return { ok: true, url: url.toString().replace(/\/$/, ""), key };
  } catch {
    return { ok: false, message };
  }
}
