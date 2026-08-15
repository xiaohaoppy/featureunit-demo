/**
 * ============================================================================
 * [角色] 适配器：SQLite 数据库层 —— 打开连接 + 建表（迁移）
 * ----------------------------------------------------------------------------
 * 为什么先做 SQLite：零部署、零依赖（better-sqlite3 预编译），先把
 * "真库适配器"的模式跑通；未来平移到 Postgres 时 SQL 基本通用。
 *
 * 未来 Postgres 架构（方案 B：一个库多个 schema）：
 *   - auth_service.users / auth_service.sessions / auth_service.reset_tokens
 *   - order_service.* 同理；连接串换 DATABASE_URL，建表语句换成
 *     CREATE TABLE IF NOT EXISTS <schema>.<table> ...（迁移脚本按组前缀组织）
 *   - SQLite 阶段：每组一个 db 文件（等价于 schema 级隔离），
 *     默认 data/auth-service.db
 *
 * 表设计要点：
 *   - users.email UNIQUE：并发抢邮箱的唯一约束兜底（契约注释里的欠账在此兑现）
 *   - 时间一律存 epoch 毫秒整数（SQLite 无日期类型；端口接口仍是 Date）
 * ============================================================================
 */

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** 建表 SQL（幂等：IF NOT EXISTS，可重复执行 = 迁移）。 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reset_tokens (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);
`;

/** 执行迁移（幂等建表）。 */
export function migrate(db: Database.Database): void {
  db.exec(SCHEMA_SQL);
}

/**
 * 打开（或创建）SQLite 数据库并完成迁移。
 * @param path 数据库文件路径（如 ./data/auth-service.db）
 */
export function openDb(path: string): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL"); // 并发读写友好
  db.pragma("foreign_keys = ON");  // 外键约束（sessions/reset_tokens 引用 users）
  migrate(db);
  return db;
}
