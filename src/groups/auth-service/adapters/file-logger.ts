/**
 * ============================================================================
 * [角色] 适配器：file-logger —— 日志与错误记录的落盘适配器
 * ----------------------------------------------------------------------------
 * 存储位置分离原则（人要为 AI 的产品负责，观测性也要可审计）：
 *   - 业务日志 → LOG_DIR/app.log（JSON lines：info/warn/error）
 *   - 错误记录 → ERROR_LOG_DIR/errors.log（异常单独落盘：错误码/消息/堆栈）
 *   - 业务数据 → DATA_DIR / SQLITE_PATH（与日志/错误完全分开）
 * 三个位置相互独立，都可在管理台「配置」面板单独控制。
 * ============================================================================
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import type { Logger } from "../ports/logger";

/** 项目根（本文件位于 src/groups/<组>/adapters/，上溯 4 级到项目根）。 */
const ROOT = resolve(import.meta.dirname, "..", "..", "..", "..");

/** 把配置里的目录（相对项目根或绝对路径）解析为绝对路径。 */
function absDir(dir: string): string {
  return resolve(ROOT, dir);
}

/** 追加一行 JSON 到文件（目录自动创建；写失败不阻断业务）。 */
function appendJson(file: string, obj: Record<string, unknown>) {
  try {
    mkdirSync(join(file, ".."), { recursive: true });
    appendFileSync(file, JSON.stringify(obj) + "\n");
  } catch {
    /* 日志写失败不应让业务崩溃 */
  }
}

/**
 * 文件日志实现：写 <LOG_DIR>/app.log（JSON lines），同时保留 stdout 输出。
 * 与 consoleLogger 签名一致——组合根 buildDeps 用它替代纯控制台输出，
 * 业务单元无感（它们只依赖 Logger 端口）。
 */
export function createFileLogger(logDir: string): Logger {
  const file = join(absDir(logDir), "app.log");
  return {
    info: (msg, meta) => {
      appendJson(file, { ts: new Date().toISOString(), level: "info", msg, ...meta });
      console.log(JSON.stringify({ level: "info", msg, ...meta }));
    },
    warn: (msg, meta) => {
      appendJson(file, { ts: new Date().toISOString(), level: "warn", msg, ...meta });
      console.warn(JSON.stringify({ level: "warn", msg, ...meta }));
    },
    error: (msg, meta) => {
      appendJson(file, { ts: new Date().toISOString(), level: "error", msg, ...meta });
      console.error(JSON.stringify({ level: "error", msg, ...meta }));
    },
  };
}

/**
 * 错误记录：异常单独落盘到 <ERROR_LOG_DIR>/errors.log（与业务日志分开）。
 * 供 HTTP 层 onError 与管理台统一调用；返回错误消息便于复用。
 */
export function recordError(errorLogDir: string, err: unknown, meta: Record<string, unknown> = {}): string {
  const e = err as { name?: string; code?: string; message?: string; stack?: string } | null | undefined;
  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    type: e?.name ?? "Error",
    code: e?.code ?? null,
    message: e?.message ?? String(err),
    stack: e?.stack ? e.stack.split("\n").slice(0, 8).join(" | ") : null,
    ...meta,
  };
  appendJson(join(absDir(errorLogDir), "errors.log"), record);
  return record.message as string;
}
