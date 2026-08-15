/**
 * ============================================================================
 * [角色] 适配器：SqliteResetTokenStore —— ResetTokenStore 的 SQLite 实现
 * ----------------------------------------------------------------------------
 * 与内存适配器行为一致（幂等 delete / invalidateForUser / 过期判定归单元）。
 * ============================================================================
 */

import Database from "better-sqlite3";
import type { ResetTokenRecord, ResetTokenStore } from "../../ports/reset-token-store";

interface TokenRow {
  token: string;
  userId: string;
  expiresAt: number;
}

export class SqliteResetTokenStore implements ResetTokenStore {
  constructor(private readonly db: Database.Database) {}

  /** 当前 token 总数（与内存版 size getter 对齐，供测试断言）。 */
  get size(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM reset_tokens").get() as { n: number }).n;
  }

  async save(record: ResetTokenRecord): Promise<void> {
    this.db
      .prepare("INSERT OR REPLACE INTO reset_tokens (token, user_id, expires_at) VALUES (?, ?, ?)")
      .run(record.token, record.userId, record.expiresAt.getTime());
  }

  async findValid(token: string): Promise<ResetTokenRecord | null> {
    const row = this.db
      .prepare("SELECT token, user_id AS userId, expires_at AS expiresAt FROM reset_tokens WHERE token = ?")
      .get(token) as TokenRow | undefined;
    return row ? { token: row.token, userId: row.userId, expiresAt: new Date(row.expiresAt) } : null;
  }

  async delete(token: string): Promise<void> {
    this.db.prepare("DELETE FROM reset_tokens WHERE token = ?").run(token);
  }

  async invalidateForUser(userId: string): Promise<void> {
    this.db.prepare("DELETE FROM reset_tokens WHERE user_id = ?").run(userId);
  }
}
