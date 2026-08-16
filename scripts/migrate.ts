/**
 * ============================================================================
 * [角色] 迁移脚本：migrate —— 初始化数据存储
 * ----------------------------------------------------------------------------
 * 用法：npm run migrate（USER_STORE=sqlite 时建库建表，幂等可反复执行）
 * 空框架阶段：只建框架元数据表；业务功能的数据表随功能出现自动演进。
 * ============================================================================
 */

import { resolve, dirname } from "node:path";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { loadConfig } from "../src/groups/auth-service/config";

const config = loadConfig();
if (config.USER_STORE !== "sqlite") {
  console.log(`[migrate] 当前存储模式=${config.USER_STORE}，无需迁移（sqlite 模式才需要）`);
  process.exit(0);
}

const dbPath = resolve(import.meta.dirname, "..", config.SQLITE_PATH);
mkdirSync(dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

// 框架元数据表（业务表由流水线生成的数据接口自动演进）
db.exec(`
CREATE TABLE IF NOT EXISTS framework_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO framework_meta (key, value) VALUES ('schema_version', '1');
`);

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all() as Array<{ name: string }>;

console.log(`[migrate] ✓ 数据存储就绪: ${dbPath}`);
console.log(`[migrate]   表: ${tables.map((t) => t.name).join(", ")}`);
db.close();
