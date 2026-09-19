import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const root = new URL('../', import.meta.url);
const read = (path) => existsSync(new URL(path, root)) ? readFileSync(new URL(path, root), 'utf8') : '';

test('static member routes and a setup guide exist', () => {
  for (const path of [
    'src/app/member/layout.tsx', 'src/app/member/page.tsx', 'src/app/member/login/page.tsx',
    'src/app/member/password/page.tsx', 'src/app/member/submission/page.tsx',
    'src/app/member/schedule/page.tsx', 'src/app/member/resources/page.tsx', 'src/app/member/operations/members/page.tsx',
    'src/app/member/operations/progress/page.tsx', 'src/app/member/operations/submissions/page.tsx', 'src/app/member/operations/teams/page.tsx',
    'src/app/member/operations/settings/page.tsx', 'docs/member-portal-setup.md',
  ]) {
    assert.ok(read(path).length > 100, `${path} must contain an implementation`);
  }
});

test('privileged portal writes are implemented in edge functions', () => {
  for (const path of [
    'supabase/functions/member-admin/index.ts',
    'supabase/functions/submission-write/index.ts',
    'supabase/functions/submission-admin/index.ts',
    'supabase/functions/team-admin/index.ts',
    'supabase/functions/assignment-admin/index.ts',
    'supabase/functions/operations-settings/index.ts',
    'supabase/functions/staff-secrets/index.ts',
  ]) {
    const text = read(path);
    assert.ok(text.length > 500, `${path} must contain server logic`);
    assert.match(text, /require(User|Staff)/, path);
  }
  assert.match(read('supabase/functions/submission-admin/index.ts'), /PROJECTDB_TOKEN/);
  assert.match(read('supabase/functions/submission-admin/index.ts'), /projectdb_sync_status/);
});

test('public export configuration remains static and desktop/mobile Member links exist', () => {
  assert.match(read('next.config.ts'), /output:\s*["']export["']/);
  assert.equal((read('src/app/header.tsx').match(/href=\{?["']\/member["']/g) || []).length, 2);
});

test('migration declares RLS and does not grant browser mutations (static contract, NOT live RLS proof)', () => {
  const sql = read('supabase/migrations/202609150001_member_portal.sql');
  for (const table of ['profiles', 'semesters', 'semester_memberships', 'teams', 'team_members', 'assignments', 'submissions']) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'), table);
  }
  assert.doesNotMatch(sql, /grant\s+(all|insert|update|delete)[^;]*to\s+(anon|authenticated)/i);
  assert.match(sql, /set search_path\s*=\s*''/i);
  assert.match(sql, /revoke all on all functions in schema private from public/i);
  assert.match(sql, /individual_required/);
  assert.match(sql, /team_required/);
});

test('operations migration protects events and exposes only a minimal team-candidate RPC', () => {
  const sql = read('supabase/migrations/202609150002_operations.sql');
  assert.match(sql, /alter table public\.events enable row level security/i);
  assert.match(sql, /events_insert_staff[\s\S]*private\.is_active_staff/i);
  assert.match(sql, /events_update_staff[\s\S]*private\.is_active_staff/i);
  assert.match(sql, /events_delete_staff[\s\S]*private\.is_active_staff/i);
  assert.match(sql, /returns table\(profile_id uuid, member_id text, name text\)/i);
  assert.match(sql, /join public\.semesters[\s\S]*active/i, 'team candidate RPC must honor semester activation');
  assert.doesNotMatch(sql, /returns table\([^)]*(github|role|active)/i);
});

test('submission writes use fixed staff-managed teams and optimistic versions', () => {
  const migration = read('supabase/migrations/202609150007_operations_redesign.sql');
  assert.match(migration, /create or replace function public\.move_team_member_atomic/i);
  assert.match(migration, /create or replace function public\.list_own_team_members/i);
  const write = read('supabase/functions/submission-write/index.ts');
  assert.doesNotMatch(write, /create_team_submission_atomic/);
  assert.doesNotMatch(write, /team_member_ids|team_name/);
  assert.match(write, /team_members/);
  assert.match(write, /팀 미배정/);
  assert.match(write, /opens_at/);
  assert.match(write, /first_submitted_at/);
  assert.match(write, /expected_version/);
  assert.match(write, /\.eq\(["']version["']/);
  const teamAdmin = read('supabase/functions/team-admin/index.ts');
  assert.match(teamAdmin, /requireStaff\(req\)/);
  assert.match(teamAdmin, /move_team_member_atomic/);
  assert.match(read('supabase/config.toml'), /\[functions\.team-admin\]/);
  const admin = read('supabase/functions/submission-admin/index.ts');
  assert.match(admin, /expected_version/);
  assert.match(admin, /\.eq\(["']version["']/);
  assert.match(admin, /portal-index\/\$\{submission\.semester\}\/\$\{submission\.project_type\}\/\$\{submission\.id\}\/v\$\{submission\.version\}\.json/);
});

test('markdown submission migration stores draft text without object storage', () => {
  const migration = read('supabase/migrations/202609160011_markdown_submission.sql');
  assert.match(migration, /add column if not exists report_filename text/i);
  assert.match(migration, /add column if not exists report_markdown text/i);
  assert.match(migration, /add column if not exists report_bytes integer/i);
  assert.match(migration, /alter column report_repository_url drop not null/i);
  assert.match(migration, /alter column report_path drop not null/i);
  assert.match(migration, /alter column submitted_ref drop not null/i);
  assert.match(migration, /octet_length\(report_markdown\).*262144/is);
  const helper = read('src/lib/submission-upload.ts');
  assert.match(helper, /validateMarkdownUpload/);
  assert.match(helper, /262_?144/);
  assert.match(helper, /\.md/);
  assert.match(helper, /frontmatter|---/i);
  assert.doesNotMatch(helper, /storage\.from|supabase\.storage/i);
});

test('submission approval publishes markdown reports to ProjectDB while preserving legacy archive sync', () => {
  const admin = read('supabase/functions/submission-admin/index.ts');
  assert.match(admin, /buildProjectDbReport/);
  assert.match(admin, /report_markdown/);
  assert.match(admin, /report_filename/);
  assert.match(admin, /assignments/);
  assert.match(admin, /team_members/);
  assert.match(admin, /profiles/);
  assert.match(admin, /contents\/\$\{encodedPath\}/);
  assert.match(admin, /commit\.sha|commitSha/);
  assert.match(admin, /report_repository_url/);
  assert.match(admin, /report_path/);
  assert.match(admin, /submitted_ref/);
  assert.match(admin, /portal-index\/\$\{submission\.semester\}/, 'legacy sidecar sync remains available');
});

test('active-staff guard serializes staff-count changes through a private singleton row', () => {
  const sql = read('supabase/migrations/202609150003_staff_guard.sql');
  assert.match(sql, /create table if not exists private\.staff_guard/i);
  assert.match(sql, /update private\.staff_guard[\s\S]*active_staff_count = active_staff_count \+ delta/i);
  assert.match(sql, /next_count < 1/i);
});

test('member management uses optimistic profile versions and atomic profile/membership update', () => {
  const migration = read('supabase/migrations/202609150005_final_concurrency.sql');
  assert.match(migration, /alter table public\.profiles[\s\S]*add column if not exists version bigint/i);
  assert.match(migration, /create or replace function public\.update_member_admin_atomic/i);
  const source = read('supabase/functions/member-admin/index.ts');
  assert.match(source, /expected_version/);
  assert.match(source, /update_member_admin_atomic/);
  const sheet = read('src/component/member/MemberSpreadsheet.tsx');
  assert.match(sheet, /expected_version:\s*record\.profile\.version/);
  assert.match(sheet, /applyMemberBatch/);
});

test('member spreadsheet exposes a staff-only one-time password reset action', () => {
  const shared = read('supabase/functions/_shared/security.ts');
  assert.match(shared, /export function generateTemporaryPassword/);
  assert.match(shared, /crypto\.getRandomValues/);

  const bulk = read('supabase/functions/member-bulk/index.ts');
  assert.match(bulk, /generateTemporaryPassword/);

  const admin = read('supabase/functions/member-admin/index.ts');
  assert.match(admin, /action === ["']reset_password["']/);
  assert.match(admin, /generateTemporaryPassword/);
  assert.match(admin, /temporary_password:\s*password/);

  const api = read('src/lib/member-api.ts');
  assert.match(api, /resetMemberPassword/);
  assert.match(api, /["']reset_password["']/);

  const sheet = read('src/component/member/MemberSpreadsheet.tsx');
  assert.match(sheet, /비밀번호 초기화/);
  assert.match(sheet, /resetMemberPassword/);
  assert.match(sheet, /setCredentials/);
});

test('staff roster is read from one database snapshot with profile version and membership flags', () => {
  const migration = read('supabase/migrations/202609150006_roster_schedule_concurrency.sql');
  assert.match(migration, /create or replace function public\.list_semester_roster/i);
  assert.match(migration, /profile_version bigint/i);
  assert.match(migration, /membership_active boolean/i);
  assert.match(migration, /private\.is_active_staff\(\)/i);
  const api = read('src/lib/member-api.ts');
  assert.match(api, /rpc\(["']list_semester_roster["']/);
});

test('legacy Google settings stay read-protected while runtime uses memo plus generic resources', () => {
  const migration = read('supabase/migrations/202609160008_google_operations_settings.sql');
  assert.match(migration, /create table if not exists public\.staff_workspace_settings/i);
  assert.match(migration, /alter table public\.staff_workspace_settings enable row level security/i);
  assert.match(migration, /private\.is_active_staff\(\)/i);
  assert.doesNotMatch(migration, /grant\s+(insert|update|delete|all)[^;]*to\s+authenticated/i);

  const fn = read('supabase/functions/operations-settings/index.ts');
  assert.match(fn, /requireStaff\(req\)/);
  assert.match(fn, /currentSemester\(client\)/);
  assert.match(fn, /save_staff_memo/);
  assert.match(fn, /create_link/);
  assert.match(fn, /update_link/);
  assert.match(fn, /deactivate_link/);
  assert.match(fn, /reorder_links/);
  assert.match(fn, /resource_links/);
  assert.match(fn, /expected_version/);
  assert.doesNotMatch(fn, /save_metadata|google_account_email/);
  assert.match(read('supabase/config.toml'), /\[functions\.operations-settings\]/);

  const api = read('src/lib/member-api.ts');
  for (const name of ['readStaffResourceAdmin', 'readMemberResources', 'saveStaffPrivateSettings', 'createResourceLink', 'updateResourceLink', 'deactivateResourceLink', 'reorderResourceLinks']) {
    assert.match(api, new RegExp(name));
  }
  assert.doesNotMatch(api, /saveStaffWorkspaceMetadata|google_account_email/);
  assert.match(api, /["']operations-settings["']/);
  assert.doesNotMatch(api, /action:\s*["']save["']/);
});

test('resource hub migration generalizes fixed Google links without exposing staff links', () => {
  const migration = read('supabase/migrations/202609160009_resource_hub.sql');
  assert.match(migration, /add column if not exists google_account_email text/i);
  assert.match(migration, /create table if not exists public\.resource_links/i);
  assert.match(migration, /audience[\s\S]*member[\s\S]*staff/i);
  assert.match(migration, /service[\s\S]*notion[\s\S]*google_drive[\s\S]*github[\s\S]*discord/i);
  assert.match(migration, /alter table public\.resource_links enable row level security/i);
  assert.match(migration, /private\.has_semester_access\(semester\)/i);
  assert.match(migration, /private\.is_active_staff\(\)/i);
  assert.match(migration, /form_url[\s\S]*지원서[\s\S]*google_forms[\s\S]*recruitment[\s\S]*staff/i);
  assert.match(migration, /candidate_sheet_url[\s\S]*지원자 현황/i);
  assert.match(migration, /operations_drive_url[\s\S]*운영 Drive/i);
  assert.match(migration, /interview_template_url[\s\S]*면접 Template/i);
  assert.doesNotMatch(migration, /grant\s+(insert|update|delete|all)[^;]*to\s+authenticated/i);
});

test('staff shared secrets migration uses Vault and service-role-only secret RPCs', () => {
  const migration = read('supabase/migrations/202609160010_staff_shared_secrets.sql');
  assert.match(migration, /create extension if not exists supabase_vault with schema vault/i);
  assert.match(migration, /create table if not exists public\.staff_private_settings/i);
  assert.match(migration, /create table if not exists public\.staff_shared_secrets/i);
  assert.match(migration, /create table if not exists public\.staff_shared_secret_audit/i);
  assert.match(migration, /vault\.create_secret/i);
  assert.match(migration, /vault\.update_secret/i);
  assert.match(migration, /vault\.decrypted_secrets/i);
  assert.match(migration, /create_staff_shared_secret_atomic/i);
  assert.match(migration, /update_staff_shared_secret_atomic/i);
  assert.match(migration, /reveal_staff_shared_secret/i);
  assert.match(migration, /set_staff_shared_secret_active/i);
  assert.match(migration, /update_staff_private_settings_atomic/i);
  assert.match(migration, /grant execute[^;]*to service_role/i);
  assert.doesNotMatch(migration, /grant execute[^;]*to authenticated/i);
  assert.doesNotMatch(migration, /create table[^;]*(password|secret_value)\s+text/i);
});

test('staff memo is saved through privileged operations settings', () => {
  const fn = read('supabase/functions/operations-settings/index.ts');
  assert.match(fn, /save_staff_memo/);
  assert.match(fn, /update_staff_private_settings_atomic/);
  const api = read('src/lib/member-api.ts');
  assert.match(api, /readStaffPrivateSettings/);
  assert.match(api, /saveStaffPrivateSettings/);
});

test('staff secret edge boundary reveals only on explicit no-store action', () => {
  const fn = read('supabase/functions/staff-secrets/index.ts');
  assert.ok(fn.length > 800, 'staff-secrets edge function must exist');
  assert.match(fn, /requireStaff\(req\)/);
  for (const action of ['list', 'create', 'update', 'reveal', 'deactivate', 'reactivate', 'list_audit']) {
    assert.match(fn, new RegExp(action));
  }
  assert.match(fn, /Cache-Control[^\n]*no-store/i);
  assert.doesNotMatch(fn, /console\.log\([^)]*(secret|password)/i);
  assert.match(read('supabase/config.toml'), /\[functions\.staff-secrets\]/);

  const api = read('src/lib/member-api.ts');
  for (const name of [
    'readStaffPrivateSettings', 'saveStaffPrivateSettings', 'listStaffSharedSecrets',
    'createStaffSharedSecret', 'updateStaffSharedSecret', 'revealStaffSharedSecret',
    'setStaffSharedSecretActive', 'listStaffSharedSecretAudit',
  ]) assert.match(api, new RegExp(name));
  assert.match(api, /["']staff-secrets["']/);
});

test('member submission uses an integrated ProjectDB template editor with optional markdown import', () => {
  const page = read('src/app/member/submission/page.tsx');
  assert.match(page, /buildProjectReportTemplate/);
  assert.match(page, /프로젝트 보고서 Markdown 편집기/);
  assert.match(page, /ProjectDB 템플릿/);
  assert.match(page, /템플릿 다시 적용/);
  assert.match(page, /템플릿 다운로드/);
  assert.match(page, /기존 \.md 불러오기/);
  assert.match(page, /type=["']file["']/);
  assert.match(page, /accept=["']\.md,text\/markdown,text\/plain["']/);
  assert.match(page, /\.text\(\)/);
  assert.match(page, /stripProjectDbFrontmatter/);
  assert.match(page, /validateMarkdownUpload|validateSubmissionDraft/);
  assert.match(page, /report_filename/);
  assert.match(page, /report_markdown/);
  assert.doesNotMatch(page, /Markdown 경로|commit SHA \/ tag|검토 버전 · commit|보고서 저장소 · ProjectDB/);

  const write = read('supabase/functions/submission-write/index.ts');
  assert.match(write, /report_filename/);
  assert.match(write, /report_markdown/);
  assert.match(write, /TextEncoder/);
  assert.doesNotMatch(write, /resolveProjectDbReport/);
  assert.doesNotMatch(write, /cleanReportPath|cleanRef/);
});

test('member team context exposes only the caller fixed team and submission does not create teams', () => {
  const api = read('src/lib/member-api.ts');
  assert.match(api, /rpc\(["']list_own_team_members["']/);
  assert.doesNotMatch(api, /rpc\(["']list_team_candidates["']/);
  const page = read('src/app/member/submission/page.tsx');
  assert.doesNotMatch(page, /team_name|team_member_ids|팀 이름|팀원에 포함/);
  assert.match(page, /확정된 팀 구성|팀 미배정/);
  assert.match(page, /projectWindowState/);
  assert.match(page, /지각 제출/);
  assert.match(page, /제출 시작 전/);
});

test('schedule edits and deletes use optimistic event versions', () => {
  const migration = read('supabase/migrations/202609150006_roster_schedule_concurrency.sql');
  assert.match(migration, /alter table public\.events[\s\S]*add column if not exists version bigint/i);
  const api = read('src/lib/member-api.ts');
  assert.match(api, /events[\s\S]*version/);
  assert.match(api, /\.eq\(["']version["']/);
  const page = read('src/app/member/schedule/page.tsx');
  assert.match(page, /saveEvent\([^;]*editing/);
  assert.match(page, /deleteEvent\([^;]*event/);
});

test('project month calendar is deadline-first while list views keep submission ranges', () => {
  const domain = read('src/lib/member-domain.ts');
  assert.match(domain, /export function calendarDateForScheduleItem/);
  const page = read('src/app/member/schedule/page.tsx');
  assert.match(page, /calendarDateForScheduleItem/);
  assert.match(page, /마감/);
  assert.match(page, /item\.start_at/);
  assert.match(page, /item\.end_at/);
});

test('project rounds are administered through a staff edge function and recurring schedule UI', () => {
  const migration = read('supabase/migrations/202609190012_public_recruitment_recurring_schedule.sql');
  assert.match(migration, /create table if not exists public\.schedule_series/i);
  assert.match(migration, /materialize_schedule_assignment/i);
  const source = read('supabase/functions/schedule-series/index.ts');
  assert.match(source, /requireStaff\(req\)/);
  assert.match(source, /requireUser\(req\)/);
  assert.match(source, /generateScheduleOccurrences/);
  assert.match(source, /materialize_schedule_assignment/);
  assert.match(read('supabase/config.toml'), /\[functions\.schedule-series\]/);
  const page = read('src/app/member/schedule/page.tsx');
  for (const label of ['반복 안 함', '매일', '매주', '매월', '횟수 지정', '날짜까지', '계속', '개인 ↔ 팀 교대']) assert.match(page, new RegExp(label));
  assert.match(page, /createScheduleSeries/);
  assert.match(page, /updateScheduleSeries/);
  assert.match(page, /generateScheduleOccurrences/);
});

test('schedule supports true all-day events and project submission windows', () => {
  const migration = read('supabase/migrations/202609190013_all_day_schedule.sql');
  assert.match(migration, /alter table public\.events[\s\S]*all_day boolean not null default false/i);
  assert.match(migration, /alter table public\.assignments[\s\S]*all_day boolean not null default false/i);
  assert.match(migration, /alter table public\.schedule_series[\s\S]*all_day boolean not null default false/i);
  assert.match(migration, /p_all_day boolean/i);
  const series = read('supabase/functions/schedule-series/index.ts');
  assert.match(series, /all_day/);
  assert.match(series, /p_all_day/);
  const assignment = read('supabase/functions/assignment-admin/index.ts');
  assert.match(assignment, /all_day/);
  const page = read('src/app/member/schedule/page.tsx');
  assert.match(page, /하루 종일/);
  assert.match(page, /type=\{allDay \? ["']date["'] : ["']datetime-local["']\}/);
  assert.match(page, /displayScheduleRange/);
  assert.match(page, /updateBulkAllDay/);
});

test('staff schedule supports bulk editing multiple existing occurrences', () => {
  const page = read('src/app/member/schedule/page.tsx');
  for (const label of ['일괄 수정', '전체 선택', '선택 일정 날짜 이동', '이동 적용', '선택 일정 저장', '선택 삭제', '전체 삭제']) assert.match(page, new RegExp(label));
  assert.match(page, /bulkSelected/);
  assert.match(page, /saveBulkRows/);
  assert.match(page, /shiftSelectedBulkRows/);
  assert.match(page, /deleteBulkRows/);
  assert.match(page, /saveEvent/);
  assert.match(page, /saveAssignment/);
  assert.match(page, /deleteEvent/);
  assert.match(page, /deactivateAssignment/);
  assert.match(page, /deactivateScheduleSeries/);
  assert.match(page, /반복 생성 회차/);
  assert.match(page, /반복 규칙 자체는 바뀌지 않습니다/);
  assert.match(page, /제출 기록이 있는 프로젝트 회차는 보호되어 삭제되지 않습니다/);
});

test('public recruitment popup is disabled by default and staff-configurable', () => {
  const migration = read('supabase/migrations/202609190012_public_recruitment_recurring_schedule.sql');
  assert.match(migration, /public_recruitment_settings/);
  assert.match(migration, /values \(true, false\)/i);
  assert.match(migration, /grant select on public\.public_recruitment_settings to anon, authenticated/i);
  const home = read('src/app/page.tsx');
  assert.match(home, /fetchPublicRecruitmentSettings/);
  assert.doesNotMatch(home, /data\.isOpen/);
  const settings = read('src/app/member/operations/settings/page.tsx');
  assert.match(settings, /공개 리크루팅 안내/);
  assert.match(settings, /리크루팅 설정 저장/);
  const edge = read('supabase/functions/operations-settings/index.ts');
  assert.match(edge, /save_recruitment_settings/);
});

test('partial member updates preserve omitted semester requirement flags', () => {
  const source = read('supabase/functions/member-admin/index.ts');
  assert.match(source, /semester_memberships/);
  assert.match(source, /existingMembership/);
  assert.doesNotMatch(source, /individual_required:\s*body\.individual_required\s*\?\?\s*true/);
  assert.doesNotMatch(source, /team_required:\s*body\.team_required\s*\?\?\s*true/);
});

test('normal staff account management defaults staff out of project requirements', () => {
  const source = read('supabase/functions/member-admin/index.ts');
  assert.match(source, /role\s*===\s*["']staff["']\s*\?\s*false/);
  assert.match(source, /individual_required/);
  assert.match(source, /team_required/);
});

test('edge functions authenticate callers before privileged operations', () => {
  const shared = read('supabase/functions/_shared/security.ts');
  assert.match(shared, /auth\.getUser\(token\)/);
  assert.match(shared, /profile\.role !== ["']staff["']/);
  assert.match(shared, /ASC_WEB_ORIGINS/);
  const memberAdmin = read('supabase/functions/member-admin/index.ts');
  assert.match(memberAdmin, /requireStaff\(req\)/);
  assert.match(memberAdmin, /auth\.admin\.createUser/);
  const submissionWrite = read('supabase/functions/submission-write/index.ts');
  assert.match(submissionWrite, /requireUser\(req\)/);
  assert.doesNotMatch(submissionWrite, /PROJECTDB_(?:READ_)?TOKEN/);
  assert.match(submissionWrite, /existing\.status === ["']approved["']/);
  const submissionAdmin = read('supabase/functions/submission-admin/index.ts');
  assert.match(submissionAdmin, /PROJECTDB_TOKEN/);
  assert.match(submissionAdmin, /requireStaff\(req\)/);
  assert.match(submissionAdmin, /expected_version/);
  assert.match(submissionAdmin, /projectdb_sync_status:\s*"failed"/);
  assert.match(submissionAdmin, /projectdb_sync_attempt/);
  assert.match(submissionAdmin, /claimSyncAttempt/);
  assert.match(submissionAdmin, /persistSyncState/);
});

test('browser source never imports a privileged admin client or reads privileged environment keys', () => {
  function visit(path) {
    return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
      const next = join(path, entry.name);
      return entry.isDirectory() ? visit(next) : /\.(ts|tsx)$/.test(entry.name) ? [next] : [];
    });
  }
  for (const path of visit(fileURLToPath(new URL('../src/', import.meta.url)))) {
    const text = readFileSync(path, 'utf8');
    assert.doesNotMatch(text, /\.auth\.admin\./, path);
    assert.doesNotMatch(text, /process\.env\.(?:NEXT_PUBLIC_)?(?:SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|GITHUB_TOKEN)/, path);
  }
  assert.match(read('.env.example'), /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=/);
  assert.doesNotMatch(read('.env.example'), /SERVICE_ROLE|SECRET_KEY|GITHUB_TOKEN/);
});

test('member auth provider is scoped to member routes, not public root layout', () => {
  assert.match(read('src/app/member/layout.tsx'), /MemberSessionProvider/);
  assert.doesNotMatch(read('src/app/layout.tsx'), /MemberSessionProvider|supabase/);
});

test('member toolbar separates overall and round-first staff views while exposing the shared resource hub', () => {
  const toolbar = read('src/component/member/MemberToolbar.tsx');
  assert.match(toolbar, /전체 현황/);
  assert.match(toolbar, /회차별 현황/);
  assert.match(toolbar, /\/member\/operations\/progress/);
  assert.match(toolbar, /팀 관리/);
  assert.match(toolbar, /회원 관리/);
  assert.match(toolbar, /내 프로젝트/);
  assert.match(toolbar, /자료실/);
  assert.match(toolbar, /\/member\/resources/);
  assert.match(toolbar, /isActiveStaff\(profile\)/);
  assert.match(toolbar, /\/member\/operations\/teams/);
  assert.doesNotMatch(toolbar, /readStaffWorkspaceSettings/);
  assert.doesNotMatch(toolbar, /operations_drive_url/);
  assert.doesNotMatch(toolbar, /면접 \/ 운영 문서/);
});

test('member resource hub shows member-visible external resources without embedding providers', () => {
  const page = read('src/app/member/resources/page.tsx');
  assert.ok(page.length > 1000, 'member resource hub must exist');
  for (const label of ['ASC 자료실', '전체', '스터디', '프로젝트', 'CTF', '기타', '열기 ↗']) assert.match(page, new RegExp(label));
  assert.match(page, /readMemberResources/);
  assert.match(page, /target=["']_blank["']/);
  assert.match(page, /rel=["']noopener noreferrer["']/);
  assert.doesNotMatch(page, /<iframe|fetch\(/);
  assert.doesNotMatch(page, /운영진 전용/);
});

test('staff resource link manager keeps generic member/staff links without fixed Google account metadata', () => {
  const page = read('src/app/member/operations/settings/page.tsx');
  assert.ok(page.length > 1200, 'staff settings page must contain resource management');
  for (const label of ['링크 모음', '링크 추가', '회원 공개', '운영진 전용', 'Notion', 'Google Drive', 'Google Docs', 'Google Sheets', 'Google Forms', 'GitHub', 'Discord', '수정', '삭제']) {
    assert.match(page, new RegExp(label));
  }
  assert.match(page, /readStaffResourceAdmin/);
  assert.match(page, /createResourceLink/);
  assert.match(page, /updateResourceLink/);
  assert.match(page, /deactivateResourceLink/);
  assert.match(page, /reorderResourceLinks/);
  assert.doesNotMatch(page, /saveStaffWorkspaceMetadata/);
  assert.doesNotMatch(page, /Google 운영 계정/);
  assert.doesNotMatch(page, /readStaffWorkspaceSettings/);
  assert.doesNotMatch(page, /saveStaffWorkspaceSettings/);

  const env = read('.env.example');
  assert.doesNotMatch(env, /NEXT_PUBLIC_ASC_OPS_URL/);
  const workflow = read('.github/workflows/deploy-pages.yml');
  assert.doesNotMatch(workflow, /NEXT_PUBLIC_ASC_OPS_URL/);
  assert.match(read('.gitignore'), /\/ops\/outline\//);
});

test('staff shared-secret UI keeps plaintext short-lived and out of browser storage', () => {
  const page = read('src/app/member/operations/settings/page.tsx');
  for (const label of ['운영진 메모', '링크 모음', '공용 계정 / 비밀정보', '최근 비밀정보 접근 기록', '보기', '복사', '비활성화', '재활성화']) {
    assert.match(page, new RegExp(label));
  }
  assert.match(page, /비밀번호\/토큰은 메모에 적지/);
  assert.match(page, /type=["']password["']/);
  assert.match(page, /30_000|30000/);
  assert.match(page, /navigator\.clipboard/);
  for (const name of [
    'readStaffPrivateSettings', 'saveStaffPrivateSettings', 'listStaffSharedSecrets', 'createStaffSharedSecret',
    'updateStaffSharedSecret', 'revealStaffSharedSecret', 'setStaffSharedSecretActive', 'listStaffSharedSecretAudit',
  ]) assert.match(page, new RegExp(name));
  assert.doesNotMatch(page, /localStorage|sessionStorage|IndexedDB/);
  assert.doesNotMatch(page, /credential.*CSV|비밀번호.*CSV/i);
});

test('staff review previews the exact uploaded markdown as escaped text', () => {
  const page = read('src/app/member/operations/submissions/page.tsx');
  assert.match(page, /report_filename/);
  assert.match(page, /report_bytes/);
  assert.match(page, /report_markdown/);
  assert.match(page, /<pre/);
  assert.match(page, /Markdown 원문|업로드 보고서/);
  assert.doesNotMatch(page, /dangerouslySetInnerHTML|<iframe/);
});

test('team management supports inline team and membership edits', () => {
  const page = read('src/app/member/operations/teams/page.tsx');
  for (const label of ['팀원 수정', '회원 추가 / 이동', '빼기', '이름 저장']) assert.match(page, new RegExp(label));
  assert.match(page, /rename_team/);
  assert.match(page, /assign_member/);
  assert.match(page, /remove_member/);
});

test('staff submission operations are round-first and surface late plus unassigned state', () => {
  const api = read('src/lib/member-api.ts');
  assert.match(api, /computeProjectRoundOverview/);
  const page = read('src/app/member/operations/submissions/page.tsx');
  assert.match(page, /selectedAssignmentId/);
  assert.match(page, /회차/);
  assert.match(page, /지각/);
  assert.match(page, /미배정/);
  assert.doesNotMatch(page, /row\.profile\.member_id/);
});

test('staff overall progress view aggregates individual and team work by member', () => {
  const api = read('src/lib/member-api.ts');
  const domain = read('src/lib/member-domain.ts');
  const page = read('src/app/member/operations/progress/page.tsx');
  assert.match(api, /computeMemberProjectProgress/);
  assert.match(domain, /export function computeMemberProjectProgress/);
  for (const label of ['전체 현황', '부원별 프로젝트 진행', '개인 프로젝트', '팀 프로젝트', '개인 미제출', '팀 확인 필요']) assert.match(page, new RegExp(label));
  assert.match(page, /memberProgress/);
  assert.match(page, /overall_state/);
});

test('member dashboard is action-first and staff are redirected to the overall progress view', () => {
  const page = read('src/app/member/page.tsx');
  assert.match(page, /지금 할 프로젝트/);
  assert.match(page, /다음 프로젝트/);
  assert.match(page, /지난 프로젝트/);
  assert.match(page, /groupDashboardItems/);
  assert.match(page, /router\.replace\(["']\/member\/operations\/progress["']\)/);
});

test('member portal native form controls explicitly use a dark color scheme', () => {
  const css = read('src/styles/member.module.css');
  assert.match(css, /\.page\s*\{[^}]*color-scheme:\s*dark/s);
  assert.match(css, /option[^}]*background[^}]*#171819/s);
  assert.match(css, /\.roster select/);
  assert.match(css, /datetime-local/);
});

test('edge function CORS accepts loopback development origins on any local port', () => {
  const security = read('supabase/functions/_shared/security.ts');
  assert.match(security, /function isAllowedOrigin/);
  assert.match(security, /localhost/);
  assert.match(security, /127\.0\.0\.1/);
  assert.match(security, /0\.0\.0\.0/);
  assert.match(security, /url\.protocol === ["']http:["']/);
  assert.match(security, /isAllowedOrigin\(origin\)/);
});

test('bulk member administration is privileged, row-scoped, and can return one-time credentials', () => {
  const config = read('supabase/config.toml');
  assert.match(config, /\[functions\.member-bulk\]/);
  const source = read('supabase/functions/member-bulk/index.ts');
  assert.match(source, /requireStaff\(req\)/);
  assert.match(source, /generateTemporaryPassword/);
  assert.match(read('supabase/functions/_shared/security.ts'), /crypto\.getRandomValues/);
  assert.match(source, /rows\.length\s*>\s*200/);
  assert.match(source, /credentials/);
  assert.match(source, /update_member_admin_atomic/);
  assert.match(source, /auth\.admin\.createUser/);
  assert.match(source, /auth\.admin\.deleteUser/);
  const api = read('src/lib/member-api.ts');
  assert.match(api, /applyMemberBatch/);
  assert.match(api, /["']member-bulk["']/);
});

test('member management is a simplified editable spreadsheet with explicit batch save', () => {
  const component = read('src/component/member/MemberSpreadsheet.tsx');
  assert.ok(component.length > 1000, 'spreadsheet component must exist');
  for (const label of ['행 추가', '붙여넣기', '가져오기', '내보내기', '변경사항 저장']) assert.match(component, new RegExp(label));
  for (const label of ['로그인 아이디', '이름', '권한', '비밀번호 초기화']) assert.match(component, new RegExp(label));
  assert.doesNotMatch(component, />이번 학기 활동</);
  assert.doesNotMatch(component, />GitHub</);
  assert.doesNotMatch(component, />계정 상태</);
  assert.match(component, /applyMemberBatch/);
  assert.match(component, /parseTabularPaste/);
  assert.match(component, /validateSpreadsheetRows/);
  const page = read('src/app/member/operations/members/page.tsx');
  assert.match(page, /MemberSpreadsheet/);
  assert.doesNotMatch(page, /MemberEditor/);
});

test('member spreadsheet supports xlsx/csv preview export and template workflows without direct server writes', () => {
  const component = read('src/component/member/MemberSpreadsheet.tsx');
  assert.match(component, /parseXlsxWorkbook/);
  assert.match(component, /createXlsxWorkbook/);
  assert.match(component, /\.xlsx/);
  assert.match(component, /템플릿 다운로드/);
  assert.match(component, /그리드에 적용/);
  assert.match(component, /미리보기/);
  assert.match(component, /CSV 내보내기/);
  assert.match(component, /XLSX 내보내기/);
  assert.doesNotMatch(component, /localStorage|sessionStorage/);
});
