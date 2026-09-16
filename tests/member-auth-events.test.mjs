import assert from 'node:assert/strict';
import test from 'node:test';
import * as domain from '../src/lib/member-domain.ts';

test('password update does not unmount the form, sign-out clears private state', () => {
  assert.equal(typeof domain.authEventAction, 'function');
  assert.equal(domain.authEventAction('USER_UPDATED'), 'ignore');
  assert.equal(domain.authEventAction('SIGNED_OUT'), 'clear');
  for (const event of ['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED']) {
    assert.equal(domain.authEventAction(event), 'reload');
  }
});

test('new passwords require matching confirmation and sensible bounds', () => {
  assert.equal(typeof domain.validateNewPassword, 'function');
  assert.ok(domain.validateNewPassword('short', 'short'));
  assert.ok(domain.validateNewPassword('a'.repeat(129), 'a'.repeat(129)));
  assert.ok(domain.validateNewPassword('correct-password-1', 'different-password'));
  assert.ok(domain.validateNewPassword(' '.repeat(16), ' '.repeat(16)));
  assert.equal(domain.validateNewPassword('correct-password-1', 'correct-password-1'), null);
});
