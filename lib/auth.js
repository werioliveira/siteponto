import crypto from "crypto";
import { cookies } from "next/headers";
import { database, adoptLegacy, setInitialRule } from "./ponto";

export const SESSION_COOKIE = "ponto_session";
const SESSION_DAYS = 30;

export class AuthError extends Error {}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

export function createUser({ email, password, name = "", badge = "", weeklyHours, saturdayWork = false } = {}) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new AuthError("Informe um email válido.");
  if (String(password || "").length < 6) throw new AuthError("A senha precisa ter pelo menos 6 caracteres.");
  const connection = database();
  if (connection.prepare("SELECT id FROM users WHERE email = ?").get(normalized)) {
    throw new AuthError("Este email já possui conta. Faça login.");
  }
  const info = connection.prepare("INSERT INTO users (email, password_hash, name, badge) VALUES (?, ?, ?, ?)")
    .run(normalized, hashPassword(password), String(name).trim().slice(0, 120), String(badge).trim().slice(0, 60));
  const userId = Number(info.lastInsertRowid);
  const { adopted } = adoptLegacy(userId);
  if (!adopted) setInitialRule(userId, weeklyHours, saturdayWork);
  return userId;
}

export function authenticate(email, password) {
  const normalized = String(email || "").trim().toLowerCase();
  const user = database().prepare("SELECT id, password_hash FROM users WHERE email = ?").get(normalized);
  if (!user || !verifyPassword(String(password || ""), user.password_hash)) {
    throw new AuthError("Email ou senha incorretos.");
  }
  return user.id;
}

export async function startSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const connection = database();
  connection.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString());
  connection.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
    .run(token, userId, new Date(Date.now() + SESSION_DAYS * 86400000).toISOString());
  const store = await cookies();
  store.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_DAYS * 86400 });
}

export async function getSessionUser() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return database().prepare(`
    SELECT u.id, u.email, u.name, u.badge, u.role, u.company
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > ?
  `).get(token, new Date().toISOString()) || null;
}

export async function endSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) database().prepare("DELETE FROM sessions WHERE token = ?").run(token);
  store.delete(SESSION_COOKIE);
}