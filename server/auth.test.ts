import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  isValidEmail,
  normalizeEmail,
  verifyPassword,
} from './auth';

test('password verification accepts the original password only', async () => {
  const hash = await hashPassword('a-secure-test-password');

  assert.equal(await verifyPassword('a-secure-test-password', hash), true);
  assert.equal(await verifyPassword('a-different-password', hash), false);
});

test('session tokens are random and stored as one-way hashes', () => {
  const first = createSessionToken();
  const second = createSessionToken();

  assert.notEqual(first, second);
  assert.notEqual(hashSessionToken(first), first);
  assert.equal(hashSessionToken(first).length, 64);
});

test('email normalization is case-insensitive and validates common addresses', () => {
  assert.equal(normalizeEmail('  Student@Example.edu  '), 'student@example.edu');
  assert.equal(isValidEmail('student@example.edu'), true);
  assert.equal(isValidEmail('not-an-email'), false);
});
