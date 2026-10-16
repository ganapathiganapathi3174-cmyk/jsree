// Shared fixtures for the live integration suites (node --test).
//
// NOT a test file (no .test.js suffix), so neither vitest nor `node --test`
// will collect it as a suite.
//
// Purpose: give the admin-dependent tests a deterministic admin token without
// depending on POST /auth/admin-login. That endpoint is currently unusable in
// this environment (see qa-results/reports/POST_AUDIT_HARDENING_REPORT.md):
// authService.adminLogin() looks the admin up by ADMIN_EMAIL, and when no row
// matches it auto-inserts one with the hard-coded referral_code 'ADMIN001',
// which collides with the row that already exists in the shared database and
// returns null -> "Cannot read properties of null (reading 'id')".
//
// Changing that login policy, the .env values or the existing admin row all
// require explicit approval, so the tests do neither. Instead they sign a JWT
// with the server's own JWT_SECRET for the admin row that already exists -
// strictly read-only, no rows created, updated or deleted.

import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../../.env') });

export const API = 'http://localhost:5000/api';
export const JWT_SECRET = process.env.JWT_SECRET;

export const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export function makeToken(userId, role, expiresIn = '15m') {
  if (!JWT_SECRET) throw new Error('JWT_SECRET missing from server/.env');
  return jwt.sign({ userId, role }, JWT_SECRET, { expiresIn });
}

export async function api(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  const text = await res.text();
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return { status: res.status, success: true, data: parsed };
    return { status: res.status, ...parsed };
  }
  catch { return { status: res.status, success: false, message: 'Non-JSON response' }; }
}

// Read-only lookup of an existing active admin row, or null.
export async function findAdminUser() {
  const { data, error } = await supabase
    .from('users')
    .select('id, email, role, status')
    .eq('role', 'admin')
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1);
  if (error || !data?.[0]) return null;
  return data[0];
}

// Admin token for tests, or null when no active admin row exists.
export async function getAdminToken() {
  const admin = await findAdminUser();
  return admin ? makeToken(admin.id, 'admin') : null;
}

// How an admin token was obtained - used in failure output so an unavailable
// admin fixture is never mistaken for an application failure.
export const ADMIN_TOKEN_SOURCE = 'JWT signed for the existing active admin row (admin-login endpoint not used)';
