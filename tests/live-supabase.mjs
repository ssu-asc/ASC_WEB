import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from '@supabase/supabase-js';

function localSettings() {
  if (process.env.LOCAL_SUPABASE_URL && process.env.LOCAL_SUPABASE_PUBLISHABLE_KEY && process.env.LOCAL_SUPABASE_SECRET_KEY) {
    return { url: process.env.LOCAL_SUPABASE_URL, publishable: process.env.LOCAL_SUPABASE_PUBLISHABLE_KEY, secret: process.env.LOCAL_SUPABASE_SECRET_KEY };
  }
  const text = execFileSync('npx', ['--yes', 'supabase', 'status', '-o', 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const values = Object.fromEntries(text.split(/\r?\n/).map((line) => line.match(/^([A-Z0-9_]+)="?(.*?)"?$/)).filter(Boolean).map((match) => [match[1], match[2].replace(/"$/, '')]));
  const url = values.API_URL || values.SUPABASE_URL;
  const publishable = values.PUBLISHABLE_KEY || values.ANON_KEY;
  const secret = values.SECRET_KEY || values.SERVICE_ROLE_KEY;
  if (!url || !publishable || !secret) throw new Error('Could not read local Supabase settings from `supabase status -o env`.');
  return { url, publishable, secret };
}
const { url, publishable, secret } = localSettings();
const parsed = new URL(url);
if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)) throw new Error('Integration test refuses to run against a non-local Supabase URL.');

execFileSync('npx', ['--yes', 'supabase', 'db', 'reset', '--local'], { stdio: ['ignore', 'ignore', 'inherit'] });
const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const password = 'LocalTestPassword!123';
const suffix = `${Date.now()}`.slice(-7);
const people = {
  staff: { member_id: `st${suffix}`, name: '로컬운영진', role: 'staff' },
  a: { member_id: `a${suffix}`, name: '로컬회원A', role: 'member' },
  b: { member_id: `b${suffix}`, name: '로컬회원B', role: 'member' },
};
const created = [];
const clients = {};
let functionServer;
function email(memberId) { return `${memberId}@members.asc.invalid`; }
async function startFunctionServer() {
  const env = { ...process.env };
  delete env.PROJECTDB_TOKEN;
  delete env.PROJECTDB_READ_TOKEN;
  const args = ['--yes', 'supabase', 'functions', 'serve'];
  const child = spawn('npx', args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true, env });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  for (let attempt = 0; attempt < 80; attempt++) {
    if (output.includes('Serving functions on')) return child;
    if (child.exitCode !== null) throw new Error(`Function server exited during startup: ${output}`);
    await sleep(100);
  }
  child.kill('SIGTERM');
  throw new Error(`Function server did not start: ${output}`);
}
async function invokeFunction(client, name, body) {
  const { data } = await client.auth.getSession();
  assert.ok(data.session?.access_token, `session required for ${name}`);
  const response = await fetch(`${url}/functions/v1/${name}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${data.session.access_token}`, apikey: publishable, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let payload;
  try { payload = await response.json(); } catch { payload = {}; }
  return { response, payload };
}
async function createPerson(person) {
  const { data, error } = await admin.auth.admin.createUser({ email: email(person.member_id), password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error('auth user create failed');
  created.push(data.user.id);
  const { error: profileError } = await admin.from('profiles').insert({ id: data.user.id, member_id: person.member_id, name: person.name, role: person.role, active: true });
  if (profileError) throw profileError;
  const required = person.role !== 'staff';
  const { error: membershipError } = await admin.from('semester_memberships').insert({ profile_id: data.user.id, semester: '2026-2', active: true, individual_required: required, team_required: required });
  if (membershipError) throw membershipError;
  return data.user.id;
}
async function signIn(person) {
  const client = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email: email(person.member_id), password });
  if (error || !data.session) throw error ?? new Error('sign in failed');
  return client;
}

let stage = 'start function server';
try {
  functionServer = await startFunctionServer();
  stage = 'create local users';
  const ids = {};
  ids.staff = await createPerson(people.staff);
  ids.a = await createPerson(people.a);
  ids.b = await createPerson(people.b);
  clients.staff = await signIn(people.staff);
  clients.a = await signIn(people.a);
  clients.b = await signIn(people.b);

  stage = 'RLS reads';
  const own = await clients.a.from('profiles').select('member_id,name,role').eq('id', ids.a).single();
  assert.equal(own.error, null); assert.equal(own.data.member_id, people.a.member_id);
  const other = await clients.a.from('profiles').select('member_id').eq('id', ids.b);
  assert.equal(other.error, null); assert.equal(other.data.length, 0, 'ordinary member must not read another full profile');
  const roster = await clients.staff.from('profiles').select('member_id').in('id', [ids.staff, ids.a, ids.b]);
  assert.equal(roster.error, null); assert.equal(roster.data.length, 3, 'staff reads semester roster profiles');
  const rosterSnapshot = await clients.staff.rpc('list_semester_roster', { target_semester: '2026-2' });
  assert.equal(rosterSnapshot.error, null, rosterSnapshot.error?.message);
  assert.equal(rosterSnapshot.data.length, 3, 'staff roster RPC returns one joined snapshot');
  assert.equal(typeof rosterSnapshot.data[0].profile_version, 'number');
  assert.equal(typeof rosterSnapshot.data[0].membership_active, 'boolean');
  const rosterDenied = await clients.a.rpc('list_semester_roster', { target_semester: '2026-2' });
  assert.notEqual(rosterDenied.error, null, 'ordinary member cannot call staff roster snapshot RPC');

  const legacyCandidates = await clients.a.rpc('list_team_candidates', { target_semester: '2026-2' });
  assert.notEqual(legacyCandidates.error, null, 'ordinary members must not read the semester-wide teammate candidate roster');
  const ownTeamBeforeAssignment = await clients.a.rpc('list_own_team_members', { target_semester: '2026-2' });
  assert.equal(ownTeamBeforeAssignment.error, null, ownTeamBeforeAssignment.error?.message);
  assert.equal(ownTeamBeforeAssignment.data.length, 0, 'unassigned member has no fixed team context');

  stage = 'resource hub settings and RLS';
  const memberSettingsRead = await clients.a.from('staff_workspace_settings').select('semester,google_account_email').eq('semester', '2026-2');
  assert.equal(memberSettingsRead.error, null); assert.equal(memberSettingsRead.data.length, 0, 'ordinary member cannot read staff workspace metadata');
  const memberSettingsWrite = await clients.a.from('staff_workspace_settings').insert({ semester: '2026-2', google_account_email: 'forbidden@example.com' });
  assert.notEqual(memberSettingsWrite.error, null, 'browser clients cannot write staff workspace metadata directly');
  const memberResourceWrite = await clients.a.from('resource_links').insert({
    semester: '2026-2', title: '금지된 링크', url: 'https://example.com/forbidden', service: 'other', category: 'other', audience: 'member',
  });
  assert.notEqual(memberResourceWrite.error, null, 'browser clients cannot write resource links directly');

  const deniedBodies = [
    { action: 'create_link', title: '금지', description: '', url: 'https://example.com/denied', service: 'other', category: 'other', audience: 'member' },
    { action: 'update_link', resource_id: '00000000-0000-0000-0000-000000000000', expected_version: 1, title: '금지', description: '', url: 'https://example.com/denied', service: 'other', category: 'other', audience: 'member' },
    { action: 'deactivate_link', resource_id: '00000000-0000-0000-0000-000000000000', expected_version: 1 },
    { action: 'reorder_links', resource_ids: [] },
  ];
  for (const body of deniedBodies) {
    const denied = await invokeFunction(clients.a, 'operations-settings', body);
    assert.equal(denied.response.status, 403, `ordinary member cannot use operations-settings action ${body.action}`);
  }

  const createStudyLink = await invokeFunction(clients.staff, 'operations-settings', {
    action: 'create_link', title: '웹해킹 스터디', description: '기존 Notion 스터디 자료',
    url: 'https://www.notion.so/asc-web-study-123456', service: 'notion', category: 'study', audience: 'member',
  });
  assert.equal(createStudyLink.response.status, 200, JSON.stringify(createStudyLink.payload));
  assert.equal(createStudyLink.payload.link.version, 1);
  const studyLink = createStudyLink.payload.link;

  const createProjectLink = await invokeFunction(clients.staff, 'operations-settings', {
    action: 'create_link', title: 'ProjectDB', description: '프로젝트 보고서 저장소',
    url: 'https://github.com/ssu-asc/ProjectDB', service: 'github', category: 'project', audience: 'member',
  });
  assert.equal(createProjectLink.response.status, 200, JSON.stringify(createProjectLink.payload));
  const projectLink = createProjectLink.payload.link;

  const createStaffLink = await invokeFunction(clients.staff, 'operations-settings', {
    action: 'create_link', title: '지원자 현황', description: '운영진 전용 모집 현황',
    url: 'https://docs.google.com/spreadsheets/d/asc-candidates/edit', service: 'google_sheets', category: 'recruitment', audience: 'staff',
  });
  assert.equal(createStaffLink.response.status, 200, JSON.stringify(createStaffLink.payload));
  const staffOnlyLink = createStaffLink.payload.link;

  const memberResourceRead = await clients.a.from('resource_links')
    .select('id,title,audience,active,sort_order,version').eq('semester', '2026-2').order('sort_order').order('title');
  assert.equal(memberResourceRead.error, null, memberResourceRead.error?.message);
  assert.deepEqual(memberResourceRead.data.map((row) => row.title).sort(), ['ProjectDB', '웹해킹 스터디'].sort(), 'ordinary member sees active member resources only');
  assert.equal(memberResourceRead.data.some((row) => row.audience === 'staff'), false);

  const staffResourceRead = await clients.staff.from('resource_links')
    .select('id,title,audience,active,sort_order,version').eq('semester', '2026-2').order('sort_order').order('title');
  assert.equal(staffResourceRead.error, null, staffResourceRead.error?.message);
  assert.equal(staffResourceRead.data.length, 3, 'staff can manage member and staff resource links');

  const invalidResource = await invokeFunction(clients.staff, 'operations-settings', {
    action: 'create_link', title: '잘못된 링크', description: '', url: 'http://example.com/insecure', service: 'other', category: 'other', audience: 'member',
  });
  assert.equal(invalidResource.response.status, 400, 'resource links require absolute https URLs');

  const updateStudyLink = await invokeFunction(clients.staff, 'operations-settings', {
    action: 'update_link', resource_id: studyLink.id, expected_version: studyLink.version,
    title: '웹해킹 스터디 자료', description: '기존 Notion 스터디 자료', url: studyLink.url,
    service: 'notion', category: 'study', audience: 'member',
  });
  assert.equal(updateStudyLink.response.status, 200, JSON.stringify(updateStudyLink.payload));
  assert.equal(updateStudyLink.payload.link.version, 2);

  const staleResource = await invokeFunction(clients.staff, 'operations-settings', {
    action: 'update_link', resource_id: studyLink.id, expected_version: studyLink.version,
    title: '오래된 화면', description: '', url: studyLink.url, service: 'notion', category: 'study', audience: 'member',
  });
  assert.equal(staleResource.response.status, 409, 'stale resource edit must not overwrite newer values');

  const reordered = await invokeFunction(clients.staff, 'operations-settings', {
    action: 'reorder_links', resource_ids: [staffOnlyLink.id, projectLink.id, studyLink.id],
  });
  assert.equal(reordered.response.status, 200, JSON.stringify(reordered.payload));
  const reorderedRows = await clients.staff.from('resource_links').select('id,sort_order').in('id', [staffOnlyLink.id, projectLink.id, studyLink.id]).order('sort_order');
  assert.equal(reorderedRows.error, null, reorderedRows.error?.message);
  assert.deepEqual(reorderedRows.data.map((row) => row.id), [staffOnlyLink.id, projectLink.id, studyLink.id]);
  const reorderedStudyLink = reordered.payload.links.find((row) => row.id === studyLink.id);
  assert.equal(reorderedStudyLink.version, 3, 'reordering is a row change and advances the resource version');

  const deactivateStudyLink = await invokeFunction(clients.staff, 'operations-settings', {
    action: 'deactivate_link', resource_id: studyLink.id, expected_version: reorderedStudyLink.version,
  });
  assert.equal(deactivateStudyLink.response.status, 200, JSON.stringify(deactivateStudyLink.payload));
  const memberResourceAfterDeactivate = await clients.a.from('resource_links').select('title').eq('semester', '2026-2').order('title');
  assert.equal(memberResourceAfterDeactivate.error, null, memberResourceAfterDeactivate.error?.message);
  assert.deepEqual(memberResourceAfterDeactivate.data.map((row) => row.title), ['ProjectDB'], 'inactive member resource is hidden by RLS');

  stage = 'public recruitment settings';
  const publicClient = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
  const publicRecruitment = await publicClient.from('public_recruitment_settings').select('enabled,title,version').eq('id', true).single();
  assert.equal(publicRecruitment.error, null, publicRecruitment.error?.message);
  assert.equal(publicRecruitment.data.enabled, false, 'recruitment popup defaults off');
  const memberRecruitmentWrite = await clients.a.from('public_recruitment_settings').update({ enabled: true }).eq('id', true);
  assert.notEqual(memberRecruitmentWrite.error, null, 'browser roles cannot mutate public recruitment settings');
  const memberRecruitmentAdmin = await invokeFunction(clients.a, 'operations-settings', {
    action: 'save_recruitment_settings', expected_version: publicRecruitment.data.version,
    enabled: true, title: '금지', description: '', button_label: '지원', button_href: '/apply', starts_at: null, ends_at: null,
  });
  assert.equal(memberRecruitmentAdmin.response.status, 403, 'ordinary member cannot change recruitment settings');
  const savedRecruitment = await invokeFunction(clients.staff, 'operations-settings', {
    action: 'save_recruitment_settings', expected_version: publicRecruitment.data.version,
    enabled: true, title: 'ASC 리크루팅 안내', description: '통합 테스트 모집', button_label: '지원하기', button_href: '/apply', starts_at: null, ends_at: null,
  });
  assert.equal(savedRecruitment.response.status, 200, JSON.stringify(savedRecruitment.payload));
  assert.equal(savedRecruitment.payload.recruitment.enabled, true);

  stage = 'staff shared secrets';
  const memberMemoRead = await clients.a.from('staff_private_settings').select('staff_memo,version');
  assert.equal(memberMemoRead.error, null); assert.equal(memberMemoRead.data.length, 0, 'ordinary member cannot read staff memo');
  const staffMemoRead = await clients.staff.from('staff_private_settings').select('staff_memo,version').eq('id', true).single();
  assert.equal(staffMemoRead.error, null, staffMemoRead.error?.message);
  const savedMemo = await invokeFunction(clients.staff, 'operations-settings', {
    action: 'save_staff_memo', expected_version: staffMemoRead.data.version,
    staff_memo: 'Google: local-test@example.com\nInstagram: @local_test\nGitHub: local-test',
  });
  assert.equal(savedMemo.response.status, 200, JSON.stringify(savedMemo.payload));
  assert.equal(savedMemo.payload.settings.version, staffMemoRead.data.version + 1);
  const staleMemo = await invokeFunction(clients.staff, 'operations-settings', {
    action: 'save_staff_memo', expected_version: staffMemoRead.data.version, staff_memo: 'stale memo',
  });
  assert.equal(staleMemo.response.status, 409, 'stale staff memo must not overwrite a newer memo');

  const memberDirectSecrets = await clients.a.from('staff_shared_secrets').select('id');
  assert.notEqual(memberDirectSecrets.error, null, 'ordinary member has no direct secret metadata access');
  const staffDirectSecrets = await clients.staff.from('staff_shared_secrets').select('id');
  assert.notEqual(staffDirectSecrets.error, null, 'staff browser session also has no direct secret metadata access');
  const staffDirectAudit = await clients.staff.from('staff_shared_secret_audit').select('id');
  assert.notEqual(staffDirectAudit.error, null, 'staff browser session has no direct audit-table access');

  for (const deniedBody of [
    { action: 'list' },
    { action: 'list_audit' },
    { action: 'create', label: '금지', account_identifier: 'member', login_url: null, secret: 'LocalDeniedSecret!123' },
    { action: 'reveal', secret_id: '00000000-0000-0000-0000-000000000000' },
    { action: 'deactivate', secret_id: '00000000-0000-0000-0000-000000000000', expected_version: 1 },
  ]) {
    const denied = await invokeFunction(clients.a, 'staff-secrets', deniedBody);
    assert.equal(denied.response.status, 403, `ordinary member cannot use staff-secrets action ${deniedBody.action}`);
  }

  const localSharedSecret = 'LocalSharedSecret!123';
  const createdSecret = await invokeFunction(clients.staff, 'staff-secrets', {
    action: 'create', label: 'ASC Local Test', account_identifier: 'local@example.com',
    login_url: 'https://example.com/login', secret: localSharedSecret,
  });
  assert.equal(createdSecret.response.status, 200, JSON.stringify(createdSecret.payload));
  assert.equal(createdSecret.payload.secret.version, 1);
  assert.equal(JSON.stringify(createdSecret.payload).includes(localSharedSecret), false, 'create response never returns plaintext');
  assert.equal('vault_secret_id' in createdSecret.payload.secret, false, 'edge response must not expose internal Vault identifiers');
  const sharedSecretId = createdSecret.payload.secret.id;
  const directRevealRpc = await clients.staff.rpc('reveal_staff_shared_secret', { p_secret_id: sharedSecretId, p_actor: ids.staff });
  assert.notEqual(directRevealRpc.error, null, 'staff browser role cannot call service-role-only reveal RPC directly');

  const listedSecrets = await invokeFunction(clients.staff, 'staff-secrets', { action: 'list' });
  assert.equal(listedSecrets.response.status, 200, JSON.stringify(listedSecrets.payload));
  assert.equal(listedSecrets.payload.secrets.some((row) => row.id === sharedSecretId), true);
  assert.equal(JSON.stringify(listedSecrets.payload).includes(localSharedSecret), false, 'list response contains metadata only');

  const storedSecretMetadata = await admin.from('staff_shared_secrets')
    .select('id,label,account_identifier,vault_secret_id,version').eq('id', sharedSecretId).single();
  assert.equal(storedSecretMetadata.error, null, storedSecretMetadata.error?.message);
  assert.match(storedSecretMetadata.data.vault_secret_id, /^[0-9a-f-]{36}$/i);
  assert.equal(JSON.stringify(storedSecretMetadata.data).includes(localSharedSecret), false, 'ordinary metadata row contains no plaintext');

  const firstReveal = await invokeFunction(clients.staff, 'staff-secrets', { action: 'reveal', secret_id: sharedSecretId });
  assert.equal(firstReveal.response.status, 200, JSON.stringify(firstReveal.payload));
  assert.equal(firstReveal.payload.secret, localSharedSecret);
  assert.equal(firstReveal.response.headers.get('cache-control'), 'no-store, private');

  const staleSecretUpdate = await invokeFunction(clients.staff, 'staff-secrets', {
    action: 'update', secret_id: sharedSecretId, expected_version: 999,
    label: 'ASC Local Test', account_identifier: 'local@example.com', login_url: 'https://example.com/login',
    secret: 'WrongSecretShouldNotWin!123',
  });
  assert.equal(staleSecretUpdate.response.status, 409, 'stale shared-secret update must fail before Vault mutation');
  const revealAfterStale = await invokeFunction(clients.staff, 'staff-secrets', { action: 'reveal', secret_id: sharedSecretId });
  assert.equal(revealAfterStale.payload.secret, localSharedSecret, 'stale update must not mutate the Vault secret');

  const replacementSecret = 'LocalReplacementSecret!456';
  const updatedSecret = await invokeFunction(clients.staff, 'staff-secrets', {
    action: 'update', secret_id: sharedSecretId, expected_version: createdSecret.payload.secret.version,
    label: 'ASC Local Test Updated', account_identifier: '@local_test', login_url: 'https://example.com/login', secret: replacementSecret,
  });
  assert.equal(updatedSecret.response.status, 200, JSON.stringify(updatedSecret.payload));
  assert.equal(updatedSecret.payload.secret.version, 2);
  assert.equal(JSON.stringify(updatedSecret.payload).includes(replacementSecret), false, 'update response never returns plaintext');
  const revealUpdated = await invokeFunction(clients.staff, 'staff-secrets', { action: 'reveal', secret_id: sharedSecretId });
  assert.equal(revealUpdated.payload.secret, replacementSecret);

  const deactivatedSecret = await invokeFunction(clients.staff, 'staff-secrets', {
    action: 'deactivate', secret_id: sharedSecretId, expected_version: updatedSecret.payload.secret.version,
  });
  assert.equal(deactivatedSecret.response.status, 200, JSON.stringify(deactivatedSecret.payload));
  assert.equal(deactivatedSecret.payload.secret.active, false);
  const blockedReveal = await invokeFunction(clients.staff, 'staff-secrets', { action: 'reveal', secret_id: sharedSecretId });
  assert.equal(blockedReveal.response.status, 409, 'inactive shared secret cannot be revealed');

  const reactivatedSecret = await invokeFunction(clients.staff, 'staff-secrets', {
    action: 'reactivate', secret_id: sharedSecretId, expected_version: deactivatedSecret.payload.secret.version,
  });
  assert.equal(reactivatedSecret.response.status, 200, JSON.stringify(reactivatedSecret.payload));
  assert.equal(reactivatedSecret.payload.secret.active, true);
  const revealReactivated = await invokeFunction(clients.staff, 'staff-secrets', { action: 'reveal', secret_id: sharedSecretId });
  assert.equal(revealReactivated.payload.secret, replacementSecret);

  const secretAudit = await invokeFunction(clients.staff, 'staff-secrets', { action: 'list_audit' });
  assert.equal(secretAudit.response.status, 200, JSON.stringify(secretAudit.payload));
  assert.equal(secretAudit.payload.audits.some((row) => row.secret_id === sharedSecretId && row.action === 'revealed'), true);
  assert.equal(secretAudit.payload.audits.some((row) => row.secret_id === sharedSecretId && row.action === 'deactivated'), true);
  assert.equal(JSON.stringify(secretAudit.payload).includes(localSharedSecret), false, 'audit response contains no plaintext');
  assert.equal(JSON.stringify(secretAudit.payload).includes(replacementSecret), false, 'audit response contains no replacement plaintext');

  const memberEventWrite = await clients.a.from('events').insert({ semester: '2026-2', title: '금지된 일정', category: 'meeting', description: '', start_at: new Date(Date.now() + 3600000).toISOString(), created_by: ids.a });
  assert.notEqual(memberEventWrite.error, null, 'ordinary member cannot create events');
  const staffEvent = await clients.staff.from('events').insert({ semester: '2026-2', title: '통합 테스트 일정', category: 'meeting', description: '', start_at: new Date(Date.now() + 3600000).toISOString(), created_by: ids.staff }).select('id,version').single();
  assert.equal(staffEvent.error, null, staffEvent.error?.message);
  const eventRead = await clients.a.from('events').select('title').eq('id', staffEvent.data.id).single();
  assert.equal(eventRead.error, null); assert.equal(eventRead.data.title, '통합 테스트 일정');
  const eventUpdate = await clients.staff.from('events').update({ title: '통합 테스트 일정 수정', version: staffEvent.data.version + 1 })
    .eq('id', staffEvent.data.id).eq('version', staffEvent.data.version).select('id,version').maybeSingle();
  assert.equal(eventUpdate.error, null); assert.equal(eventUpdate.data.version, staffEvent.data.version + 1);
  const staleEventUpdate = await clients.staff.from('events').update({ title: '오래된 일정 덮어쓰기', version: staffEvent.data.version + 1 })
    .eq('id', staffEvent.data.id).eq('version', staffEvent.data.version).select('id').maybeSingle();
  assert.equal(staleEventUpdate.error, null); assert.equal(staleEventUpdate.data, null, 'stale schedule edit must not overwrite a newer event version');

  stage = 'member-admin ordinary denial';
  const lastStaffGuard = await admin.from('profiles').update({ active: false }).eq('id', ids.staff);
  assert.notEqual(lastStaffGuard.error, null, 'database must prevent removing the last active staff account');

  const memberAdminDenied = await invokeFunction(clients.a, 'member-admin', { action: 'reset_password', member_id: people.b.member_id });
  assert.equal(memberAdminDenied.response.status, 403, 'ordinary member cannot use member-admin');

  stage = 'member-admin staff create';
  const generatedId = `fn${suffix}`;
  const generatedPassword = 'GeneratedMember!123';
  const memberCreate = await invokeFunction(clients.staff, 'member-admin', {
    action: 'create', member_id: generatedId, name: '함수발급회원', role: 'member', active: true,
    semester_active: true, individual_required: true, team_required: true, temporary_password: generatedPassword,
  });
  assert.equal(memberCreate.response.status, 200, JSON.stringify(memberCreate.payload));
  const generatedProfile = await admin.from('profiles').select('id,version').eq('member_id', generatedId).single();
  assert.equal(generatedProfile.error, null); created.push(generatedProfile.data.id);
  const memberUpdate = await invokeFunction(clients.staff, 'member-admin', { action: 'update', member_id: generatedId, expected_version: generatedProfile.data.version, name: '함수발급회원 수정' });
  assert.equal(memberUpdate.response.status, 200, JSON.stringify(memberUpdate.payload));
  const staleMemberUpdate = await invokeFunction(clients.staff, 'member-admin', { action: 'update', member_id: generatedId, expected_version: generatedProfile.data.version, name: '오래된 화면 저장' });
  assert.equal(staleMemberUpdate.response.status, 409, 'stale member-management form must not overwrite newer member state');
  const generatedClient = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
  const generatedLogin = await generatedClient.auth.signInWithPassword({ email: email(generatedId), password: generatedPassword });
  assert.equal(generatedLogin.error, null, generatedLogin.error?.message);

  stage = 'member-admin generated reset';
  const generatedReset = await invokeFunction(clients.staff, 'member-admin', { action: 'reset_password', member_id: generatedId });
  assert.equal(generatedReset.response.status, 200, JSON.stringify(generatedReset.payload));
  assert.equal(generatedReset.payload.member_id, generatedId);
  assert.match(generatedReset.payload.temporary_password, /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{20}$/);
  const resetGeneratedClient = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
  const resetGeneratedLogin = await resetGeneratedClient.auth.signInWithPassword({ email: email(generatedId), password: generatedReset.payload.temporary_password });
  assert.equal(resetGeneratedLogin.error, null, resetGeneratedLogin.error?.message);

  stage = 'member-bulk';
  const bulkDenied = await invokeFunction(clients.a, 'member-bulk', {
    action: 'apply',
    rows: [{ row_id: 'denied', member_id: `deny${suffix}`, name: '금지', role: 'member', semester_active: true, account_active: true, github_username: null }],
  });
  assert.equal(bulkDenied.response.status, 403, 'ordinary member cannot use member-bulk');
  const bulkMemberId = `bm${suffix}`;
  const bulkStaffId = `bs${suffix}`;
  const bulkMemberPassword = 'BulkMemberPassword!123';
  const bulkCreate = await invokeFunction(clients.staff, 'member-bulk', {
    action: 'apply',
    rows: [
      { row_id: 'member-row', member_id: bulkMemberId, name: '일괄회원', role: 'member', semester_active: true, account_active: true, github_username: null, temporary_password: bulkMemberPassword },
      { row_id: 'staff-row', member_id: bulkStaffId, name: '일괄운영진', role: 'staff', semester_active: true, account_active: true, github_username: null },
    ],
  });
  assert.equal(bulkCreate.response.status, 200, JSON.stringify(bulkCreate.payload));
  assert.equal(bulkCreate.payload.results.every((row) => row.ok), true, JSON.stringify(bulkCreate.payload));
  assert.deepEqual(bulkCreate.payload.credentials.map((row) => row.member_id), [bulkStaffId], 'only generated passwords are returned');
  assert.match(bulkCreate.payload.credentials[0].temporary_password, /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{20}$/);
  const bulkProfiles = await admin.from('profiles').select('id,member_id,role,version').in('member_id', [bulkMemberId, bulkStaffId]);
  assert.equal(bulkProfiles.error, null); assert.equal(bulkProfiles.data.length, 2);
  created.push(...bulkProfiles.data.map((row) => row.id));
  const bulkMemberships = await admin.from('semester_memberships').select('profile_id,individual_required,team_required').in('profile_id', bulkProfiles.data.map((row) => row.id));
  assert.equal(bulkMemberships.error, null);
  const bulkMemberProfile = bulkProfiles.data.find((row) => row.member_id === bulkMemberId);
  const bulkStaffProfile = bulkProfiles.data.find((row) => row.member_id === bulkStaffId);
  const bulkMemberMembership = bulkMemberships.data.find((row) => row.profile_id === bulkMemberProfile.id);
  const bulkStaffMembership = bulkMemberships.data.find((row) => row.profile_id === bulkStaffProfile.id);
  assert.equal(bulkMemberMembership.individual_required, true); assert.equal(bulkMemberMembership.team_required, true);
  assert.equal(bulkStaffMembership.individual_required, false); assert.equal(bulkStaffMembership.team_required, false);
  const bulkStaffLoginClient = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
  const bulkStaffLogin = await bulkStaffLoginClient.auth.signInWithPassword({ email: email(bulkStaffId), password: bulkCreate.payload.credentials[0].temporary_password });
  assert.equal(bulkStaffLogin.error, null, bulkStaffLogin.error?.message);
  const bulkStaffDeactivate = await invokeFunction(clients.staff, 'member-bulk', {
    action: 'apply',
    rows: [{ row_id: 'staff-disable', member_id: bulkStaffId, name: '일괄운영진', role: 'staff', semester_active: true, account_active: false, github_username: null, expected_version: bulkStaffProfile.version }],
  });
  assert.equal(bulkStaffDeactivate.response.status, 200, JSON.stringify(bulkStaffDeactivate.payload));
  assert.equal(bulkStaffDeactivate.payload.results[0].ok, true, JSON.stringify(bulkStaffDeactivate.payload));

  const bulkUpdate = await invokeFunction(clients.staff, 'member-bulk', {
    action: 'apply',
    rows: [
      { row_id: 'update-ok', member_id: bulkMemberId, name: '일괄회원 수정', role: 'member', semester_active: true, account_active: true, github_username: 'bulkuser', expected_version: bulkMemberProfile.version },
      { row_id: 'invalid-row', member_id: 'xy', name: '', role: 'member', semester_active: true, account_active: true, github_username: null },
    ],
  });
  assert.equal(bulkUpdate.response.status, 200, JSON.stringify(bulkUpdate.payload));
  assert.equal(bulkUpdate.payload.results.find((row) => row.row_id === 'update-ok').ok, true);
  assert.equal(bulkUpdate.payload.results.find((row) => row.row_id === 'invalid-row').ok, false, 'one invalid row must not roll back an independent valid row');
  const bulkUpdatedProfile = await admin.from('profiles').select('name,github_username,version').eq('id', bulkMemberProfile.id).single();
  assert.equal(bulkUpdatedProfile.error, null); assert.equal(bulkUpdatedProfile.data.name, '일괄회원 수정'); assert.equal(bulkUpdatedProfile.data.github_username, 'bulkuser');
  const staleBulkUpdate = await invokeFunction(clients.staff, 'member-bulk', {
    action: 'apply',
    rows: [{ row_id: 'stale', member_id: bulkMemberId, name: '오래된 저장', role: 'member', semester_active: true, account_active: true, github_username: null, expected_version: bulkMemberProfile.version }],
  });
  assert.equal(staleBulkUpdate.response.status, 200);
  assert.equal(staleBulkUpdate.payload.results[0].ok, false, 'stale bulk edit must fail at row level');

  stage = 'assignment-admin scheduled fixtures';
  const fixtureOpensAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const fixtureDueAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const assignmentAdminDenied = await invokeFunction(clients.a, 'assignment-admin', {
    action: 'create', project_type: 'individual', title: '금지된 회차', description: '', opens_at: fixtureOpensAt, due_at: fixtureDueAt,
  });
  assert.equal(assignmentAdminDenied.response.status, 403, 'ordinary member cannot create project rounds');
  const individualRound = await invokeFunction(clients.staff, 'assignment-admin', {
    action: 'create', project_type: 'individual', title: '통합 테스트 개인 회차', description: '', opens_at: fixtureOpensAt, due_at: fixtureDueAt,
  });
  assert.equal(individualRound.response.status, 200, JSON.stringify(individualRound.payload));
  const teamRound = await invokeFunction(clients.staff, 'assignment-admin', {
    action: 'create', project_type: 'team', title: '통합 테스트 팀 회차', description: '', opens_at: fixtureOpensAt, due_at: fixtureDueAt,
  });
  assert.equal(teamRound.response.status, 200, JSON.stringify(teamRound.payload));
  const series = await invokeFunction(clients.staff, 'assignment-admin', {
    action: 'create_series', first_type: 'individual', title_prefix: '교대 프로젝트', description: '',
    first_opens_at: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    first_due_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(), interval_weeks: 1, count: 4,
  });
  assert.equal(series.response.status, 200, JSON.stringify(series.payload));
  assert.equal(series.payload.assignments.length, 4, 'alternating series materializes four independent rounds atomically');
  assert.deepEqual(series.payload.assignments.map((row) => row.project_type), ['individual', 'team', 'individual', 'team']);
  const individualAssignmentId = individualRound.payload.assignment.assignment_id;
  const teamAssignmentId = teamRound.payload.assignment.assignment_id;
  const updateRound = await invokeFunction(clients.staff, 'assignment-admin', {
    action: 'update', assignment_id: individualAssignmentId, expected_version: 1, title: '통합 테스트 개인 회차 수정', description: '',
    opens_at: fixtureOpensAt, due_at: fixtureDueAt,
  });
  assert.equal(updateRound.response.status, 200, JSON.stringify(updateRound.payload));
  const staleRoundUpdate = await invokeFunction(clients.staff, 'assignment-admin', {
    action: 'update', assignment_id: individualAssignmentId, expected_version: 1, title: '오래된 일정 덮어쓰기', description: '',
    opens_at: fixtureOpensAt, due_at: fixtureDueAt,
  });
  assert.equal(staleRoundUpdate.response.status, 409, 'stale project-round edit must conflict');
  const allDayRoundUpdate = await invokeFunction(clients.staff, 'assignment-admin', {
    action: 'update', assignment_id: individualAssignmentId, expected_version: 2, title: '통합 테스트 개인 회차 수정', description: '',
    opens_at: fixtureOpensAt, due_at: fixtureDueAt, all_day: true,
  });
  assert.equal(allDayRoundUpdate.response.status, 200, JSON.stringify(allDayRoundUpdate.payload));
  const allDayRound = await admin.from('assignments').select('all_day,opens_at,due_at,version').eq('id', individualAssignmentId).single();
  assert.equal(allDayRound.error, null, allDayRound.error?.message);
  assert.equal(allDayRound.data.all_day, true);
  assert.match(new Date(new Date(allDayRound.data.opens_at).valueOf() + 9 * 60 * 60 * 1000).toISOString(), /T00:00:00\.000Z$/);
  assert.match(new Date(new Date(allDayRound.data.due_at).valueOf() + 9 * 60 * 60 * 1000).toISOString(), /T23:59:59\.999Z$/);

  stage = 'recurring schedule series';
  const seriesDenied = await invokeFunction(clients.a, 'schedule-series', {
    action: 'create', kind: 'project', title: '금지 반복', description: '', event_category: null, project_pattern: 'individual', link_url: null,
    first_start_at: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString(), first_end_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    recurrence_frequency: 'weekly', recurrence_interval: 1, weekdays: [1], end_mode: 'count', occurrence_count: 2, until_at: null,
  });
  assert.equal(seriesDenied.response.status, 403, 'ordinary member cannot create recurring schedules');
  const recurringProject = await invokeFunction(clients.staff, 'schedule-series', {
    action: 'create', kind: 'project', title: '통합 반복 프로젝트', description: '', event_category: null, project_pattern: 'alternating', link_url: null,
    first_start_at: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString(), first_end_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    all_day: true, recurrence_frequency: 'daily', recurrence_interval: 2, weekdays: [], end_mode: 'count', occurrence_count: 3, until_at: null,
  });
  assert.equal(recurringProject.response.status, 200, JSON.stringify(recurringProject.payload));
  assert.equal(recurringProject.payload.series.all_day, true);
  const recurringAssignments = await admin.from('assignments').select('project_type,schedule_series_id,occurrence_index,all_day,opens_at,due_at').eq('schedule_series_id', recurringProject.payload.series.id).order('occurrence_index');
  assert.equal(recurringAssignments.error, null, recurringAssignments.error?.message);
  assert.equal(recurringAssignments.data.length, 3);
  assert.deepEqual(recurringAssignments.data.map((row) => row.project_type), ['individual', 'team', 'individual']);
  assert.equal(recurringAssignments.data.every((row) => row.all_day === true), true);
  for (const row of recurringAssignments.data) {
    assert.match(new Date(new Date(row.opens_at).valueOf() + 9 * 60 * 60 * 1000).toISOString(), /T00:00:00\.000Z$/);
    assert.match(new Date(new Date(row.due_at).valueOf() + 9 * 60 * 60 * 1000).toISOString(), /T23:59:59\.999Z$/);
  }
  const materializeByMember = await invokeFunction(clients.a, 'schedule-series', { action: 'materialize' });
  assert.equal(materializeByMember.response.status, 200, JSON.stringify(materializeByMember.payload));

  stage = 'submission-write individual markdown';
  const reportV1 = '# 통합 테스트 보고서\n\n첫 번째 본문';
  const invalidMarkdown = await invokeFunction(clients.a, 'submission-write', {
    assignment_id: individualAssignmentId, summary: '', code_repository_url: null,
    report_filename: 'report.pdf', report_markdown: reportV1,
  });
  assert.equal(invalidMarkdown.response.status, 400, 'server rejects non-Markdown filename');
  const frontmatterMarkdown = await invokeFunction(clients.a, 'submission-write', {
    assignment_id: individualAssignmentId, summary: '', code_repository_url: null,
    report_filename: 'report.md', report_markdown: '---\ntitle: injected\n---\nbody',
  });
  assert.equal(frontmatterMarkdown.response.status, 400, 'server rejects member-controlled frontmatter');

  const submissionWrite = await invokeFunction(clients.a, 'submission-write', {
    assignment_id: individualAssignmentId, summary: '개인 제출', code_repository_url: null,
    report_filename: 'report.md', report_markdown: reportV1,
  });
  assert.equal(submissionWrite.response.status, 200, JSON.stringify(submissionWrite.payload));
  assert.match(submissionWrite.payload.submission.version.toString(), /^1$/);
  const submissionId = submissionWrite.payload.submission.id;
  const firstVersion = submissionWrite.payload.submission.version;
  const draftStored = await admin.from('submissions')
    .select('title,report_filename,report_markdown,report_bytes,report_repository_url,report_path,submitted_ref,version')
    .eq('id', submissionId).single();
  assert.equal(draftStored.error, null, draftStored.error?.message);
  assert.equal(draftStored.data.title, '통합 테스트 개인 회차 수정', 'submission title is derived from the assignment');
  assert.equal(draftStored.data.report_filename, 'report.md');
  assert.equal(draftStored.data.report_markdown, reportV1);
  assert.equal(draftStored.data.report_bytes, new TextEncoder().encode(reportV1).byteLength);
  assert.equal(draftStored.data.report_repository_url, null, 'draft has no ProjectDB publication URL before approval');
  assert.equal(draftStored.data.report_path, null, 'draft has no member-supplied ProjectDB path');
  assert.equal(draftStored.data.submitted_ref, null, 'draft has no member-supplied commit ref');

  const reportV2 = '# 통합 테스트 보고서\n\n수정된 두 번째 본문';
  const resubmit = await invokeFunction(clients.a, 'submission-write', {
    assignment_id: individualAssignmentId, expected_version: firstVersion, summary: '수정 제출', code_repository_url: null,
    report_filename: 'revised.md', report_markdown: reportV2,
  });
  assert.equal(resubmit.response.status, 200, JSON.stringify(resubmit.payload));
  assert.equal(resubmit.payload.submission.version, firstVersion + 1);
  const currentVersion = resubmit.payload.submission.version;
  const revisedStored = await admin.from('submissions').select('report_filename,report_markdown,report_repository_url,report_path,submitted_ref').eq('id', submissionId).single();
  assert.equal(revisedStored.data.report_filename, 'revised.md');
  assert.equal(revisedStored.data.report_markdown, reportV2);
  assert.equal(revisedStored.data.report_repository_url, null);
  assert.equal(revisedStored.data.report_path, null);
  assert.equal(revisedStored.data.submitted_ref, null);

  const staleMemberSave = await invokeFunction(clients.a, 'submission-write', {
    assignment_id: individualAssignmentId, expected_version: firstVersion, summary: '', code_repository_url: null,
    report_filename: 'stale.md', report_markdown: '# 오래된 화면',
  });
  assert.equal(staleMemberSave.response.status, 409, 'stale member form must not overwrite a newer submission version');
  const ownSubmission = await clients.a.from('submissions').select('id,status').eq('id', submissionId);
  assert.equal(ownSubmission.error, null); assert.equal(ownSubmission.data.length, 1);
  const otherSubmission = await clients.b.from('submissions').select('id,status').eq('id', submissionId);
  assert.equal(otherSubmission.error, null); assert.equal(otherSubmission.data.length, 0, 'other member cannot read personal submission');
  const directReview = await clients.a.from('submissions').update({ status: 'approved' }).eq('id', submissionId);
  assert.notEqual(directReview.error, null, 'ordinary member cannot approve via PostgREST');

  stage = 'submission-admin approval';
  const staleReview = await invokeFunction(clients.staff, 'submission-admin', { action: 'review', submission_id: submissionId, expected_version: firstVersion, status: 'approved', review_note: 'stale review' });
  assert.equal(staleReview.response.status, 409, 'stale staff review must not approve a newer member submission');
  const review = await invokeFunction(clients.staff, 'submission-admin', { action: 'review', submission_id: submissionId, expected_version: currentVersion, status: 'approved', review_note: '통합 테스트 승인' });
  assert.equal(review.response.status, 200, JSON.stringify(review.payload));
  assert.equal(review.payload.status, 'approved');
  assert.equal(review.payload.projectdb_sync_status, 'failed', 'without a ProjectDB token approval remains valid but sync is marked failed');
  const persistedApproval = await admin.from('submissions').select('status,projectdb_sync_status').eq('id', submissionId).single();
  assert.equal(persistedApproval.data.status, 'approved');
  assert.equal(persistedApproval.data.projectdb_sync_status, 'failed');
  const overwriteApproved = await invokeFunction(clients.a, 'submission-write', {
    assignment_id: individualAssignmentId, summary: '', code_repository_url: null,
    report_filename: 'overwrite.md', report_markdown: '# 덮어쓰기',
  });
  assert.equal(overwriteApproved.response.status, 409, 'approved submission cannot be overwritten by member');

  stage = 'team-admin fixed team';
  const teamAdminDenied = await invokeFunction(clients.a, 'team-admin', { action: 'create_team', name: '금지된팀' });
  assert.equal(teamAdminDenied.response.status, 403, 'ordinary member cannot create teams');
  const teamCreate = await invokeFunction(clients.staff, 'team-admin', { action: 'create_team', name: '통합테스트팀' });
  assert.equal(teamCreate.response.status, 200, JSON.stringify(teamCreate.payload));
  const teamId = teamCreate.payload.team.id;
  const assignA = await invokeFunction(clients.staff, 'team-admin', { action: 'assign_member', team_id: teamId, profile_id: ids.a, expected_team_id: null });
  assert.equal(assignA.response.status, 200, JSON.stringify(assignA.payload));
  const assignB = await invokeFunction(clients.staff, 'team-admin', { action: 'assign_member', team_id: teamId, profile_id: ids.b, expected_team_id: null });
  assert.equal(assignB.response.status, 200, JSON.stringify(assignB.payload));
  const staleAssign = await invokeFunction(clients.staff, 'team-admin', { action: 'assign_member', team_id: teamId, profile_id: ids.a, expected_team_id: null });
  assert.equal(staleAssign.response.status, 409, `stale team move must not overwrite current membership: ${JSON.stringify(staleAssign.payload)}`);
  const ownTeamAfterAssignment = await clients.a.rpc('list_own_team_members', { target_semester: '2026-2' });
  assert.equal(ownTeamAfterAssignment.error, null, ownTeamAfterAssignment.error?.message);
  assert.deepEqual(ownTeamAfterAssignment.data.map((row) => row.member_id).sort(), [people.a.member_id, people.b.member_id].sort());

  stage = 'submission-write team markdown';
  const unassignedTeamWrite = await invokeFunction(resetGeneratedClient, 'submission-write', {
    assignment_id: teamAssignmentId, summary: '', code_repository_url: null,
    report_filename: 'team.md', report_markdown: '# 미배정 팀 프로젝트',
  });
  assert.equal(unassignedTeamWrite.response.status, 409, 'team submission requires a staff-assigned semester team');
  assert.match(String(unassignedTeamWrite.payload.error), /팀 미배정/);
  const teamWrite = await invokeFunction(clients.a, 'submission-write', {
    assignment_id: teamAssignmentId, summary: '팀 공동 제출', code_repository_url: null,
    report_filename: 'team-report.md', report_markdown: '# 팀 보고서\n\n공동 본문',
  });
  assert.equal(teamWrite.response.status, 200, JSON.stringify(teamWrite.payload));
  const teammateRead = await clients.b.from('submissions').select('id,title').eq('id', teamWrite.payload.submission.id);
  assert.equal(teammateRead.error, null); assert.equal(teammateRead.data.length, 1, 'confirmed teammate shares team submission visibility');

  stage = 'concurrent staff guard';
  const staff2Id = `s2${suffix}`;
  const staff2Password = 'SecondStaffPassword!123';
  const staff2Create = await invokeFunction(clients.staff, 'member-admin', {
    action: 'create', member_id: staff2Id, name: '두번째운영진', role: 'staff', active: true,
    semester_active: true, individual_required: false, team_required: false, temporary_password: staff2Password,
  });
  assert.equal(staff2Create.response.status, 200, JSON.stringify(staff2Create.payload));
  const staff2Profile = await admin.from('profiles').select('id,version').eq('member_id', staff2Id).single();
  assert.equal(staff2Profile.error, null); created.push(staff2Profile.data.id);
  const staff1Version = await admin.from('profiles').select('version').eq('id', ids.staff).single();
  assert.equal(staff1Version.error, null);
  const staff2Client = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
  const staff2Login = await staff2Client.auth.signInWithPassword({ email: email(staff2Id), password: staff2Password });
  assert.equal(staff2Login.error, null, staff2Login.error?.message);
  const [disableSecond, disableFirst] = await Promise.all([
    invokeFunction(clients.staff, 'member-admin', { action: 'update', member_id: staff2Id, expected_version: staff2Profile.data.version, active: false }),
    invokeFunction(staff2Client, 'member-admin', { action: 'update', member_id: people.staff.member_id, expected_version: staff1Version.data.version, active: false }),
  ]);
  assert.equal([disableSecond.response.ok, disableFirst.response.ok].filter(Boolean).length, 1, 'concurrent cross-deactivation must allow only one staff removal');
  const activeStaff = await admin.from('profiles').select('id').eq('role', 'staff').eq('active', true);
  assert.equal(activeStaff.error, null); assert.equal(activeStaff.data.length, 1, 'at least one active staff must remain after concurrent changes');

  console.log('Local Supabase integration checks passed: Auth/RLS/member-admin/submission-write/review durability/team sharing/concurrency guards.');
} catch (error) {
  console.error(`Local Supabase integration failed at stage: ${stage}`);
  throw error;
} finally {
  if (functionServer?.pid) {
    try { process.kill(-functionServer.pid, 'SIGTERM'); } catch {}
    await Promise.race([new Promise((resolve) => functionServer.once('exit', resolve)), sleep(1500)]);
    if (functionServer.exitCode === null) {
      try { process.kill(-functionServer.pid, 'SIGKILL'); } catch {}
    }
  }
  try { execFileSync('npx', ['--yes', 'supabase', 'db', 'reset', '--local'], { stdio: ['ignore', 'ignore', 'inherit'] }); } catch {}
}
