import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

function getJWTSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('FATAL: JWT_SECRET environment variable is required');
    process.exit(1);
  }
  return secret;
}

export function generateReferralCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = 'REF';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export async function hashPassword(password) {
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(password, salt);
}

export async function comparePassword(password, hashedPassword) {
  return bcrypt.compare(password, hashedPassword);
}

export function generateToken(payload) {
  return jwt.sign(payload, getJWTSecret(), { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, getJWTSecret());
  } catch (error) {
    return null;
  }
}

export function formatDate(date) {
  if (!date) return null;
  const d = new Date(date);
  return d.toISOString();
}

export function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

export function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return input
    .replace(/[<>]/g, '')
    .trim()
    .substring(0, 500);
}

export function generateUniqueFilename(originalname) {
  const ext = originalname.split('.').pop();
  return `${uuidv4()}.${ext}`;
}

export function isWithinTimeWindow(date1, date2, windowMinutes = 30) {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const diffMs = d2 - d1;
  if (diffMs < 0) return false;
  const diffMinutes = diffMs / (1000 * 60);
  return diffMinutes <= windowMinutes;
}
