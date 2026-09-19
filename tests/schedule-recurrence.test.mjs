import test from 'node:test';
import assert from 'node:assert/strict';
import { generateScheduleOccurrences } from '../shared/schedule-recurrence.ts';

test('daily recurrence preserves duration and count', () => {
  const rows = generateScheduleOccurrences({
    first_start_at: '2026-09-21T09:00:00.000Z', first_end_at: '2026-09-21T10:00:00.000Z',
    recurrence_frequency: 'daily', recurrence_interval: 2, weekdays: [], end_mode: 'count', occurrence_count: 3, until_at: null,
  });
  assert.equal(rows.length, 3);
  assert.equal(new Date(rows[1].start_at).valueOf() - new Date(rows[0].start_at).valueOf(), 2 * 24 * 60 * 60 * 1000);
  assert.equal(new Date(rows[0].end_at).valueOf() - new Date(rows[0].start_at).valueOf(), 60 * 60 * 1000);
});

test('weekly recurrence supports multiple weekdays', () => {
  const rows = generateScheduleOccurrences({
    first_start_at: '2026-09-21T09:00:00.000Z', first_end_at: '2026-09-21T10:00:00.000Z',
    recurrence_frequency: 'weekly', recurrence_interval: 1, weekdays: [1, 3], end_mode: 'count', occurrence_count: 4, until_at: null,
  });
  assert.equal(rows.length, 4);
  const weekdays = rows.map((row) => new Date(new Date(row.start_at).valueOf() + 9 * 60 * 60 * 1000).getUTCDay());
  assert.deepEqual(weekdays, [1, 3, 1, 3]);
});

test('never recurrence is bounded by rolling horizon', () => {
  const rows = generateScheduleOccurrences({
    first_start_at: '2026-09-20T00:00:00.000Z', first_end_at: '2026-09-20T01:00:00.000Z',
    recurrence_frequency: 'daily', recurrence_interval: 1, weekdays: [], end_mode: 'never', occurrence_count: null, until_at: null,
  }, { horizon_at: '2026-09-23T00:00:00.000Z' });
  assert.equal(rows.length, 4);
});

test('monthly recurrence clamps end-of-month dates', () => {
  const rows = generateScheduleOccurrences({
    first_start_at: '2026-01-30T16:00:00.000Z', first_end_at: '2026-01-30T17:00:00.000Z',
    recurrence_frequency: 'monthly', recurrence_interval: 1, weekdays: [], end_mode: 'count', occurrence_count: 3, until_at: null,
  });
  assert.equal(rows.length, 3);
  assert.match(rows[1].start_at, /^2026-02-27T16:00:00\.000Z$/);
});
