import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ORIGINAL_LOCATION = window.location;

// jsdom's location is replaced with a minimal double. `href` must be absolute
// because axios resolves relative request URLs against location.href.
function stubLocation({ pathname, hrefWrites }) {
  const initialHref = `http://localhost${pathname}`;
  const state = { pathname, href: initialHref };
  const loc = {
    get pathname() { return state.pathname; },
    get href() { return state.href; },
    set href(value) {
      state.href = value;
      if (hrefWrites) hrefWrites.push(value);
    },
    get origin() { return 'http://localhost'; },
    get protocol() { return 'http:'; },
    get host() { return 'localhost'; },
    get search() { return ''; },
    get hash() { return ''; },
    assign() {},
    replace() {},
  };
  Object.defineProperty(window, 'location', { configurable: true, writable: true, value: loc });
  return { state, initialHref };
}

// Drive the real axios instance through its response interceptor by making the
// adapter reject with a well-formed 401, exactly as the network layer would.
function reject401(api, url) {
  api.defaults.adapter = (config) => Promise.reject(Object.assign(new Error('Request failed with status code 401'), {
    config,
    isAxiosError: true,
    response: {
      status: 401,
      statusText: 'Unauthorized',
      config,
      headers: {},
      data: { success: false, code: 'TOKEN_REQUIRED', message: 'Authentication token required' },
    },
  }));
  return api.post(url, {});
}

async function loadApi() {
  vi.resetModules();
  return import('./api');
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'stored-session-token');
  localStorage.setItem('user', JSON.stringify({ id: 'u1' }));
});

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, writable: true, value: ORIGINAL_LOCATION });
  vi.restoreAllMocks();
});

describe('401 interceptor — public flows are never hijacked', () => {
  it('does not redirect or clear the session when a public auth endpoint returns 401', async () => {
    const writes = [];
    const { initialHref } = stubLocation({ pathname: '/register', hrefWrites: writes });
    const { default: api } = await loadApi();

    await expect(reject401(api, '/auth/register')).rejects.toMatchObject({ response: { status: 401 } });

    expect(writes).toEqual([]);
    expect(window.location.href).toBe(initialHref);
    expect(localStorage.getItem('token')).toBe('stored-session-token');
    expect(localStorage.getItem('user')).toBe(JSON.stringify({ id: 'u1' }));
  });

  it('never redirects merely because a public endpoint returns 401', async () => {
    const writes = [];
    const { initialHref } = stubLocation({ pathname: '/register', hrefWrites: writes });
    const { default: api } = await loadApi();

    await expect(reject401(api, '/payments')).rejects.toMatchObject({ response: { status: 401 } });

    expect(writes).toEqual([]);
    expect(window.location.href).toBe(initialHref);
    expect(localStorage.getItem('token')).toBe('stored-session-token');
  });

  it('preserves the original error body so the page can show the real message', async () => {
    stubLocation({ pathname: '/register' });
    const { default: api } = await loadApi();

    const err = await reject401(api, '/auth/login').catch((e) => e);
    expect(err.response.status).toBe(401);
    expect(err.response.data.code).toBe('TOKEN_REQUIRED');
    expect(err.response.data.message).toBe('Authentication token required');
  });

  it('ignores a 401 on any non-protected route', async () => {
    const writes = [];
    const { initialHref } = stubLocation({ pathname: '/payment-status', hrefWrites: writes });
    const { default: api } = await loadApi();

    await expect(reject401(api, '/payments')).rejects.toMatchObject({ response: { status: 401 } });
    expect(writes).toEqual([]);
    expect(window.location.href).toBe(initialHref);
    expect(localStorage.getItem('token')).toBe('stored-session-token');
  });
});

describe('401 interceptor — protected routes keep the expiry behaviour', () => {
  it('clears the expired session and redirects a dashboard 401 to /login', async () => {
    const writes = [];
    stubLocation({ pathname: '/dashboard', hrefWrites: writes });
    const { default: api } = await loadApi();

    await expect(reject401(api, '/users/profile')).rejects.toMatchObject({ response: { status: 401 } });

    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    expect(writes).toEqual(['/login']);
  });

  it('redirects an admin route 401 to /admin/login', async () => {
    const writes = [];
    stubLocation({ pathname: '/admin/payments', hrefWrites: writes });
    const { default: api } = await loadApi();

    await expect(reject401(api, '/admin/users')).rejects.toMatchObject({ response: { status: 401 } });
    expect(writes).toEqual(['/admin/login']);
  });

  it('redirects only once for a burst of parallel 401s', async () => {
    const writes = [];
    stubLocation({ pathname: '/dashboard', hrefWrites: writes });
    const { default: api } = await loadApi();

    await Promise.all([
      reject401(api, '/users/profile').catch(() => {}),
      reject401(api, '/payments').catch(() => {}),
      reject401(api, '/users/profile').catch(() => {}),
    ]);

    expect(writes).toEqual(['/login']);
  });

  it('does not redirect on a non-401 failure', async () => {
    const writes = [];
    stubLocation({ pathname: '/dashboard', hrefWrites: writes });
    const { default: api } = await loadApi();
    api.defaults.adapter = () => Promise.reject(Object.assign(new Error('boom'), {
      config: { url: '/users/profile' },
      response: { status: 500, data: { message: 'Server error' }, config: { url: '/users/profile' } },
    }));

    await expect(api.get('/users/profile')).rejects.toMatchObject({ response: { status: 500 } });
    expect(writes).toEqual([]);
    expect(localStorage.getItem('token')).toBe('stored-session-token');
  });
});

describe('classify401 decision table', () => {
  it('maps requests to the right action', async () => {
    const { classify401, isPublicAuthRequest, isProtectedRoute } = await loadApi();

    expect(classify401('/register', { url: '/auth/register' })).toBe('ignore');
    expect(classify401('/register', { url: '/auth/login' })).toBe('ignore');
    expect(classify401('/login', { url: '/auth/admin-login' })).toBe('ignore');
    expect(classify401('/register', { url: '/payments' })).toBe('ignore');
    expect(classify401('/', { url: '/config/public' })).toBe('ignore');
    expect(classify401('/payment-status', { url: '/payments' })).toBe('ignore');

    expect(classify401('/dashboard', { url: '/users/profile' })).toBe('expire-session');
    expect(classify401('/admin/payments', { url: '/admin/users' })).toBe('expire-session');
    expect(classify401('/dashboard/extra', { url: '/payments' })).toBe('expire-session');

    expect(isPublicAuthRequest({ url: '/auth/register' })).toBe(true);
    expect(isPublicAuthRequest({ url: '/auth/register?plan=120' })).toBe(true);
    expect(isPublicAuthRequest({ url: '/auth/logout' })).toBe(false);
    expect(isProtectedRoute('/dashboard')).toBe(true);
    expect(isProtectedRoute('/register')).toBe(false);
    expect(isProtectedRoute('/dashboardx')).toBe(false);
  });
});

describe('every protected route declared in App.jsx is covered', () => {
  // Derived from the real route table so this test stays in sync with App.jsx
  // instead of hard-coding a list that can silently drift out of date.
  const appPath = (() => {
    const candidates = [
      resolve(process.cwd(), 'src/App.jsx'),
      resolve(process.cwd(), 'client/src/App.jsx'),
    ];
    const found = candidates.find((p) => existsSync(p));
    if (!found) throw new Error(`App.jsx not found; tried: ${candidates.join(', ')}`);
    return found;
  })();

  const readRoutes = () => {
    const source = readFileSync(appPath, 'utf8');
    return source
      .split('\n')
      .filter((line) => line.includes('<Route path='))
      .map((line) => ({
        path: (line.match(/path="([^"]+)"/) || [])[1],
        protected: line.includes('<ProtectedRoute'),
      }))
      .filter((route) => route.path);
  };

  it('finds the full route table (regression guard on the parser itself)', () => {
    const routes = readRoutes();
    const protectedRoutes = routes.filter((r) => r.protected);
    expect(routes.length).toBeGreaterThanOrEqual(29);
    expect(protectedRoutes).toHaveLength(23);
    expect(protectedRoutes.filter((r) => r.path === '/dashboard')).toHaveLength(1);
    expect(protectedRoutes.filter((r) => r.path === '/admin')).toHaveLength(1);
    expect(routes.filter((r) => !r.protected).map((r) => r.path).sort()).toEqual([
      '*', '/', '/admin/login', '/login', '/payment-status', '/register',
    ]);
  });

  it('classifies every protected user route as session-expiring', async () => {
    const { classify401, isProtectedRoute } = await loadApi();
    const userRoutes = readRoutes().filter((r) => r.protected && r.path.startsWith('/dashboard'));

    expect(userRoutes.map((r) => r.path)).toEqual([
      '/dashboard',
      '/dashboard/profile',
      '/dashboard/payment',
      '/dashboard/topups',
      '/dashboard/referrals',
      '/dashboard/plan-change',
      '/dashboard/chat',
      '/dashboard/history',
      '/dashboard/wallet',
      '/dashboard/notifications',
      '/dashboard/receipts',
      '/dashboard/security',
    ]);

    for (const route of userRoutes) {
      expect(isProtectedRoute(route.path), `${route.path} must be protected`).toBe(true);
      expect(classify401(route.path, { url: '/users/profile' }), `${route.path} must expire`).toBe('expire-session');
      expect(classify401(route.path, { url: '/payments' }), `${route.path} must expire`).toBe('expire-session');
    }
  });

  it('classifies every protected admin route as session-expiring', async () => {
    const { classify401, isProtectedRoute } = await loadApi();
    const adminRoutes = readRoutes().filter((r) => r.protected && r.path.startsWith('/admin'));

    expect(adminRoutes.map((r) => r.path)).toEqual([
      '/admin',
      '/admin/users',
      '/admin/payments',
      '/admin/topups',
      '/admin/inactive-users',
      '/admin/plan-changes',
      '/admin/chat',
      '/admin/audit-logs',
      '/admin/financial-reports',
      '/admin/suspicious-activity',
      '/admin/payment-settings',
    ]);

    for (const route of adminRoutes) {
      expect(isProtectedRoute(route.path), `${route.path} must be protected`).toBe(true);
      expect(classify401(route.path, { url: '/admin/users' }), `${route.path} must expire`).toBe('expire-session');
      expect(classify401(route.path, { url: '/users/profile' }), `${route.path} must expire`).toBe('expire-session');
    }
  });

  it('never treats a public route as session-expiring', async () => {
    const { classify401, isProtectedRoute } = await loadApi();
    const publicRoutes = readRoutes().filter((r) => !r.protected).map((r) => r.path);

    for (const path of publicRoutes) {
      expect(isProtectedRoute(path), `${path} must stay public`).toBe(false);
      expect(classify401(path, { url: '/users/profile' }), `${path} must not expire`).toBe('ignore');
      expect(classify401(path, { url: '/payments' }), `${path} must not expire`).toBe('ignore');
    }
  });

  it('does not expire a session while standing on the login screens', async () => {
    const { classify401, isProtectedRoute } = await loadApi();

    expect(isProtectedRoute('/login')).toBe(false);
    expect(isProtectedRoute('/admin/login')).toBe(false);
    expect(classify401('/admin/login', { url: '/users/profile' })).toBe('ignore');
    expect(classify401('/login', { url: '/payments' })).toBe('ignore');
  });
});

describe('session expiry guard lifecycle', () => {
  it('resets after a successful response so a later expiry is still handled', async () => {
    const writes = [];
    stubLocation({ pathname: '/dashboard', hrefWrites: writes });
    const { default: api } = await loadApi();

    // 1. session expires
    await expect(reject401(api, '/users/profile')).rejects.toMatchObject({ response: { status: 401 } });
    expect(writes).toEqual(['/login']);

    // 2. a successful response arrives (the user logged back in)
    api.defaults.adapter = (config) => Promise.resolve({
      status: 200, statusText: 'OK', config, headers: {},
      data: { success: true, data: { ok: true } },
    });
    await api.get('/users/profile');
    expect(localStorage.getItem('token')).toBeNull();

    // 3. the next real expiry is handled again, not swallowed by a stale flag
    await expect(reject401(api, '/users/profile')).rejects.toMatchObject({ response: { status: 401 } });
    expect(writes).toEqual(['/login', '/login']);
  });

  it('a public-route 401 does not arm the expiry guard', async () => {
    const writes = [];
    stubLocation({ pathname: '/register', hrefWrites: writes });
    const { default: api } = await loadApi();

    await expect(reject401(api, '/auth/register')).rejects.toMatchObject({ response: { status: 401 } });
    expect(writes).toEqual([]);
    expect(localStorage.getItem('token')).toBe('stored-session-token');
  });
});

describe('bearer token handling', () => {
  it('sends the latest stored token on every request', async () => {
    stubLocation({ pathname: '/register' });
    const { default: api } = await loadApi();
    const seen = [];
    api.defaults.adapter = (config) => {
      seen.push(config.headers.Authorization);
      return Promise.resolve({ status: 200, statusText: 'OK', config, headers: {}, data: {} });
    };

    localStorage.setItem('token', 'first-token');
    await api.get('/config/public');
    localStorage.setItem('token', 'second-token');
    await api.get('/config/public');
    localStorage.removeItem('token');
    await api.get('/config/public');

    expect(seen).toEqual(['Bearer first-token', 'Bearer second-token', undefined]);
  });

  it('an explicit Authorization header matches what the interceptor would send', async () => {
    stubLocation({ pathname: '/register' });
    const { default: api } = await loadApi();
    const seen = [];
    api.defaults.adapter = (config) => {
      seen.push(config.headers.Authorization);
      return Promise.resolve({ status: 200, statusText: 'OK', config, headers: {}, data: {} });
    };

    localStorage.setItem('token', 'fresh-token');
    await api.post('/payments', { plan: '120' }, { headers: { Authorization: 'Bearer fresh-token' } });

    expect(seen).toEqual(['Bearer fresh-token']);
  });
});
