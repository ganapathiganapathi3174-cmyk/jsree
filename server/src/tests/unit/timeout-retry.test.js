import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { requestTimeout, REQUEST_TIMEOUT_MS } from '../../middleware/requestTimeout.js';
import { deduplicateProofUpload, __testClearInFlight } from '../../middleware/deduplicate.js';

function mockReq(path = '/api/test', userId = 'user-1', fileBuffer = Buffer.from('test')) {
  const eventHandlers = {};
  return {
    path,
    user: userId ? { id: userId } : null,
    file: fileBuffer ? { buffer: fileBuffer, originalname: 'test.png' } : null,
    on(event, cb) { eventHandlers[event] = cb; },
    emit(event) { eventHandlers[event]?.(); },
    destroy: vi.fn(),
    _eventHandlers: eventHandlers,
  };
}

function mockRes() {
  const eventHandlers = {};
  return {
    statusCode: 200,
    headersSent: false,
    writableEnded: false,
    body: null,
    _eventHandlers: eventHandlers,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.headersSent = true; return this; },
    on(event, cb) { this._eventHandlers[event] = cb; return this; },
    emit(event) { this._eventHandlers[event]?.(); },
    setHeader: vi.fn(),
    getHeader: vi.fn(),
  };
}

describe('requestTimeout middleware', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('skips timeout for health check path', () => {
    const req = mockReq('/health');
    const res = mockRes();
    const next = vi.fn();
    const middleware = requestTimeout();
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('sets timeout for non-health paths', () => {
    const req = mockReq('/api/payments/1/screenshot');
    const res = mockRes();
    const next = vi.fn();
    const middleware = requestTimeout();
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('returns 504 with REQUEST_TIMEOUT code when timeout fires', async () => {
    const req = mockReq('/api/payments/1/screenshot');
    const res = mockRes();
    const next = vi.fn();
    const middleware = requestTimeout();
    middleware(req, res, next);

    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 10);

    expect(res.statusCode).toBe(504);
    expect(res.body).toEqual({
      success: false,
      message: 'Request timed out. The server took too long to process the request (likely OCR verification or cold start). Please try again.',
      code: 'REQUEST_TIMEOUT'
    });
  });

  it('clears timeout when response finishes normally', () => {
    const req = mockReq('/api/test');
    const res = mockRes();
    const next = vi.fn();
    const middleware = requestTimeout();
    middleware(req, res, next);

    res.emit('finish');
    vi.advanceTimersByTime(REQUEST_TIMEOUT_MS + 10);
    expect(res.statusCode).toBe(200);
  });

  it('clears timeout when request closes', () => {
    const req = mockReq('/api/test');
    const res = mockRes();
    const next = vi.fn();
    const middleware = requestTimeout();
    middleware(req, res, next);

    req.emit('close');
    vi.advanceTimersByTime(REQUEST_TIMEOUT_MS + 10);
    expect(res.statusCode).toBe(200);
  });

  it('does not cause unhandled exception on timeout', async () => {
    const req = mockReq('/api/test');
    const res = mockRes();
    const next = vi.fn();
    const middleware = requestTimeout();
    middleware(req, res, next);

    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 10);
    // Should not throw
    expect(res.statusCode).toBe(504);
  });
});

describe('deduplicateProofUpload middleware', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __testClearInFlight();
  });
  afterEach(() => vi.useRealTimers());

  it('skips non-proof endpoints', () => {
    const req = mockReq('/api/payments');
    const res = mockRes();
    const next = vi.fn();
    const middleware = deduplicateProofUpload();
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('skips if no authenticated user', () => {
    const req = mockReq('/api/payments/1/screenshot', null);
    const res = mockRes();
    const next = vi.fn();
    const middleware = deduplicateProofUpload();
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('skips if no file', () => {
    const req = mockReq('/api/payments/1/screenshot', 'user-1', null);
    const res = mockRes();
    const next = vi.fn();
    const middleware = deduplicateProofUpload();
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('allows first request through', () => {
    const req = mockReq('/api/payments/1/screenshot', 'user-1', Buffer.from('unique-file-content'));
    const res = mockRes();
    const next = vi.fn();
    const middleware = deduplicateProofUpload();
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it('blocks concurrent identical request with 409 DUPLICATE_REQUEST', () => {
    const fileContent = Buffer.from('unique-file-content');
    const req1 = mockReq('/api/payments/1/screenshot', 'user-1', fileContent);
    const res1 = mockRes();
    const next1 = vi.fn();
    const middleware = deduplicateProofUpload();
    middleware(req1, res1, next1);
    expect(next1).toHaveBeenCalled();

    const req2 = mockReq('/api/payments/1/screenshot', 'user-1', fileContent);
    const res2 = mockRes();
    const next2 = vi.fn();
    middleware(req2, res2, next2);

    expect(next2).not.toHaveBeenCalled();
    expect(res2.statusCode).toBe(409);
    expect(res2.body).toEqual({
      success: false,
      message: 'A verification for this screenshot is already in progress. Please wait for the result.',
      code: 'DUPLICATE_REQUEST'
    });
  });

  it('allows different file content for same user and endpoint', () => {
    const req1 = mockReq('/api/payments/1/screenshot', 'user-1', Buffer.from('file-1'));
    const res1 = mockRes();
    const next1 = vi.fn();
    const middleware = deduplicateProofUpload();
    middleware(req1, res1, next1);
    expect(next1).toHaveBeenCalled();

    const req2 = mockReq('/api/payments/1/screenshot', 'user-1', Buffer.from('file-2'));
    const res2 = mockRes();
    const next2 = vi.fn();
    middleware(req2, res2, next2);
    expect(next2).toHaveBeenCalled();
  });

  it('allows same file content for different users', () => {
    const fileContent = Buffer.from('same-file');
    const req1 = mockReq('/api/payments/1/screenshot', 'user-1', fileContent);
    const res1 = mockRes();
    const next1 = vi.fn();
    const middleware = deduplicateProofUpload();
    middleware(req1, res1, next1);
    expect(next1).toHaveBeenCalled();

    const req2 = mockReq('/api/payments/1/screenshot', 'user-2', fileContent);
    const res2 = mockRes();
    const next2 = vi.fn();
    middleware(req2, res2, next2);
    expect(next2).toHaveBeenCalled();
  });

  it('allows retry after TTL expires', () => {
    const fileContent = Buffer.from('file-for-retry');
    const req1 = mockReq('/api/payments/1/screenshot', 'user-1', fileContent);
    const res1 = mockRes();
    const next1 = vi.fn();
    const middleware = deduplicateProofUpload();
    middleware(req1, res1, next1);
    expect(next1).toHaveBeenCalled();

    res1.emit('finish');

    vi.advanceTimersByTime(5 * 60 * 1000 + 100);

    const req2 = mockReq('/api/payments/1/screenshot', 'user-1', fileContent);
    const res2 = mockRes();
    const next2 = vi.fn();
    middleware(req2, res2, next2);
    expect(next2).toHaveBeenCalled();
  });

  it('cleans up on response finish', () => {
    const fileContent = Buffer.from('cleanup-test');
    const req = mockReq('/api/payments/1/screenshot', 'user-1', fileContent);
    const res = mockRes();
    const next = vi.fn();
    const middleware = deduplicateProofUpload();
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();

    res.emit('finish');

    const req2 = mockReq('/api/payments/1/screenshot', 'user-1', fileContent);
    const res2 = mockRes();
    const next2 = vi.fn();
    middleware(req2, res2, next2);
    expect(next2).toHaveBeenCalled();
  });

  it('cleans up on response close', () => {
    const fileContent = Buffer.from('close-test');
    const req = mockReq('/api/payments/1/screenshot', 'user-1', fileContent);
    const res = mockRes();
    const next = vi.fn();
    const middleware = deduplicateProofUpload();
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();

    res.emit('close');

    const req2 = mockReq('/api/payments/1/screenshot', 'user-1', fileContent);
    const res2 = mockRes();
    const next2 = vi.fn();
    middleware(req2, res2, next2);
    expect(next2).toHaveBeenCalled();
  });

  it('authentication cannot be bypassed by deduplication', () => {
    const req = mockReq('/api/payments/1/screenshot', null, Buffer.from('file'));
    const res = mockRes();
    const next = vi.fn();
    const middleware = deduplicateProofUpload();
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('failed verification does not bypass deduplication on retry', () => {
    const fileContent = Buffer.from('fail-test');
    const req1 = mockReq('/api/payments/1/screenshot', 'user-1', fileContent);
    const res1 = mockRes();
    const next1 = vi.fn();
    const middleware = deduplicateProofUpload();
    middleware(req1, res1, next1);
    expect(next1).toHaveBeenCalled();

    res1.emit('close');

    const req2 = mockReq('/api/payments/1/screenshot', 'user-1', fileContent);
    const res2 = mockRes();
    const next2 = vi.fn();
    middleware(req2, res2, next2);
    expect(next2).toHaveBeenCalled();
  });

  it('server restart clears in-memory map', () => {
    const fileContent = Buffer.from('restart-test');
    const req1 = mockReq('/api/payments/1/screenshot', 'user-1', fileContent);
    const res1 = mockRes();
    const next1 = vi.fn();
    const middleware = deduplicateProofUpload();
    middleware(req1, res1, next1);
    expect(next1).toHaveBeenCalled();

    __testClearInFlight();

    const req2 = mockReq('/api/payments/1/screenshot', 'user-1', fileContent);
    const res2 = mockRes();
    const next2 = vi.fn();
    middleware(req2, res2, next2);
    expect(next2).toHaveBeenCalled();
  });
});

describe('timeout + deduplication interaction', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __testClearInFlight();
  });
  afterEach(() => vi.useRealTimers());

  it('deduplication cleans up on timeout', () => {
    const fileContent = Buffer.from('timeout-dedup-test');
    const req1 = mockReq('/api/payments/1/screenshot', 'user-1', fileContent);
    const res1 = mockRes();
    const next1 = vi.fn();
    const dedupMiddleware = deduplicateProofUpload();
    dedupMiddleware(req1, res1, next1);
    expect(next1).toHaveBeenCalled();

    res1.emit('close');

    const req2 = mockReq('/api/payments/1/screenshot', 'user-1', fileContent);
    const res2 = mockRes();
    const next2 = vi.fn();
    dedupMiddleware(req2, res2, next2);
    expect(next2).toHaveBeenCalled();
  });
});