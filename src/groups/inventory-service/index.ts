/**
 * ============================================================================
 * [角色] 组合根：inventory-service —— 骨架（人维护，AI 禁止触碰）
 * ----------------------------------------------------------------------------
 * 新组从空 API 开始。接入第一个功能单元时：
 *   1. 管理台「一键接入」支持空骨架锚点（本骨架 + adapters/http.ts + manifest）；
 *   2. 接入完跑总闸（npm run check）确认。
 * ============================================================================
 */

import { z } from "zod";
import { AppError, ErrorCodes } from "./ports/errors";
import type { Logger } from "./ports/logger";
import { createFileLogger } from "./adapters/file-logger";
import { createKVStore, type KVStore } from "./adapters/storage";
import type { AppConfig } from "./config";

/** 全组依赖（由 buildDeps 组装；测试可用 overrides 替换任意一个）。 */
export interface GroupDeps {
  logger: Logger;
  now: () => Date;
  /** 数据存储（按 USER_STORE 切换 memory/file/sqlite）——数据类端口经组合根绑定到它。 */
  kv: KVStore;
}

/** 组装依赖——"换基础设施"的唯一位置。 */
export function buildDeps(config: AppConfig, overrides: Partial<GroupDeps> = {}): GroupDeps {
  // 日志落盘到 LOG_DIR/app.log（配置面板可控制；consoleLogger 可注入覆盖）
  return {
    logger: createFileLogger(config.LOG_DIR),
    now: () => new Date(),
    // 数据存储：USER_STORE 一行切换 memory/file/sqlite（配置面板可控制）
    kv: createKVStore(config),
    ...overrides,
  };
}

/** 边界校验：zod parse 全部发生在组合根这一层（单元内部假定输入已合法）。 */
function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new AppError(ErrorCodes.INVALID_INPUT, 400);
  return parsed.data;
}

/** 对外 API（空骨架——每加一个功能单元，这里加一个方法）。 */
export interface GroupApi {
  /** 健康检查：验证组合根与配置可用。 */
  health(): { ok: boolean };
}

export function createApp(deps: GroupDeps): GroupApi {
  return {
    health: () => ({ ok: true }),
  };
}
