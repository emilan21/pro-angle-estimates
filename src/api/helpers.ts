import type { Context } from "hono";

export const now = () => new Date().toISOString();

export function apiError(c: Context, status: 400 | 401 | 403 | 404 | 409 | 422 | 500 | 502, code: string, message: string) {
  return c.json({ error: { code, message } }, status);
}

export function rowObject<T>(result: D1Result<T>): T[] { return result.results; }

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

export function auditStatement(db: D1Database, actorEmail: string, action: string, entityType: string, entityId: string, metadata?: unknown): D1PreparedStatement {
  return db.prepare("INSERT INTO audit_events(id, actor_email, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), actorEmail, action, entityType, entityId, metadata == null ? null : JSON.stringify(metadata), now());
}
