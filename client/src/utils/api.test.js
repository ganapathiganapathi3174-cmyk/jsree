import { describe, it, expect, vi, afterEach } from 'vitest';
import api, { REQUEST_TIMEOUT_MS, isTimeoutError } from './api';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('api client', () => {
  it('has a finite timeout so no request can hang forever', () => {
    expect(api.defaults.timeout).toBe(REQUEST_TIMEOUT_MS);
    expect(REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('aborts a request that never responds', async () => {
    vi.useFakeTimers();

    class HangingXHR {
      constructor() { this.headers = {}; this.upload = { addEventListener() {} }; }
      open(method, url) { this.method = method; this.url = url; }
      setRequestHeader(k, v) { this.headers[k] = v; }
      addEventListener() {}
      send() { this.timer = setTimeout(() => this.ontimeout && this.ontimeout(), this.timeout); }
      abort() { clearTimeout(this.timer); if (this.onabort) this.onabort(); }
      getAllResponseHeaders() { return ''; }
    }
    vi.stubGlobal('XMLHttpRequest', HangingXHR);

    const pending = api.post('/payments/abc/screenshot', new FormData());
    const assertion = expect(pending).rejects.toMatchObject({ code: 'ECONNABORTED' });

    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 10);
    await assertion;
  });

  it('recognises timeout errors', () => {
    expect(isTimeoutError({ code: 'ECONNABORTED' })).toBe(true);
    expect(isTimeoutError({ code: 'ETIMEDOUT' })).toBe(true);
    expect(isTimeoutError({ code: 'ERR_CANCELED' })).toBe(true);
    expect(isTimeoutError(new Error('nope'))).toBe(false);
    expect(isTimeoutError(undefined)).toBe(false);
  });
});
