import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';

const path = new URL('../src/lib/member-domain.ts', import.meta.url);
const domain = existsSync(path) ? await import(path.href) : {};
function fn(name) {
  assert.equal(typeof domain[name], 'function', `${name} behavior has not been implemented`);
  return domain[name];
}
const profile = { id: 'a', member_id: '20261234', name: '테스트 부원', role: 'member', active: true, github_username: null };
const membership = { profile_id: 'a', semester: '2026-2', active: true, individual_required: true, team_required: true };
const assignments = [
  { id: 'personal', semester: '2026-2', project_type: 'individual', title: '개인 프로젝트', description: '', due_at: null, active: true, round_key: 'final' },
  { id: 'team', semester: '2026-2', project_type: 'team', title: '팀 프로젝트', description: '', due_at: null, active: true, round_key: 'final' },
];
const input = (overrides = {}) => ({ profile, membership, semester: '2026-2', assignments, submissions: [], teamIds: [], ...overrides });

test('issued IDs normalize without accepting emails or paths', () => {
  assert.equal(fn('memberIdToEmail')(' ASC-2026_01 '), 'asc-2026_01@members.asc.invalid');
  assert.equal(fn('memberIdToEmail')('20261234'), '20261234@members.asc.invalid');
  for (const value of ['', 'ab', '../admin', 'a@b.com', 'a b c', 'x'.repeat(33)]) {
    assert.throws(() => fn('memberIdToEmail')(value));
  }
});

test('membership requires matching identity and active account and semester enrollment', () => {
  assert.equal(fn('hasActiveMembership')(profile, membership, '2026-2'), true);
  assert.equal(fn('hasActiveMembership')({ ...profile, active: false }, membership, '2026-2'), false);
  assert.equal(fn('hasActiveMembership')(profile, { ...membership, profile_id: 'b' }, '2026-2'), false);
  assert.equal(fn('hasActiveMembership')(profile, { ...membership, active: false }, '2026-2'), false);
  assert.equal(fn('hasActiveMembership')(profile, membership, '2026-1'), false);
  assert.equal(fn('hasActiveMembership')(profile, null, '2026-2'), false);
});

test('staff privilege is not granted to ordinary or inactive profiles', () => {
  assert.equal(fn('isActiveStaff')(profile), false);
  assert.equal(fn('isActiveStaff')({ ...profile, role: 'staff' }), true);
  assert.equal(fn('isActiveStaff')({ ...profile, role: 'staff', active: false }), false);
  assert.equal(fn('isActiveStaff')(null), false);
});

test('missing individual submission and unassigned team are distinct', () => {
  const rows = fn('buildDashboardItems')(input());
  assert.equal(rows[0].state, 'not_submitted');
  assert.equal(rows[1].state, 'not_assigned');
});

test('joining a team does not count as submitting', () => {
  const rows = fn('buildDashboardItems')(input({ teamIds: ['t1'] }));
  assert.equal(rows[1].state, 'not_submitted');
});

test('non-participants and waived assignments are never counted as missing', () => {
  assert.deepEqual(fn('buildDashboardItems')(input({ membership: null })), []);
  const rows = fn('buildDashboardItems')(input({ membership: { ...membership, individual_required: false, team_required: false } }));
  assert.deepEqual(rows.map((row) => row.state), ['not_required', 'not_required']);
});

test('only own or confirmed-team submission affects displayed state', () => {
  const submissions = [
    { id: 's1', assignment_id: 'personal', owner_id: 'b', team_id: null, status: 'approved' },
    { id: 's2', assignment_id: 'team', owner_id: null, team_id: 'foreign-team', status: 'approved' },
  ];
  const rows = fn('buildDashboardItems')(input({ submissions, teamIds: ['t1'] }));
  assert.deepEqual(rows.map((row) => row.state), ['not_submitted', 'not_submitted']);
});

test('confirmed team shares its review state and own submission is selected', () => {
  const submissions = [
    { id: 's1', assignment_id: 'personal', owner_id: 'a', team_id: null, status: 'submitted' },
    { id: 's2', assignment_id: 'team', owner_id: null, team_id: 't1', status: 'revision_requested' },
  ];
  const rows = fn('buildDashboardItems')(input({ submissions, teamIds: ['t1'] }));
  assert.deepEqual(rows.map((row) => row.state), ['submitted', 'revision_requested']);
  assert.equal(rows[1].submission.id, 's2');
});

test('inactive and other-semester requirements do not enter current dashboard', () => {
  const rows = fn('buildDashboardItems')(input({ assignments: [...assignments, { ...assignments[0], id: 'old', semester: '2026-1' }, { ...assignments[0], id: 'inactive', active: false }] }));
  assert.equal(rows.length, 2);
});

test('unknown persisted status fails closed rather than claiming not submitted', () => {
  assert.throws(() => fn('buildDashboardItems')(input({ submissions: [{ id: 's1', assignment_id: 'personal', owner_id: 'a', team_id: null, status: 'unrecognized' }] })));
});

test('query errors are not converted to an empty successful result', () => {
  assert.throws(() => fn('requireQueryData')({ data: [], error: { message: 'network failure' } }, '제출 현황'));
  assert.deepEqual(fn('requireQueryData')({ data: [], error: null }, '제출 현황'), []);
  assert.throws(() => fn('requireQueryData')({ data: null, error: null }, '제출 현황'));
});

test('deadlines are explicit when absent and displayed in Korea time', () => {
  assert.equal(fn('formatDeadline')(null), '마감 미정');
  assert.match(fn('formatDeadline')('2026-09-15T15:00:00Z'), /09\. 16\.|9\. 16\./);
  assert.equal(fn('formatDeadline')('not-a-date'), '마감 확인 필요');
});

test('project window distinguishes upcoming open and overdue rounds', () => {
  const assignment = { opens_at: '2026-09-20T15:00:00.000Z', due_at: '2026-09-27T14:59:00.000Z' };
  assert.equal(fn('projectWindowState')(assignment, new Date('2026-09-20T14:59:59.000Z')), 'upcoming');
  assert.equal(fn('projectWindowState')(assignment, new Date('2026-09-21T00:00:00.000Z')), 'open');
  assert.equal(fn('projectWindowState')(assignment, new Date('2026-09-27T15:00:00.000Z')), 'overdue');
});

test('alternating project preview preserves duration and alternates types', () => {
  const preview = fn('generateAlternatingRounds')({
    firstOpensAt: '2026-09-20T15:00:00.000Z',
    firstDueAt: '2026-09-27T14:59:00.000Z',
    intervalWeeks: 1,
    count: 4,
    firstType: 'individual',
    titlePrefix: '프로젝트',
    description: '',
  });
  assert.deepEqual(preview.map((round) => round.project_type), ['individual', 'team', 'individual', 'team']);
  assert.deepEqual(preview.map((round) => round.title), ['프로젝트 1회차', '프로젝트 2회차', '프로젝트 3회차', '프로젝트 4회차']);
  assert.equal(new Date(preview[1].opens_at).valueOf() - new Date(preview[0].opens_at).valueOf(), 7 * 24 * 60 * 60 * 1000);
  assert.equal(new Date(preview[3].due_at).valueOf() - new Date(preview[3].opens_at).valueOf(), new Date(preview[0].due_at).valueOf() - new Date(preview[0].opens_at).valueOf());
});

test('late submission is based on first successful submission', () => {
  const assignment = { due_at: '2026-09-27T14:59:00.000Z' };
  assert.equal(fn('isLateSubmission')({ first_submitted_at: '2026-09-27T14:58:59.000Z' }, assignment), false);
  assert.equal(fn('isLateSubmission')({ first_submitted_at: '2026-09-27T15:00:00.000Z' }, assignment), true);
});

test('dashboard groups current upcoming and completed project rounds by action state', () => {
  const now = new Date('2026-10-10T12:00:00.000Z');
  const item = (id, opens_at, due_at, state, submission = null) => ({
    assignment: { id, semester: '2026-2', project_type: 'individual', title: id, description: '', opens_at, due_at, round_key: id, active: true, version: 1 },
    state,
    submission,
  });
  const groups = fn('groupDashboardItems')([
    item('open', '2026-10-09T00:00:00.000Z', '2026-10-11T23:59:00.000Z', 'not_submitted'),
    item('overdue', '2026-10-01T00:00:00.000Z', '2026-10-05T23:59:00.000Z', 'revision_requested', { id: 's1' }),
    item('approved', '2026-09-20T00:00:00.000Z', '2026-09-27T23:59:00.000Z', 'approved', { id: 's2' }),
    item('future', '2026-10-20T00:00:00.000Z', '2026-10-27T23:59:00.000Z', 'not_submitted'),
    item('waived', '2026-10-09T00:00:00.000Z', '2026-10-11T23:59:00.000Z', 'not_required'),
  ], now);
  assert.deepEqual(groups.current.map((entry) => entry.assignment.id), ['overdue', 'open']);
  assert.deepEqual(groups.upcoming.map((entry) => entry.assignment.id), ['future']);
  assert.deepEqual(groups.history.map((entry) => entry.assignment.id), ['approved']);
});

test('missing or secret browser configuration is rejected', () => {
  const config = fn('parseBrowserConfig');
  assert.equal(config('', '').ok, false);
  assert.equal(config('https://example.supabase.co', 'sb_secret_fake00000000').ok, false);
  assert.equal(config('https://user:password@example.supabase.co', 'sb_publishable_fake00000000').ok, false);
  assert.equal(config('http://example.com', 'sb_publishable_fake00000000').ok, false);
  assert.equal(config('https://example.supabase.co', 'sb_publishable_fake00000000').ok, true);
  assert.equal(config('http://127.0.0.1:54321', 'sb_publishable_fake00000000').ok, true);
  const jwt = (role) => `e30.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;
  assert.equal(config('https://example.supabase.co', jwt('service_role')).ok, false);
  assert.equal(config('https://example.supabase.co', jwt('anon')).ok, true);
});
