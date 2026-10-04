// ─────────────────────────────────────────────────────────────
// Centralized CORS policy.
//
// Credentialed CORS (Authorization header / cookies) forbids the `*`
// wildcard: the response must echo the caller's exact origin. The allow-list
// is therefore resolved once at boot and every origin decision is explicit.
//
// Production frontend is https://jsree.vercel.app and is ALWAYS allowed, even
// when the platform env var is missing, blank or mistyped. If it is ever
// dropped from the list the browser rejects the request at the preflight
// stage with "No 'Access-Control-Allow-Origin' header is present", which is a
// silent, hard-to-diagnose failure — so rejected origins are logged here.
// ─────────────────────────────────────────────────────────────

// Production frontend + local dev servers. Always allowed, env can add more
// but never remove these.
export const ALWAYS_ALLOWED_ORIGINS = [
  'https://jsree.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000'
];

// Checked in order; the FIRST non-empty value wins, and every comma-separated
// entry inside it is allowed.
const ORIGIN_ENV_VARS = ['CLIENT_URLS', 'CLIENT_URL', 'FRONTEND_URL'];

const PREFLIGHT_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const PREFLIGHT_HEADERS = ['Content-Type', 'Authorization', 'X-Requested-With'];

// Origins are compared case-insensitively and without a trailing slash so that
// "https://JSREE.vercel.app/" and "https://jsree.vercel.app" both match.
export function normalizeOrigin(origin) {
  return String(origin ?? '').trim().replace(/\/+$/, '').toLowerCase();
}

export function buildAllowedOrigins(env = process.env) {
  const raw = ORIGIN_ENV_VARS
    .map((key) => String(env?.[key] ?? '').trim())
    .find((value) => value) || '';

  const configured = raw.split(',').map(normalizeOrigin).filter(Boolean);

  return [
    ...new Set([...ALWAYS_ALLOWED_ORIGINS.map(normalizeOrigin), ...configured])
  ];
}

export function isOriginAllowed(origin, allowedOrigins) {
  // No Origin header (curl, health checks, server-to-server) -> allow.
  if (!origin) return true;

  const clean = normalizeOrigin(origin);
  if (!clean) return false;
  if (allowedOrigins.includes(clean)) return true;

  // Vercel preview deployments. Host must be a *.vercel.app subdomain over
  // https, so a look-alike host or an http:// downgrade stays blocked.
  try {
    const { protocol, hostname } = new URL(clean);
    return protocol === 'https:' && hostname.endsWith('.vercel.app');
  } catch {
    return false;
  }
}

export function buildCorsOptions({ env = process.env, logger = console } = {}) {
  const allowedOrigins = buildAllowedOrigins(env);

  return {
    allowedOrigins,
    options: {
      origin(origin, callback) {
        if (isOriginAllowed(origin, allowedOrigins)) return callback(null, true);
        // Never leak the reason to the caller: the browser only sees a missing
        // header, so record it server-side instead.
        logger.warn?.(`[cors] blocked origin not in allow-list: ${origin}`);
        return callback(null, false);
      },
      // Reflects the matched origin. Never "*" — that is illegal with credentials.
      credentials: true,
      methods: PREFLIGHT_METHODS,
      allowedHeaders: PREFLIGHT_HEADERS,
      optionsSuccessStatus: 204
    }
  };
}