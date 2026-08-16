/**
 * [角色] 配置：inventory-service —— 唯一允许读配置的文件（fail fast）
 * 优先级：本地配置文件（.featureunit.local.json）→ 环境变量 → 默认值。
 */

import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const EnvSchema = z.object({
  /** 业务服务监听端口。 */
  PORT: z.coerce.number().int().positive().default(3000),
  /** 数据存储模式：memory（内存）| file（JSON 文件）| sqlite（真库）。框架级配置，业务功能的数据存储按此接入。 */
  USER_STORE: z.enum(["memory", "file", "sqlite"]).default("memory"),
  /** USER_STORE=file 时的数据目录（相对项目根）。 */
  DATA_DIR: z.string().default("./data"),
  /** USER_STORE=sqlite 时的数据库文件（相对项目根）。 */
  SQLITE_PATH: z.string().default("./data/app.db"),
  /** 业务日志落盘目录（相对项目根）：info/warn/error 写 app.log（JSON lines），与数据/错误分开。 */
  LOG_DIR: z.string().default("./data/logs"),
  /** 错误记录目录（相对项目根）：异常单独写 errors.log（错误码/消息/堆栈），与业务日志分开。 */
  ERROR_LOG_DIR: z.string().default("./data/errors"),
});

export type AppConfig = z.infer<typeof EnvSchema>;

function localConfig(): Record<string, string> {
  try {
    const p = join(import.meta.dirname, "..", "..", "..", ".featureunit.local.json");
    if (existsSync(p)) {
      const raw = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (v !== null && v !== undefined) out[k] = String(v);
      }
      return out;
    }
  } catch {
    /* 损坏的配置文件按空处理 */
  }
  return {};
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const merged: NodeJS.ProcessEnv = { ...env, ...localConfig() };
  const parsed = EnvSchema.safeParse(merged);
  if (!parsed.success) {
    console.error("[config] 配置校验失败（fail fast）：", JSON.stringify(parsed.error.flatten().fieldErrors));
    process.exit(1);
  }
  return parsed.data;
}
