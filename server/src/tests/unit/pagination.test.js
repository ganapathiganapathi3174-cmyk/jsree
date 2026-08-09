import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { paginate, paginatedResponse } from '../../middleware/pagination.js';

describe('paginate middleware', () => {
  it('should set default page and limit', () => {
    const req = { query: {} };
    const res = {};
    paginate(req, res, () => {});
    assert.equal(req.pagination.page, 1);
    assert.equal(req.pagination.limit, 20);
    assert.equal(req.pagination.offset, 0);
  });

  it('should parse page and limit from query', () => {
    const req = { query: { page: '3', limit: '10' } };
    const res = {};
    paginate(req, res, () => {});
    assert.equal(req.pagination.page, 3);
    assert.equal(req.pagination.limit, 10);
    assert.equal(req.pagination.offset, 20);
  });

  it('should enforce minimum page of 1', () => {
    const req = { query: { page: '-5' } };
    const res = {};
    paginate(req, res, () => {});
    assert.equal(req.pagination.page, 1);
  });

  it('should enforce max limit of 100', () => {
    const req = { query: { limit: '500' } };
    const res = {};
    paginate(req, res, () => {});
    assert.equal(req.pagination.limit, 100);
  });

  it('should use default limit for zero value', () => {
    const req = { query: { limit: '0' } };
    const res = {};
    paginate(req, res, () => {});
    // parseInt('0') = 0, 0 || 20 = 20
    assert.equal(req.pagination.limit, 20);
  });
});

describe('paginatedResponse', () => {
  it('should return correct pagination structure', () => {
    const result = paginatedResponse([{ id: 1 }], 25, 2, 10);
    assert.equal(result.pagination.page, 2);
    assert.equal(result.pagination.limit, 10);
    assert.equal(result.pagination.total, 25);
    assert.equal(result.pagination.totalPages, 3);
    assert.equal(result.pagination.hasNext, true);
    assert.equal(result.pagination.hasPrev, true);
  });

  it('should set hasNext false on last page', () => {
    const result = paginatedResponse([{ id: 1 }], 25, 3, 10);
    assert.equal(result.pagination.hasNext, false);
    assert.equal(result.pagination.hasPrev, true);
  });

  it('should set hasPrev false on first page', () => {
    const result = paginatedResponse([{ id: 1 }], 25, 1, 10);
    assert.equal(result.pagination.hasNext, true);
    assert.equal(result.pagination.hasPrev, false);
  });
});
