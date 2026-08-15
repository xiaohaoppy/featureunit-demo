/**
 * ============================================================================
 * [角色] 适配器：SqliteSessionStore —— SessionStore 的 SQLite 实现
 * ----------------------------------------------------------------------------
 * 与内存适配器行为一致（幂等 delete / deleteAllForUser / 过期判定归单元）。
 * expires_at 存 epoch 毫秒整数，返回时转回 Date。
 * ============================================================================
 */

import Database from "better-sqlite3";
import type { Session, SessionStore } from "../../ports/session-store";

interface SessionRow {
  token: string;
  userId: string;
  expiresAt: number;
}

export class SqliteSessionStore implements SessionStore {
  constructor(private readonly db: Database.Database) {}

  async create(session: Session): Promise<void> {
    // token 冲突时覆盖（UUID 碰撞可忽略，语义与内存版一致）
    this.db
      .prepare("INSERT OR REPLACE INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
      .run(session.token, session.userId, session.expiresAt.getTime());
  }

  async findByToken(token: string): Promise<Session | null> {
    const row = this.db
      .prepare("SELECT token, user_id AS userId, expires_at AS expiresAt FROM sessions WHERE token = ?")
      .get(token) as SessionRow | undefined;
    return row ? { token: row.token, userId: row.userId, expiresAt: new Date(row.expiresAt) } : null;
  }

  async delete(token: string): Promise<void> {
    this.db.prepare("DELETE FROM sessions WHERE token = ?").run(token); // 幂等
  }

  async deleteAllForUser(userId: string): Promise<void> {
    this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  }
}
