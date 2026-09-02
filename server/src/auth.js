import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

// Cookie name is shared by login, logout, and authentication middleware.
const cookieName = "qr_admin_token";
// JWT expiration limits how long an admin browser session remains valid.
const tokenLifetime = "8h";

function jwtSecret() {
  // Production deployments must provide their own signing secret.
  if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET must be configured in production.");
  }
  return process.env.JWT_SECRET || "local-development-secret-change-me";
}

function parseCookies(cookieHeader = "") {
  // Cookie headers are plain text; this converts them into an object keyed by cookie name.
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([name, value]) => name && value)
      .map(([name, ...value]) => [name, decodeURIComponent(value.join("="))]),
  );
}

export async function hashPassword(password) {
  // bcrypt creates a salted one-way hash; the original password is never stored.
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password, passwordHash) {
  // bcrypt.compare safely checks a plain password against its stored hash.
  return bcrypt.compare(password, passwordHash);
}

export function createAuthCookie(userId) {
  // The JWT stores the user id and is protected from JavaScript with HttpOnly.
  const token = jwt.sign({ sub: userId }, jwtSecret(), {
    expiresIn: tokenLifetime,
  });
  const productionAttributes =
    process.env.NODE_ENV === "production"
      ? "; SameSite=None; Secure"
      : "; SameSite=Lax";
  return `${cookieName}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=28800${productionAttributes}`;
}

export function clearAuthCookie() {
  // Max-Age=0 tells the browser to remove the cookie immediately.
  const productionAttributes =
    process.env.NODE_ENV === "production"
      ? "; SameSite=None; Secure"
      : "; SameSite=Lax";
  return `${cookieName}=; HttpOnly; Path=/; Max-Age=0${productionAttributes}`;
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
  // Express middleware either rejects the request or passes control to the route.
  const userId = readAuthUserId(request);
  if (!userId) {
    return response.status(401).json({ error: "Admin login required." });
  }

  request.adminUserId = userId;
  return next();
}

export { cookieName };
