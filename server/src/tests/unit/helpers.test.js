import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, comparePassword, generateToken, verifyToken, generateReferralCode, isWithinTimeWindow } from '../../utils/helpers.js';

describe('hashPassword', () => {
  it('should hash a password', async () => {
    const hash = await hashPassword('test123');
    assert.ok(hash);
    assert.ok(hash.startsWith('$2'));
    assert.notEqual(hash, 'test123');
  });

  it('should produce different hashes for same input', async () => {
    const h1 = await hashPassword('test123');
    const h2 = await hashPassword('test123');
    assert.notEqual(h1, h2);
  });
});

describe('comparePassword', () => {
  it('should return true for correct password', async () => {
    const hash = await hashPassword('mypassword');
    const result = await comparePassword('mypassword', hash);
    assert.equal(result, true);
  });

  it('should return false for wrong password', async () => {
    const hash = await hashPassword('mypassword');
    const result = await comparePassword('wrongpassword', hash);
    assert.equal(result, false);
  });
});

describe('generateToken', () => {
  it('should generate a valid JWT token', () => {
    const token = generateToken({ userId: '123', role: 'user' });
    assert.ok(token);
    assert.ok(typeof token === 'string');
    assert.ok(token.split('.').length === 3);
  });
});

describe('verifyToken', () => {
  it('should verify a valid token', () => {
    const payload = { userId: '123', role: 'user' };
    const token = generateToken(payload);
    const decoded = verifyToken(token);
    assert.equal(decoded.userId, '123');
    assert.equal(decoded.role, 'user');
  });

  it('should return null for invalid token', () => {
    const result = verifyToken('invalid.token.here');
    assert.equal(result, null);
  });
});

describe('generateReferralCode', () => {
  it('should generate a code starting with REF', () => {
    const code = generateReferralCode();
    assert.ok(code.startsWith('REF'));
    assert.equal(code.length, 9);
  });

  it('should generate unique codes', () => {
    const codes = new Set();
    for (let i = 0; i < 100; i++) codes.add(generateReferralCode());
    assert.equal(codes.size, 100);
  });
});

describe('isWithinTimeWindow', () => {
  it('should return true for recent timestamps', () => {
    const now = new Date();
    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);
    assert.equal(isWithinTimeWindow(fiveMinAgo, now, 30), true);
  });

  it('should return true for current timestamp', () => {
    const now = new Date();
    assert.equal(isWithinTimeWindow(now, now, 30), true);
  });

  it('should return false for timestamps outside window', () => {
    const now = new Date();
    const old = new Date(now.getTime() - 60 * 60 * 1000);
    assert.equal(isWithinTimeWindow(old, now, 30), false);
  });

  it('should return true for future timestamps within +30 min', () => {
    const now = new Date();
    const future = new Date(now.getTime() + 5 * 60 * 1000);
    assert.equal(isWithinTimeWindow(future, now, 30), true);
  });

  it('should return false for future timestamps beyond +30 min', () => {
    const now = new Date();
    const future = new Date(now.getTime() + 31 * 60 * 1000);
    assert.equal(isWithinTimeWindow(future, now, 30), false);
  });
});
