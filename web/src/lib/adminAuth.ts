// Single-password admin login for /admin. The password lives only in the
// ADMIN_PASSWORD env var; a successful login sets an HttpOnly cookie holding
// an expiry signed with ADMIN_SESSION_SECRET (HMAC), so nothing is stored
// server-side and the cookie can't be forged or extended.

import { createHmac, timingSafeEqual } from "crypto";
import type { IncomingMessage, ServerResponse } from "http";

const COOKIE = "admin_session";
const TTL_SECONDS = 12 * 60 * 60;

function secret(): string {
  const s = process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || "";
  if (!s) throw new Error("ADMIN_PASSWORD is not configured");
  return s;
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function adminConfigured(): boolean {
  return !!process.env.ADMIN_PASSWORD;
}

export function checkPassword(password: unknown): boolean {
  const expected = process.env.ADMIN_PASSWORD || "";
  return !!expected && typeof password === "string" && safeEqual(password, expected);
}

function cookieAttrs(maxAge: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export function setSessionCookie(res: ServerResponse) {
  const expires = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const value = `${expires}.${sign(String(expires))}`;
  res.setHeader("Set-Cookie", `${COOKIE}=${value}; ${cookieAttrs(TTL_SECONDS)}`);
}

export function clearSessionCookie(res: ServerResponse) {
  res.setHeader("Set-Cookie", `${COOKIE}=; ${cookieAttrs(0)}`);
}

export function isAdmin(req: IncomingMessage): boolean {
  if (!adminConfigured()) return false;
  const cookie = req.headers.cookie || "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!match) return false;
  const [expires, sig] = decodeURIComponent(match[1]).split(".");
  if (!expires || !sig || Number(expires) < Date.now() / 1000) return false;
  return safeEqual(sig, sign(expires));
}
