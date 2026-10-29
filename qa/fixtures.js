// QA fixtures: network-level mocks derived from the server's response envelopes.
// Server returns {success:true,data} for most endpoints; wallet/notifications/
// receipts/security return root-level keys â€” matched per client usage.
// NOTE: ROUTES order matters â€” specific regexes (screenshot/detail) must precede
// generic list strings.
import { PNG_1PX_B64 } from './png.js';

const USER = {
  id: '11111111-1111-4111-8111-111111111111',
  full_name: 'QA Test User',
  email: 'qa.user@example.test',
  mobile: '9876543210',
  role: 'user',
  status: 'active',
  current_plan: 120,
  referral_code: 'QATST120',
  avatar_url: null,
  created_at: '2026-09-01T10:00:00.000Z',
  last_login_at: '2026-10-26T08:00:00.000Z'
};
const ADMIN = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  full_name: 'QA Admin',
  email: 'admin@example.test',
  role: 'admin',
  status: 'active',
  avatar_url: null,
  created_at: '2026-01-01T10:00:00.000Z'
};
const PENDING_USER = { ...USER, status: 'pending' };

const basePayment = (over = {}) => ({
  id: '22222222-2222-4222-8222-222222222222',
  user_id: USER.id,
  payment_type: 'MEMBERSHIP',
  selected_plan: 120,
  expected_amount: 120,
  status: 'pending',
  outcome: 'PENDING_VERIFICATION',
  transaction_id: null,
  rejection_reason: null,
  verification_result: null,
  submitted_at: null,
  created_at: '2026-10-25T09:00:00.000Z',
  expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
  receiver_upi: 'jayarajj126-3@okicici',
  screenshot_path: null,
  user: { id: USER.id, full_name: USER.full_name, email: USER.email },
  ...over
});

const PAYMENTS = [
  basePayment(),
  basePayment({
    id: '22222222-2222-4222-8222-222222222223',
    status: 'manual_review',
    outcome: 'MANUAL_REVIEW',
    submitted_at: '2026-10-26T10:12:00.000Z',
    verification_result: {
      status: 'pending_verification',
      checks: { receiverUpi: true, amount: true, transactionDate: null, transactionStatus: null },
      extractedData: { transactionId: 'TXNQA445566', amount: '120.00', senderName: 'JANE Q DOE' }
    },
    transaction_id: 'TXNQA445566',
    screenshot_url: 'https://storage.example.test/payments/qa-proof.png'
  }),
  basePayment({
    id: '22222222-2222-4222-8222-222222222224',
    status: 'approved',
    outcome: 'APPROVED',
    submitted_at: '2026-10-20T10:12:00.000Z',
    transaction_id: 'TXNQA998877',
    verification_result: { status: 'approved' }
  }),
  basePayment({
    id: '22222222-2222-4222-8222-222222222225',
    status: 'rejected',
    outcome: 'REJECTED',
    submitted_at: '2026-10-18T10:12:00.000Z',
    rejection_reason: 'Amount mismatch (expected â‚¹120.00, found â‚¹99.00)',
    transaction_id: 'TXNQA112233',
    verification_result: { status: 'rejected', reason: 'Amount mismatch' }
  })
];

const ADMIN_SUMMARY = {
  total: 42,
  pending: 7,
  pendingVerification: 9,
  manualReview: 2,
  approved: 30,
  rejected: 5
};

const rootResult = (obj) => ({ __root: obj });
const binary = (type) => ({ __binary: Buffer.from(PNG_1PX_B64, 'base64'), type });

// [method, matcher (string includes | RegExp), responder(url) -> body]
const ROUTES = [
  // ---- config
  ['GET', /\/api\/config\/public/, () => ({ receiver_upi: 'jayarajj126-3@okicici', support_email: 'help@example.test' })],
  ['GET', '/api/config', () => ({ receiver_upi: 'jayarajj126-3@okicici', receiver_name: 'Jaya Raj', min_amount: 100, max_amount: 50000, sender_name_policy: 'review', payment_provider_mode: 'mock', auto_approve: false })],
  ['PUT', '/api/config', () => ({ message: 'Configuration updated' })],

  // ---- auth
  ['POST', /\/api\/auth\/admin-login/, () => ({ token: 'qa-token-admin', user: ADMIN })],
  ['POST', /\/api\/auth\/login/, () => ({ token: 'qa-token-user', user: USER })],
  ['POST', /\/api\/auth\/register/, () => ({ token: 'qa-token-user', user: PENDING_USER, receiver_upi: 'jayarajj126-3@okicici' })],
  ['PUT', /\/api\/auth\/change-password/, () => ({ message: 'Password changed successfully' })],

  // ---- user
  ['GET', '/api/users/profile', () => USER],
  ['POST', /\/api\/users\/avatar/, () => ({ avatar_url: null })],
  ['DELETE', /\/api\/users\/avatar/, () => ({ avatar_url: null })],
  ['GET', '/api/users/dashboard', () => ({
    profile: USER,
    topupSummary: { totalReceived: 450, pending: 1, completed: 3, rejected: 0 },
    referralSummary: { total: 6, active: 2, earnings: 180 }
  })],

  // ---- wallet: server returns RAW {balance} / {transactions, pagination}
  ['GET', '/api/wallet/balance', () => rootResult({ balance: 250 })],
  ['GET', '/api/wallet/transactions', () => rootResult({
    transactions: [
      { id: 'w1', type: 'CREDIT', amount: 120, description: 'Referral reward', created_at: '2026-10-21T10:00:00.000Z' },
      { id: 'w2', type: 'DEBIT', amount: 50, description: 'Redeemed', created_at: '2026-10-22T11:00:00.000Z' },
      { id: 'w3', type: 'CREDIT', amount: 180, description: 'Top-up bonus', created_at: '2026-10-24T09:30:00.000Z' }
    ],
    pagination: { page: 1, limit: 20, total: 3 }
  })],

  // ---- payments: specific first
  ['POST', /\/api\/payments\/[^/]+\/screenshot/, () => ({
    verification: { status: 'approved', reason: null, inconclusive: false, senderNameMatch: 'MATCH' }
  })],
  ['GET', /\/api\/payments\/[^/]+\/screenshot/, () => binary('image/png')],
  ['POST', '/api/payments', () => basePayment({ id: '22222222-2222-4222-8222-222222222226' })],
  ['GET', '/api/payments', () => PAYMENTS],

  // ---- admin payments: specific first
  ['GET', /\/api\/admin\/payments\/[^/]+\/screenshot/, () => binary('image/png')],
  ['POST', /\/api\/admin\/payments\/[^/]+\/review/, () => ({ message: 'Payment approved', data: { status: 'approved' } })],
  ['GET', /\/api\/admin\/payments\/[^/]+/, () => ({
    ...PAYMENTS[1],
    outcome: 'MANUAL_REVIEW',
    verificationHistory: [
      { id: 'h1', status: 'created', detail: 'Payment created', created_at: '2026-10-26T10:00:00.000Z' },
      { id: 'h2', status: 'pending_verification', detail: 'Proof uploaded, OCR pending', created_at: '2026-10-26T10:12:00.000Z' }
    ],
    provider: { available: false, mode: 'none' },
    user: { ...USER, status: 'pending' }
  })],
  ['GET', '/api/admin/payments', () => ({ __root: { data: PAYMENTS, total: 42, summary: ADMIN_SUMMARY } })],

  // ---- topups: specific first
  ['GET', /\/api\/admin\/topups\/[^/]+\/screenshot/, () => binary('image/png')],
  ['GET', '/api/admin/topups', () => ({
    __root: {
      data: [
        { id: '11111111-1111-4111-8111-111111111101', user_id: USER.id, user: { full_name: USER.full_name, email: USER.email }, amount: 150, status: 'manual_review', proof_path: 'topups/qax.png', screenshot_url: 'topups/qax.png', created_at: '2026-10-26T09:00:00.000Z' },
        { id: '11111111-1111-4111-8111-111111111102', user_id: '55555555-5555-4555-8555-555555555555', user: { full_name: 'Second User', email: 'two@example.test' }, amount: 250, status: 'completed', created_at: '2026-10-24T09:00:00.000Z' },
        { id: '11111111-1111-4111-8111-111111111103', user_id: '66666666-6666-4666-8666-666666666666', user: { full_name: 'Third User', email: 'three@example.test' }, amount: 100, status: 'pending', created_at: '2026-10-23T09:00:00.000Z' }
      ],
      summary: { pending: 1, manualReview: 1, completed: 1, rejected: 0, total: 3, totalAmount: 500 }
    }
  })],
  ['GET', /\/api\/topups\/[^/]+\/proof/, () => binary('image/png')],
  ['POST', '/api/topups/direct', () => ({ message: 'Payment proof submitted for review!', data: { manualReview: false, inconclusive: false } })],
  ['GET', '/api/topups', () => ({
    __root: {
      data: [
        { id: 't1', receiver_id: USER.id, sender_id: '55555555-5555-4555-8555-555555555555', amount: 150, status: 'payment_pending', screenshot_url: 'topups/t1.png', created_at: '2026-10-26T09:00:00.000Z', note: 'UPI transfer done' },
        { id: 't2', receiver_id: USER.id, sender_id: '66666666-6666-4666-8666-666666666666', amount: 100, status: 'completed', created_at: '2026-10-22T09:00:00.000Z' },
        { id: 't3', receiver_id: USER.id, sender_id: '77777777-7777-4777-8777-777777777777', amount: 200, status: 'rejected', rejection_reason: 'Screenshot unreadable', created_at: '2026-10-20T09:00:00.000Z' },
        { id: 't4', receiver_id: '55555555-5555-4555-8555-555555555555', sender_id: USER.id, amount: 120, status: 'completed', created_at: '2026-10-19T09:00:00.000Z' }
      ],
      summary: {
        receivedCompletedCount: 1,
        receivedPendingCount: 1,
        receivedClaimableCount: 0,
        receivedRequired: 3,
        remaining: 2,
        mustTopup: false,
        canClaim: false,
        sponsorId: '55555555-5555-4555-8555-555555555555',
        sponsorName: 'Sponsor Sam'
      }
    }
  })],

  // ---- referrals / plans
  ['GET', '/api/referrals', () => ({ referralCode: 'QATST120', referrals: [], stats: { total: 6, active: 2, earnings: 180 } })],
  ['GET', '/api/plans/my-requests', () => ([])],
  ['GET', '/api/plans', () => ([])],

  // ---- chat (user)
  ['GET', '/api/chat/conversations', () => ([])],
  ['GET', /\/api\/chat\/messages\/[^/?]+/, () => ([])],
  ['POST', /\/api\/chat\/messages/, () => ({ id: 'c1', message: 'hi' })],

  // ---- notifications (root-level keys per client usage)
  ['GET', '/api/notifications/unread-count', () => rootResult({ count: 1 })],
  ['GET', /\/api\/notifications\?/, () => rootResult({
    notifications: [
      { id: 'n1', title: 'Payment approved', message: 'Your â‚¹120 plan is active', type: 'payment', read: false, created_at: '2026-10-26T10:00:00.000Z' },
      { id: 'n2', title: 'New referral', message: 'QA Friend joined', type: 'referral', read: true, created_at: '2026-10-25T10:00:00.000Z' }
    ],
    pagination: { page: 1, limit: 20, total: 2 }
  })],
  ['PUT', '/api/notifications/read-all', () => ({ message: 'All read' })],

  // ---- receipts (server: raw getUserReceipts with camelCase receipt fields)
  ['GET', '/api/receipts/my-receipts', () => rootResult({
    receipts: [{
      receiptId: 'RCP-QA-0001',
      paymentId: PAYMENTS[2].id,
      amount: 120,
      planMonths: 1,
      createdAt: '2026-10-20T12:00:00.000Z'
    }],
    pagination: { page: 1, limit: 10, total: 1 }
  })],
  ['GET', /\/api\/receipts\/.+\/html/, () => ({ __raw: '<!doctype html><title>Receipt</title><p>QA receipt</p>', type: 'text/html' })],

  // ---- security (server: raw {logs}/{activities}/{pagination})
  ['GET', /\/api\/security\/ip-history/, () => rootResult({
    logs: [
      { id: 's1', event_type: 'login', ip_address: '203.0.113.10', user_agent: 'Chrome/120 Windows', created_at: '2026-10-26T07:00:00.000Z' },
      { id: 's2', event_type: 'password_change', ip_address: '198.51.100.7', user_agent: 'Safari iOS', created_at: '2026-10-25T18:00:00.000Z' }
    ],
    pagination: { page: 1, limit: 20, total: 2, totalPages: 1 }
  })],
  ['GET', /\/api\/security\/suspicious/, () => rootResult({
    activities: [
      { id: 'x1', activity_type: 'multiple_accounts_same_ip', ip_address: '198.51.100.99', severity: 'high', users: { email: 'sus@example.test' }, details: { accounts: 3 }, resolved: false, created_at: '2026-10-26T06:00:00.000Z' }
    ],
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1 }
  })],
  ['PUT', /\/api\/security\/suspicious\/[^/]+\/resolve/, () => ({ message: 'Resolved' })],

  // ---- export (server: raw flat summary)
  ['GET', /\/api\/export\/financial-summary/, () => rootResult({
    totalRevenue: 14400,
    pendingAmount: 840,
    totalTopups: 900,
    totalTransactions: 128,
    approvedCount: 95,
    rejectedCount: 6,
    dailyRevenue: [{ date: '2026-10-25', amount: 240 }],
    monthlyRevenue: [{ month: '2026-10', amount: 4200 }]
  })],
  ['GET', /\/api\/export\/(csv|pdf|excel)/, () => ({ __raw: 'date,amount\n2026-10-25,240', type: 'text/csv' })],

  // ---- admin
  ['GET', '/api/admin/dashboard', () => ({
    totalUsers: 150,
    activeUsers: 120,
    inactiveUsers: 30,
    approvedPayments: 95,
    pendingPayments: 7,
    rejectedPayments: 6,
    registrationCollection: 11400,
    topupCollection: 4500,
    pendingPlanChanges: 3,
    unreadChats: 2
  })],
  ['GET', /\/api\/admin\/users/, () => ({
    users: [
      { id: USER.id, full_name: USER.full_name, email: USER.email, mobile: USER.mobile, role: 'user', status: 'active', current_plan: 120, created_at: '2026-09-01T10:00:00.000Z', last_login_at: '2026-10-26T08:00:00.000Z' },
      { id: '33333333-3333-4333-8333-333333333333', full_name: 'Pending Pat', email: 'pat@example.test', mobile: '9000000001', role: 'user', status: 'pending', current_plan: null, created_at: '2026-10-20T10:00:00.000Z' },
      { id: '44444444-4444-4444-8444-444444444444', full_name: 'Inactive Ira', email: 'ira@example.test', mobile: '9000000002', role: 'user', status: 'inactive', current_plan: 120, created_at: '2026-06-01T10:00:00.000Z' }
    ],
    totalPages: 1,
    total: 3
  })],
  ['GET', '/api/admin/inactive-users', () => ([
    { id: '44444444-4444-4444-8444-444444444444', full_name: 'Inactive Ira', email: 'ira@example.test', status: 'inactive', current_plan: 120, last_login_at: '2026-06-10T10:00:00.000Z' }
  ])],
  ['GET', '/api/admin/plan-change-requests', () => ([
    { id: 'pc1', user_id: USER.id, user: { full_name: 'Plan Pete', email: 'pete@example.test' }, from_plan: 120, to_plan: 250, status: 'pending', reason: 'Upgrade request', created_at: '2026-10-26T08:00:00.000Z' }
  ])],
  ['GET', '/api/admin/chats', () => ([
    { id: 'cv1', user: { full_name: 'QA Test User', email: 'qa.user@example.test' }, last_message: 'Need help with payment', unread: 2, updated_at: '2026-10-26T09:00:00.000Z' }
  ])],
  ['GET', /\/api\/admin\/chats\/[^/]+\/messages/, () => ([
    { id: 'm1', sender: 'user', message: 'Need help with payment', created_at: '2026-10-26T09:00:00.000Z' },
    { id: 'm2', sender: 'admin', message: 'We are checking it now', created_at: '2026-10-26T09:01:00.000Z' }
  ])],
  ['GET', /\/api\/admin\/audit-logs/, () => ([
    { id: 'al1', action: 'payment.review', actor: 'QA Admin', target: 'TXNQA445566', ip: '203.0.113.5', created_at: '2026-10-26T09:30:00.000Z' },
    { id: 'al2', action: 'user.status_change', actor: 'QA Admin', target: 'pat@example.test', ip: '203.0.113.5', created_at: '2026-10-25T09:30:00.000Z' }
  ])]
];

function matchRoute(method, url) {
  const path = url.replace(/^https?:\/\/[^/]+/, '');
  for (const [m, pat, respond] of ROUTES) {
    if (m !== method) continue;
    const hit = typeof pat === 'string' ? path.includes(pat) : pat.test(path);
    if (hit) return respond;
  }
  return null;
}

function buildPayload(body, method) {
  if (body && body.__root) return { success: true, ...body.__root };
  if (body === undefined || body === null) {
    return method === 'GET' ? { success: true, data: [] } : { success: true, message: 'ok', data: {} };
  }
  return { success: true, data: body };
}

export async function installMocks(page) {
  await page.route('**/api/**', async (route) => {
    const method = route.request().method();
    const url = route.request().url();
    const respondFn = matchRoute(method, url);
    const body = respondFn ? respondFn(url) : undefined;

    if (body && body.__binary) {
      return route.fulfill({ status: 200, contentType: body.type, body: body.__binary });
    }
    if (body && body.__raw !== undefined) {
      return route.fulfill({ status: 200, contentType: body.type, body: body.__raw });
    }
    const payload = buildPayload(body, method);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });
}

export function initScript(role) {
  const user = role === 'admin' ? ADMIN : role === 'pending' ? PENDING_USER : USER;
  const token = role === 'admin' ? 'qa-token-admin' : 'qa-token-user';
  if (role === 'anon') {
    return `localStorage.setItem('darkMode', ${JSON.stringify(process.env.QA_THEME === 'light' ? 'false' : 'true')})`;
  }
  // Runs on every document (incl. reloads/redirects): set session state only
  // once per tab so later navigations don't resurrect cleared tokens/theme.
  return `(() => {
    if (sessionStorage.getItem('qa-init')) return;
    sessionStorage.setItem('qa-init', '1');
    localStorage.setItem('token', ${JSON.stringify(token)});
    localStorage.setItem('user', ${JSON.stringify(JSON.stringify(user))});
    localStorage.setItem('darkMode', ${JSON.stringify(process.env.QA_THEME === 'light' ? 'false' : 'true')});
  })()`;
}

export { USER, ADMIN, PENDING_USER, PAYMENTS };
