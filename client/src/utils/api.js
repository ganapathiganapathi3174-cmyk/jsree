import axios from 'axios';

// Never allow a request to hang forever: the verification endpoints run OCR on
// the server and can take tens of seconds (or stall on a cold start), which
// previously left the UI stuck on its submitting state with no way out.
// Increased to 240s to accommodate: Render cold start (30-60s) + full OCR pipeline (50-100s) + network overhead.
export const REQUEST_TIMEOUT_MS = 240000;

export function isTimeoutError(err) {
  return err?.code === 'ECONNABORTED' || err?.code === 'ETIMEDOUT' || err?.code === 'ERR_CANCELED';
}

// Endpoints that are called while the visitor is NOT authenticated. A 401 from
// one of these is a normal, actionable API answer (bad credentials, stale
// session during registration) and must reach the calling page untouched.
export const PUBLIC_AUTH_PATHS = ['/auth/register', '/auth/login', '/auth/admin-login'];

// Application routes that only exist for an authenticated session. Only here
// does an expired token mean "session over, go log in again".
// Mirrors App.jsx: every protected user route is /dashboard/* and every
// protected admin route is /admin/* (there are no /user/* routes).
export const PROTECTED_ROUTE_PREFIXES = ['/dashboard', '/admin'];

// The auth screens themselves are never a place to expire a session: a 401
// seen while standing on /login or /admin/login is just the page doing its job.
export const PUBLIC_ROUTE_PATHS = ['/login', '/admin/login'];

export function isPublicAuthRequest(config) {
  const url = String(config?.url || '');
  return PUBLIC_AUTH_PATHS.some((path) => url === path || url.startsWith(`${path}?`));
}

export function isProtectedRoute(pathname) {
  const path = String(pathname || '');
  if (PUBLIC_ROUTE_PATHS.some((route) => path === route)) return false;
  return PROTECTED_ROUTE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

// Pure decision for a 401. Kept separate from the interceptor so the rules can
// be unit-tested without touching window.location.
//   'ignore'         -> the calling page keeps the original error (public flows)
//   'expire-session' -> the session really expired inside the authenticated app
export function classify401(pathname, config) {
  if (isPublicAuthRequest(config)) return 'ignore';
  if (!isProtectedRoute(pathname)) return 'ignore';
  return 'expire-session';
}

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true,
  timeout: REQUEST_TIMEOUT_MS
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// A single 401 must never hijack the whole app. Redirecting on every 401 was
// what threw registration straight to /login and hid the real server error.
// Rules, in order:
//   1. public auth request  -> never redirect, never clear the session
//   2. not on a protected route -> never redirect, never clear the session
//   3. otherwise -> expire the session once and go to the matching login page
let sessionExpiryHandled = false;

api.interceptors.response.use(
  (response) => {
    // A successful response means the session is valid again (e.g. the user
    // just logged in). Reset the expiry guard so the NEXT real expiry is
    // handled instead of being swallowed by a stale flag. Without this the
    // guard would only ever clear on a full document reload.
    sessionExpiryHandled = false;
    return response;
  },
  (error) => {
    if (error.response?.status !== 401) {
      return Promise.reject(error);
    }

    // 1/2. Public auth request, or any request made outside the authenticated
    //      app: never redirect, never clear the session. The original error
    //      is preserved so the page can show the real server message.
    if (classify401(window.location.pathname, error.config) === 'ignore') {
      return Promise.reject(error);
    }

    // 3. Session really did expire inside the authenticated app.
    //    Guarded so a burst of parallel 401s clears once and redirects once.
    if (!sessionExpiryHandled) {
      sessionExpiryHandled = true;
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      const next = window.location.pathname.startsWith('/admin') ? '/admin/login' : '/login';
      window.location.href = next;
    }
    return Promise.reject(error);
  }
);

export default api;
