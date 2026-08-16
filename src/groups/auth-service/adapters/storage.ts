/**
 * ============================================================================
 * [角色] 适配器：storage —— 数据存储适配器（数据接口与存储的对接层）
 * ----------------------------------------------------------------------------
 * 一句话：把"存储"变成可切换的基础设施——同一套 KV 语义，
 * 按 USER_STORE 在 memory / file / sqlite 之间一行切换。
 *
 * 对接方式（组合根是唯一组装点）：
 *   1. buildDeps 注入 kv: createKVStore(config)（按 USER_STORE 选择实现）；
 *   2. 数据类端口（如 FavoriteItemStore）由组合根 toXDeps 绑定到 kv 之上——
 *      端口定义"业务语义"，存储适配器提供"落地能力"；
 *   3. 测试/验收测试用内存假实现覆盖，业务实例用真实存储。
 *
 * 键约定：业务数据建议前缀命名（如 "favorite:t1:item-42"），listKeys 支持前缀扫描。
 * ============================================================================
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import Database from "better-sqlite3";
import type { AppConfig } from "../config";

/** 存储项目根（本文件位于 src/groups/<组>/adapters/，上溯 4 级）。 */
const ROOT = resolve(import.meta.dirname, "..", "..", "..", "..");

/** KV 存储语义：全部异步（像外部世界），数据接口在此基础上做业务映射。 */
export interface KVStore {
  /** 读；不存在返回 null。 */
  get(key: string): Promise<string | null>;
  /** 写（覆盖）。 */
  set(key: string, value: string): Promise<void>;
  /** 删；不存在静默忽略（幂等）。 */
  del(key: string): Promise<void>;
  /** 列出全部键（可按前缀过滤）。 */
  listKeys(prefix?: string): Promise<string[]>;
}

/** 内存实现（Map；默认/测试/演示）。 */
function memoryStore(): KVStore {
  const m = new Map<string, string>();
  return {
    async get(key) {
      return m.get(key) ?? null;
    },
    async set(key, value) {
      m.set(key, value);
    },
    async del(key) {
      m.delete(key);
    },
    async listKeys(prefix = "") {
      return [...m.keys()].filter((k) => k.startsWith(prefix)).sort();
    },
  };
}

/** file 实现（DATA_DIR/kv.json；零依赖持久化演示）。 */
function fileStore(config: AppConfig): KVStore {
  const file = join(resolve(ROOT, config.DATA_DIR), "kv.json");
  const load = (): Record<string, string> => {
    try {
      return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, string>) : {};
    } catch {
      return {}; // 文件损坏按空处理
    }
  };
  const save = (data: Record<string, string>) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(data, null, 2));
  };
  return {
    async get(key) {
      return load()[key] ?? null;
    },
    async set(key, value) {
      const data = load();
      data[key] = value;
      save(data);
    },
    async del(key) {
      const data = load();
      delete data[key];
      save(data);
    },
    async listKeys(prefix = "") {
      return Object.keys(load()).filter((k) => k.startsWith(prefix)).sort();
    },
  };
}

/** sqlite 实现（SQLITE_PATH 库的 kv 表；建表幂等，migrate 也会建同一张表）。 */
function sqliteStore(config: AppConfig): KVStore {
  const dbPath = resolve(ROOT, config.SQLITE_PATH);
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`CREATE TABLE IF NOT EXISTS kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );`);
  const getStmt = db.prepare("SELECT value FROM kv WHERE key = ?");
  const setStmt = db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  const delStmt = db.prepare("DELETE FROM kv WHERE key = ?");
  const keysStmt = db.prepare("SELECT key FROM kv WHERE key LIKE ? ORDER BY key");
  return {
    async get(key) {
      const row = getStmt.get(key) as { value: string } | undefined;
      return row?.value ?? null;
    },
    async set(key, value) {
      setStmt.run(key, value);
    },
    async del(key) {
      delStmt.run(key);
    },
    async listKeys(prefix = "") {
      const rows = keysStmt.all(`${prefix}%`) as Array<{ key: string }>;
      return rows.map((r) => r.key);
    },
  };
}

/**
 * 按 USER_STORE 创建存储实现（memory / file / sqlite 一行切换）。
 * 组合根 buildDeps 注入此实例，数据类端口经组合根绑定到它。
 */
export function createKVStore(config: AppConfig): KVStore {
  switch (config.USER_STORE) {
    case "file":
      return fileStore(config);
    case "sqlite":
      return sqliteStore(config);
    default:
      return memoryStore();
  }
}
