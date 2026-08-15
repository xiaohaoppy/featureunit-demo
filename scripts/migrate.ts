/**
 * ============================================================================
 * [角色] 迁移脚本：migrate —— 初始化/升级数据库结构
 * ----------------------------------------------------------------------------
 * 用法：npm run migrate（SQLite 阶段 = 幂等建表，可反复执行）
 *
 * 未来 Postgres（方案 B：一个库多个 schema）：
 *   - 迁移文件按组前缀组织：migrations/auth/001_xxx.sql、migrations/order/001_xxx.sql
 *   - 每条迁移在 schema_migrations 表登记版本，只执行未应用的
 *   - SQLite 阶段无需版本表（IF NOT EXISTS 即幂等）
 * ============================================================================
 */

import { resolve } from "node:path";
import { openDb } from "../src/groups/auth-service/adapters/sqlite/db";
import { loadConfig } from "../src/groups/auth-service/config";

const config = loadConfig();
if (config.USER_STORE !== "sqlite") {
  console.log(`[migrate] 当前 USER_STORE=${config.USER_STORE}，无需迁移（SQLite 模式才需要）`);
  process.exit(0);
}

const dbPath = resolve(import.meta.dirname, "..", config.SQLITE_PATH);
const db = openDb(dbPath);
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all() as Array<{ name: string }>;

console.log(`[migrate] ✓ 数据库就绪: ${dbPath}`);
console.log(`[migrate]   表: ${tables.map((t) => t.name).join(", ")}`);
db.close();
