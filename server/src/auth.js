import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const cookieName = 'qr_admin_token';
const tokenLifetime = '8h';

function jwtSecret() {
  // Production deployments must provide their own signing secret.
  if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET must be configured in production.');
  }
  return process.env.JWT_SECRET || 'local-development-secret-change-me';
}

function parseCookies(cookieHeader = '') {
  // Convert the raw Cookie header into values the auth middleware can inspect.
  return Object.fromEntries(
    cookieHeader
      .split(';')
      .map((part) => part.trim().split('='))
      .filter(([name, value]) => name && value)
      .map(([name, ...value]) => [name, decodeURIComponent(value.join('='))]),
  );
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

export function createAuthCookie(userId) {
  // Keep the token inaccessible to JavaScript while allowing normal browser requests.
  const token = jwt.sign({ sub: userId }, jwtSecret(), { expiresIn: tokenLifetime });
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${cookieName}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=28800${secure}`;
}

export function clearAuthCookie() {
  return `${cookieName}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

export function readAuthUserId(request) {
  // Invalid, expired, or missing cookies are treated as unauthenticated.
  const token = parseCookies(request.headers.cookie)[cookieName];
  if (!token) {
    return null;
  }

  try {
    return jwt.verify(token, jwtSecret()).sub;
  } catch {
    return null;
  }
}

export function requireAdmin(request, response, next) {
  const userId = readAuthUserId(request);
  if (!userId) {
    return response.status(401).json({ error: 'Admin login required.' });
  }

  request.adminUserId = userId;
  return next();
}

export { cookieName };
