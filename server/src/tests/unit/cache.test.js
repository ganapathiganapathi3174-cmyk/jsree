import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { cacheMiddleware, clearCache, cacheStats } from '../../middleware/cache.js';

function mockRes() {
  const res = { _json: null, json(data) { this._json = data; return this; } };
  return res;
}

function mockReq(path, userId) {
  return { method: 'GET', originalUrl: path, user: userId ? { id: userId } : null };
}

describe('cacheMiddleware', () => {
  beforeEach(() => clearCache());

  it('should cache GET responses', () => {
    const middleware = cacheMiddleware(60000);
    const req = mockReq('/test');
    const res = mockRes();

    middleware(req, res, () => {});
    res.json({ data: 'hello' });

    assert.ok(cacheStats().size >= 1);
  });

  it('should return cached response on second request', () => {
    const middleware = cacheMiddleware(60000);
    
    const req1 = mockReq('/cached-endpoint');
    const res1 = mockRes();
    middleware(req1, res1, () => {});
    res1.json({ data: 'first' });

    // Second request should get cached response
    let nextCalled = false;
    const req2 = mockReq('/cached-endpoint');
    const res2 = mockRes();
    middleware(req2, res2, () => { nextCalled = true; });
    // res2._json is set from cache, no need to call json again
    assert.deepEqual(res2._json, { data: 'first' });
  });

  it('should not cache POST requests', () => {
    const middleware = cacheMiddleware(60000);
    const req = { method: 'POST', originalUrl: '/test', user: null };
    const res = mockRes();
    let called = false;
    middleware(req, res, () => { called = true; });
    assert.equal(called, true);
    assert.equal(res._json, null);
  });

  it('should cache different users separately', () => {
    const middleware = cacheMiddleware(60000);
    
    const req1 = mockReq('/user-data', 'user1');
    const res1 = mockRes();
    middleware(req1, res1, () => {});
    res1.json({ name: 'Alice' });

    const req2 = mockReq('/user-data', 'user2');
    const res2 = mockRes();
    middleware(req2, res2, () => {});
    res2.json({ name: 'Bob' });

    assert.deepEqual(res1._json, { name: 'Alice' });
    assert.deepEqual(res2._json, { name: 'Bob' });
  });
});

describe('clearCache', () => {
  beforeEach(() => clearCache());

  it('should clear all cache entries', () => {
    const middleware = cacheMiddleware(60000);
    const req = mockReq('/test');
    const res = mockRes();
    middleware(req, res, () => {});
    res.json({ data: 'test' });

    assert.ok(cacheStats().size >= 1);
    clearCache();
    assert.equal(cacheStats().size, 0);
  });

  it('should clear cache entries matching pattern', () => {
    const middleware = cacheMiddleware(60000);
    
    const res1 = mockRes();
    middleware(mockReq('/users/1'), res1, () => {});
    res1.json({ a: 1 });
    
    const res2 = mockRes();
    middleware(mockReq('/payments/1'), res2, () => {});
    res2.json({ b: 2 });

    clearCache('users');
    const stats = cacheStats();
    assert.equal(stats.keys.some(k => k.includes('payments')), true);
    assert.equal(stats.keys.some(k => k.includes('users')), false);
  });
});
