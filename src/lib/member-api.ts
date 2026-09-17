import type { SupabaseClient } from "@supabase/supabase-js";
import type { SpreadsheetMemberRow } from "./member-spreadsheet";
import type { SubmissionDraft } from "./submission-upload";
import {
  buildDashboardItems,
  computeMemberProjectProgress,
  computeProjectRoundOverview,
  hasActiveMembership,
  isActiveStaff,
  mergeScheduleItems,
  requireQueryData,
  type Assignment,
  type DashboardItem,
  type EventDraft,
  type MemberProjectProgressRow,
  type Profile,
  type ProjectRoundOverview,
  type ProjectType,
  type ScheduleEvent,
  type ScheduleItem,
  type Semester,
  type SemesterMembership,
  type Submission,
  type Team,
  type TeamMember,
} from "./member-domain";

const PROFILE_FIELDS = "id,member_id,name,role,active,github_username,version";
const ASSIGNMENT_FIELDS = "id,semester,project_type,title,description,opens_at,due_at,round_key,active,version";
const SUBMISSION_FIELDS = "id,assignment_id,semester,project_type,owner_id,team_id,title,summary,code_repository_url,report_filename,report_markdown,report_bytes,report_repository_url,report_path,submitted_ref,status,review_note,first_submitted_at,submitted_at,projectdb_sync_status,projectdb_sync_error,projectdb_synced_at,version";

export async function readOwnProfile(client: SupabaseClient, id: string): Promise<Profile> {
  const result = await client.from("profiles").select(PROFILE_FIELDS).eq("id", id).single<Profile>();
  return requireQueryData(result, "회원 정보");
}

export async function readCurrentSemester(client: SupabaseClient): Promise<Semester | null> {
  const result = await client.from("semesters").select("id,title,active,is_current")
    .eq("is_current", true).eq("active", true).maybeSingle<Semester>();
  if (result.error) throw new Error("현재 학기를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
  return result.data;
}

export interface MemberDashboard {
  semester: Semester | null;
  membership: SemesterMembership | null;
  items: DashboardItem[];
  team: TeamContext | null;
}

export async function readMemberDashboard(client: SupabaseClient, profile: Profile): Promise<MemberDashboard> {
  const semester = await readCurrentSemester(client);
  if (!semester) return { semester: null, membership: null, items: [], team: null };
  const enrollment = await client.from("semester_memberships")
    .select("profile_id,semester,active,individual_required,team_required")
    .eq("profile_id", profile.id).eq("semester", semester.id).maybeSingle<SemesterMembership>();
  if (enrollment.error) throw new Error("학기별 활동 정보를 불러오지 못했습니다.");
  const membership = enrollment.data;
  if (!hasActiveMembership(profile, membership, semester.id)) return { semester, membership, items: [], team: null };

  const [assignmentResult, team] = await Promise.all([
    client.from("assignments").select(ASSIGNMENT_FIELDS)
      .eq("semester", semester.id).eq("active", true).order("opens_at").returns<Assignment[]>(),
    readTeamContext(client, profile, semester.id),
  ]);
  const assignments = requireQueryData(assignmentResult, "제출 항목");
  if (assignments.length === 0) return { semester, membership, items: [], team };
  const result = await client.from("submissions")
    .select(SUBMISSION_FIELDS)
    .in("assignment_id", assignments.map((assignment) => assignment.id)).returns<Submission[]>();
  const submissions = requireQueryData(result, "제출 현황");
  return {
    semester, membership, team,
    items: buildDashboardItems({ profile, membership, semester: semester.id, assignments, submissions, teamIds: team.team ? [team.team.id] : [] }),
  };
}

export interface RosterRecord {
  profile: Profile;
  membership: SemesterMembership;
}
export interface SemesterRoster {
  semester: Semester | null;
  rows: RosterRecord[];
}
interface RosterSnapshotRow {
  profile_id: string;
  member_id: string;
  name: string;
  role: Profile["role"];
  account_active: boolean;
  github_username: string | null;
  profile_version: number;
  membership_active: boolean;
  individual_required: boolean;
  team_required: boolean;
}
async function readRosterSnapshot(client: SupabaseClient, semester: string): Promise<RosterRecord[]> {
  const result = await client.rpc("list_semester_roster", { target_semester: semester });
  const rows = requireQueryData(result, "회원 명단") as RosterSnapshotRow[];
  return rows.map((row) => ({
    profile: {
      id: row.profile_id,
      member_id: row.member_id,
      name: row.name,
      role: row.role,
      active: row.account_active,
      github_username: row.github_username,
      version: row.profile_version,
    },
    membership: {
      profile_id: row.profile_id,
      semester,
      active: row.membership_active,
      individual_required: row.individual_required,
      team_required: row.team_required,
    },
  }));
}

export async function readSemesterRoster(client: SupabaseClient, profile: Profile): Promise<SemesterRoster> {
  if (!isActiveStaff(profile)) throw new Error("운영진만 회원 명단을 볼 수 있습니다.");
  const semester = await readCurrentSemester(client);
  if (!semester) return { semester: null, rows: [] };
  return { semester, rows: await readRosterSnapshot(client, semester.id) };
}

export type ResourceService = "notion" | "google_drive" | "google_docs" | "google_sheets" | "google_forms" | "github" | "discord" | "other";
export type ResourceCategory = "study" | "project" | "ctf" | "recruitment" | "operations" | "other";
export type ResourceAudience = "member" | "staff";

export interface ResourceLink {
  id: string;
  semester: string;
  title: string;
  description: string;
  url: string;
  service: ResourceService;
  category: ResourceCategory;
  audience: ResourceAudience;
  sort_order: number;
  active: boolean;
  version: number;
  updated_at: string;
}

export interface ResourceLinkDraft {
  title: string;
  description: string;
  url: string;
  service: ResourceService;
  category: ResourceCategory;
  audience: ResourceAudience;
}

export interface StaffResourceAdminSnapshot {
  semester: Semester | null;
  links: ResourceLink[];
}

export interface StaffPrivateSettings {
  staff_memo: string;
  version: number;
  updated_at: string;
}

export interface StaffSharedSecret {
  id: string;
  label: string;
  account_identifier: string;
  login_url: string | null;
  active: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface StaffSharedSecretAudit {
  id: number;
  secret_id: string;
  actor_name: string | null;
  actor_member_id: string | null;
  action: "created" | "updated" | "revealed" | "deactivated" | "reactivated";
  created_at: string;
}

export interface StaffSharedSecretDraft {
  label: string;
  account_identifier: string;
  login_url: string | null;
  secret: string;
}

const RESOURCE_LINK_FIELDS = "id,semester,title,description,url,service,category,audience,sort_order,active,version,updated_at";

export async function readStaffResourceAdmin(client: SupabaseClient, profile: Profile): Promise<StaffResourceAdminSnapshot> {
  if (!isActiveStaff(profile)) throw new Error("운영진만 자료 링크를 관리할 수 있습니다.");
  const semester = await readCurrentSemester(client);
  if (!semester) return { semester: null, links: [] };
  const linksResult = await client.from("resource_links")
    .select(RESOURCE_LINK_FIELDS).eq("semester", semester.id)
    .order("active", { ascending: false }).order("sort_order").order("title").returns<ResourceLink[]>();
  return { semester, links: requireQueryData(linksResult, "자료 링크") };
}

export async function readStaffPrivateSettings(client: SupabaseClient, profile: Profile): Promise<StaffPrivateSettings> {
  if (!isActiveStaff(profile)) throw new Error("운영진만 운영진 메모를 볼 수 있습니다.");
  const result = await client.from("staff_private_settings")
    .select("staff_memo,version,updated_at").eq("id", true).single<StaffPrivateSettings>();
  return requireQueryData(result, "운영진 메모");
}

export async function readMemberResources(client: SupabaseClient, profile: Profile): Promise<{ semester: Semester | null; links: ResourceLink[] }> {
  const semester = await readCurrentSemester(client);
  if (!semester) return { semester: null, links: [] };
  if (!isActiveStaff(profile)) {
    const membershipResult = await client.from("semester_memberships")
      .select("profile_id,semester,active,individual_required,team_required")
      .eq("profile_id", profile.id).eq("semester", semester.id).maybeSingle<SemesterMembership>();
    if (membershipResult.error) throw new Error("학기별 활동 정보를 불러오지 못했습니다.");
    if (!hasActiveMembership(profile, membershipResult.data, semester.id)) return { semester, links: [] };
  }
  const linksResult = await client.from("resource_links")
    .select(RESOURCE_LINK_FIELDS).eq("semester", semester.id).eq("active", true).eq("audience", "member")
    .order("sort_order").order("title").returns<ResourceLink[]>();
  return { semester, links: requireQueryData(linksResult, "자료실") };
}

export interface TeamCandidate { profile_id: string; member_id: string; name: string }
export interface TeamContext {
  team: Team | null;
  members: TeamCandidate[];
}
interface OwnTeamRow extends TeamCandidate {
  team_id: string;
  team_name: string;
  team_version: number;
}
export async function readTeamContext(client: SupabaseClient, profile: Profile, semester: string): Promise<TeamContext> {
  if (!profile.active) return { team: null, members: [] };
  const result = await client.rpc("list_own_team_members", { target_semester: semester });
  const rows = requireQueryData(result, "팀 정보") as OwnTeamRow[];
  if (rows.length === 0) return { team: null, members: [] };
  const first = rows[0];
  if (rows.some((row) => row.team_id !== first.team_id)) throw new Error("팀 정보가 중복되어 있습니다. 운영진에게 확인해 주세요.");
  return {
    team: { id: first.team_id, semester, name: first.team_name, version: first.team_version },
    members: rows.map(({ profile_id, member_id, name }) => ({ profile_id, member_id, name })),
  };
}

export interface TeamAdminSnapshot {
  semester: Semester | null;
  teams: Team[];
  members: RosterRecord[];
  teamMembers: TeamMember[];
}

export type TeamAdminBody =
  | { action: "create_team"; name: string }
  | { action: "rename_team"; team_id: string; expected_version: number; name: string }
  | { action: "assign_member"; team_id: string; profile_id: string; expected_team_id: string | null }
  | { action: "remove_member"; team_id: string; profile_id: string; expected_team_id: string }
  | { action: "delete_team"; team_id: string; expected_version: number };

export async function readTeamAdminSnapshot(client: SupabaseClient, profile: Profile): Promise<TeamAdminSnapshot> {
  if (!isActiveStaff(profile)) throw new Error("운영진만 팀을 관리할 수 있습니다.");
  const semester = await readCurrentSemester(client);
  if (!semester) return { semester: null, teams: [], members: [], teamMembers: [] };
  const [members, teamsResult, teamMembersResult] = await Promise.all([
    readRosterSnapshot(client, semester.id),
    client.from("teams").select("id,semester,name,version").eq("semester", semester.id).order("name").returns<Team[]>(),
    client.from("team_members").select("team_id,profile_id,semester").eq("semester", semester.id).returns<TeamMember[]>(),
  ]);
  return {
    semester,
    members,
    teams: requireQueryData(teamsResult, "팀 정보"),
    teamMembers: requireQueryData(teamMembersResult, "팀원 정보"),
  };
}

async function invokePortal<T>(client: SupabaseClient, functionName: string, body: object): Promise<T> {
  const { data, error } = await client.functions.invoke(functionName, { body });
  if (error) throw new Error(error.message || "서버 작업을 완료하지 못했습니다.");
  if (data && typeof data === "object" && "error" in data && typeof data.error === "string") throw new Error(data.error);
  return data as T;
}

export async function saveSubmission(client: SupabaseClient, input: SubmissionDraft & {
  assignment_id: string;
  expected_version?: number;
}) {
  return invokePortal<{ ok: true; submission: { id: string; status: string; version: number }; team_id: string | null }>(client, "submission-write", input);
}

export async function manageTeam(client: SupabaseClient, body: TeamAdminBody) {
  return invokePortal<{ ok: true; team_id?: string | null; team?: Team }>(client, "team-admin", body);
}

export async function manageMember(client: SupabaseClient, body: Record<string, unknown>) {
  return invokePortal<{ ok: true; member_id: string; temporary_password?: string }>(client, "member-admin", body);
}

export async function saveStaffPrivateSettings(client: SupabaseClient, draft: { staff_memo: string; expected_version: number }) {
  return invokePortal<{ ok: true; settings: StaffPrivateSettings }>(client, "operations-settings", { action: "save_staff_memo", ...draft });
}

export async function listStaffSharedSecrets(client: SupabaseClient) {
  return invokePortal<{ ok: true; secrets: StaffSharedSecret[] }>(client, "staff-secrets", { action: "list" });
}

export async function createStaffSharedSecret(client: SupabaseClient, draft: StaffSharedSecretDraft) {
  return invokePortal<{ ok: true; secret: StaffSharedSecret }>(client, "staff-secrets", { action: "create", ...draft });
}

export async function updateStaffSharedSecret(client: SupabaseClient, draft: StaffSharedSecretDraft & { secret_id: string; expected_version: number }) {
  return invokePortal<{ ok: true; secret: StaffSharedSecret }>(client, "staff-secrets", { action: "update", ...draft });
}

export async function revealStaffSharedSecret(client: SupabaseClient, secretId: string) {
  return invokePortal<{ ok: true; secret_id: string; secret: string }>(client, "staff-secrets", { action: "reveal", secret_id: secretId });
}

export async function setStaffSharedSecretActive(client: SupabaseClient, draft: { secret_id: string; expected_version: number; active: boolean }) {
  return invokePortal<{ ok: true; secret: StaffSharedSecret }>(client, "staff-secrets", {
    action: draft.active ? "reactivate" : "deactivate",
    secret_id: draft.secret_id,
    expected_version: draft.expected_version,
  });
}

export async function listStaffSharedSecretAudit(client: SupabaseClient) {
  return invokePortal<{ ok: true; audits: StaffSharedSecretAudit[] }>(client, "staff-secrets", { action: "list_audit" });
}

export async function createResourceLink(client: SupabaseClient, draft: ResourceLinkDraft) {
  return invokePortal<{ ok: true; link: ResourceLink }>(client, "operations-settings", { action: "create_link", ...draft });
}

export async function updateResourceLink(client: SupabaseClient, draft: ResourceLinkDraft & { resource_id: string; expected_version: number }) {
  return invokePortal<{ ok: true; link: ResourceLink }>(client, "operations-settings", { action: "update_link", ...draft });
}

export async function deactivateResourceLink(client: SupabaseClient, draft: { resource_id: string; expected_version: number }) {
  return invokePortal<{ ok: true; link: ResourceLink }>(client, "operations-settings", { action: "deactivate_link", ...draft });
}

export async function reorderResourceLinks(client: SupabaseClient, resourceIds: string[]) {
  return invokePortal<{ ok: true; links: ResourceLink[] }>(client, "operations-settings", { action: "reorder_links", resource_ids: resourceIds });
}

export async function resetMemberPassword(client: SupabaseClient, memberId: string) {
  return invokePortal<{ ok: true; member_id: string; temporary_password: string }>(client, "member-admin", {
    action: "reset_password",
    member_id: memberId,
  });
}

export interface BulkMemberResult {
  row_id: string;
  member_id: string;
  ok: boolean;
  version?: number;
  created?: boolean;
  error?: string;
}

export interface GeneratedCredential {
  member_id: string;
  temporary_password: string;
}

export interface BulkMemberResponse {
  ok: true;
  results: BulkMemberResult[];
  credentials: GeneratedCredential[];
}

export async function applyMemberBatch(client: SupabaseClient, rows: SpreadsheetMemberRow[]): Promise<BulkMemberResponse> {
  return invokePortal<BulkMemberResponse>(client, "member-bulk", { action: "apply", rows });
}

export async function reviewSubmission(client: SupabaseClient, body: {
  action: "review" | "retry_projectdb_sync";
  submission_id: string;
  expected_version: number;
  status?: "revision_requested" | "approved";
  review_note?: string | null;
}) {
  return invokePortal<{ ok: true; status?: string; projectdb_sync_status?: string; projectdb_sync_error?: string }>(client, "submission-admin", body);
}

export interface SubmissionOverview {
  semester: Semester | null;
  overview: ProjectRoundOverview;
  memberProgress: MemberProjectProgressRow[];
}
export async function readSubmissionOverview(client: SupabaseClient, profile: Profile): Promise<SubmissionOverview> {
  if (!isActiveStaff(profile)) throw new Error("운영진만 프로젝트 현황을 볼 수 있습니다.");
  const semester = await readCurrentSemester(client);
  if (!semester) return { semester: null, overview: { summaries: [], detailsByAssignment: {}, unassignedByAssignment: {} }, memberProgress: [] };
  const rosterRows = await readRosterSnapshot(client, semester.id);
  const profiles = rosterRows.map((row) => row.profile);
  const memberships = rosterRows.map((row) => row.membership);
  const [assignmentsResult, teamsResult, teamMembersResult, submissionsResult] = await Promise.all([
    client.from("assignments").select(ASSIGNMENT_FIELDS).eq("semester", semester.id).eq("active", true).order("opens_at").returns<Assignment[]>(),
    client.from("teams").select("id,semester,name,version").eq("semester", semester.id).returns<Team[]>(),
    client.from("team_members").select("team_id,profile_id,semester").eq("semester", semester.id).returns<TeamMember[]>(),
    client.from("submissions").select(SUBMISSION_FIELDS).eq("semester", semester.id).returns<Submission[]>(),
  ]);
  const assignments = requireQueryData(assignmentsResult, "프로젝트 회차");
  const teams = requireQueryData(teamsResult, "팀 정보");
  const teamMembers = requireQueryData(teamMembersResult, "팀원 정보");
  const submissions = requireQueryData(submissionsResult, "제출 현황");
  const shared = { semester: semester.id, profiles, memberships, assignments, teams, teamMembers, submissions };
  return {
    semester,
    overview: computeProjectRoundOverview(shared),
    memberProgress: computeMemberProjectProgress(shared),
  };
}

export interface AssignmentDraft {
  project_type: ProjectType;
  title: string;
  description: string;
  opens_at: string;
  due_at: string;
}

export interface AssignmentSeriesDraft {
  first_type: ProjectType;
  title_prefix: string;
  description: string;
  first_opens_at: string;
  first_due_at: string;
  interval_weeks: number;
  count: number;
}

export async function saveAssignment(client: SupabaseClient, draft: AssignmentDraft, assignment?: Assignment) {
  return assignment
    ? invokePortal<{ ok: true; assignment: { id: string; version: number } }>(client, "assignment-admin", {
        action: "update", assignment_id: assignment.id, expected_version: assignment.version,
        title: draft.title, description: draft.description, opens_at: draft.opens_at, due_at: draft.due_at,
      })
    : invokePortal<{ ok: true; assignment: { assignment_id: string; round_key: string; assignment_version: number } }>(client, "assignment-admin", {
        action: "create", ...draft,
      });
}

export async function saveAssignmentSeries(client: SupabaseClient, draft: AssignmentSeriesDraft) {
  return invokePortal<{ ok: true; assignments: Array<{ assignment_id: string; round_key: string; project_type: ProjectType; assignment_version: number }> }>(client, "assignment-admin", {
    action: "create_series", ...draft,
  });
}

export async function deactivateAssignment(client: SupabaseClient, assignment: Assignment) {
  return invokePortal<{ ok: true; assignment: { id: string; version: number } }>(client, "assignment-admin", {
    action: "deactivate", assignment_id: assignment.id, expected_version: assignment.version,
  });
}

export interface ScheduleData {
  semester: Semester | null;
  assignments: Assignment[];
  events: ScheduleEvent[];
  items: ScheduleItem[];
}
export async function readSchedule(client: SupabaseClient): Promise<ScheduleData> {
  const semester = await readCurrentSemester(client);
  if (!semester) return { semester: null, assignments: [], events: [], items: [] };
  const [assignmentsResult, eventsResult] = await Promise.all([
    client.from("assignments").select(ASSIGNMENT_FIELDS)
      .eq("semester", semester.id).eq("active", true).order("opens_at").returns<Assignment[]>(),
    client.from("events").select("id,semester,title,category,description,start_at,end_at,link_url,version")
      .eq("semester", semester.id).order("start_at").returns<ScheduleEvent[]>(),
  ]);
  const assignments = requireQueryData(assignmentsResult, "프로젝트 마감");
  const events = requireQueryData(eventsResult, "일정");
  return { semester, assignments, events, items: mergeScheduleItems({ assignments, events }) };
}

export async function saveEvent(client: SupabaseClient, profile: Profile, semester: string, draft: EventDraft, event?: ScheduleEvent) {
  if (!isActiveStaff(profile)) throw new Error("운영진만 일정을 수정할 수 있습니다.");
  if (event) {
    const result = await client.from("events")
      .update({ ...draft, updated_at: new Date().toISOString(), version: event.version + 1 })
      .eq("id", event.id).eq("version", event.version).select("id,version").maybeSingle<{ id: string; version: number }>();
    if (result.error) throw new Error("일정을 저장하지 못했습니다.");
    if (!result.data) throw new Error("일정이 다른 운영진에 의해 변경되었습니다. 새로고침 후 다시 수정해 주세요.");
    return result.data;
  }
  const result = await client.from("events").insert({ ...draft, semester, created_by: profile.id }).select("id,version").single<{ id: string; version: number }>();
  return requireQueryData(result, "일정 저장");
}

export async function deleteEvent(client: SupabaseClient, profile: Profile, event: ScheduleEvent) {
  if (!isActiveStaff(profile)) throw new Error("운영진만 일정을 삭제할 수 있습니다.");
  const result = await client.from("events").delete().eq("id", event.id).eq("version", event.version).select("id").maybeSingle<{ id: string }>();
  if (result.error) throw new Error("일정을 삭제하지 못했습니다.");
  if (!result.data) throw new Error("일정이 다른 운영진에 의해 변경되었습니다. 새로고침 후 다시 확인해 주세요.");
  return result.data;
}
