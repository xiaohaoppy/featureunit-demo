/**
 * ============================================================================
 * [角色] 适配器：SqliteUserStore —— UserStore 的 SQLite 实现
 * ----------------------------------------------------------------------------
 * 纪律：SQL 只存在于适配器层（单元永远看不到）；行为必须与内存适配器一致
 * （内存实现是端口语义的参照物——集成测试会逐方法对照）。
 *
 * 关键点：
 *   1. email UNIQUE 约束：单元先查后建（非原子），并发抢同一邮箱时，
 *      后到者撞约束 → 捕获并转成 AppError(EMAIL_TAKEN)——与单元语义一致；
 *   2. 所有方法同步执行（better-sqlite3 是同步 API），接口签名仍是 Promise，
 *      对单元无感；
 *   3. 时间字段（expires_at）存 epoch 毫秒整数，返回时转回 Date。
 * ============================================================================
 */

import Database from "better-sqlite3";
import { AppError, ErrorCodes } from "../../ports/errors";
import type { User, UserStore } from "../../ports/user-store";

/** better-sqlite3 唯一约束冲突错误码。 */
const UNIQUE_VIOLATION = "SQLITE_CONSTRAINT_UNIQUE";

/** 行 → User（数据库列名与实体字段名对齐）。 */
interface UserRow {
  id: string;
  email: string;
  passwordHash: string;
}

export class SqliteUserStore implements UserStore {
  constructor(private readonly db: Database.Database) {}

  async findByEmail(email: string): Promise<User | null> {
    const row = this.db
      .prepare("SELECT id, email, password_hash AS passwordHash FROM users WHERE email = ?")
      .get(email) as UserRow | undefined;
    return row ?? null;
  }

  async findById(id: string): Promise<User | null> {
    const row = this.db
      .prepare("SELECT id, email, password_hash AS passwordHash FROM users WHERE id = ?")
      .get(id) as UserRow | undefined;
    return row ?? null;
  }

  async create(user: User): Promise<void> {
    try {
      this.db
        .prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)")
        .run(user.id, user.email, user.passwordHash);
    } catch (err) {
      // 并发兜底：单元已先查重，此处唯一约束冲突 = 邮箱被并发抢注
      if (err instanceof Error && (err as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new AppError(ErrorCodes.EMAIL_TAKEN, 409, { cause: err });
      }
      throw err;
    }
  }

  async updatePasswordHash(id: string, hash: string): Promise<void> {
    // 幂等：id 不存在时影响行数为 0，静默忽略（与端口语义一致）
    this.db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, id);
  }

  async updateEmail(id: string, email: string): Promise<void> {
    try {
      this.db.prepare("UPDATE users SET email = ? WHERE id = ?").run(email, id);
    } catch (err) {
      // 新邮箱撞他人唯一约束 → EMAIL_TAKEN（单元语义一致）
      if (err instanceof Error && (err as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new AppError(ErrorCodes.EMAIL_TAKEN, 409, { cause: err });
      }
      throw err;
    }
  }
}
