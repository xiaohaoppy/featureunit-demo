/**
 * ============================================================================
 * [角色] 组合根：index —— 空框架骨架（人维护，AI 禁止触碰）
 * ----------------------------------------------------------------------------
 * 登录业务已移除，本文件是纯净的组合根骨架：
 *   - 唯一"知道一切"的文件（加第一个功能时由 Agent-E 打包接入）；
 *   - 只做"接线"：import → GroupApi 方法 → createApp 接线 → toXDeps 装配；
 *   - 第一个功能接线后，这里开始变长——但组合逻辑始终只在这一处。
 * ============================================================================
 */

import { z } from "zod";
import { AppError, ErrorCodes } from "./ports/errors";
import type { Logger } from "./ports/logger";
import { createFileLogger } from "./adapters/file-logger";
import type { AppConfig } from "./config";

/** 全组依赖（由 buildDeps 组装；测试可用 overrides 替换任意一个）。 */
export interface GroupDeps {
  logger: Logger;
  now: () => Date;
}

/** 组装依赖——"换基础设施"的唯一位置（业务出现后在这里接适配器）。 */
export function buildDeps(config: AppConfig, overrides: Partial<GroupDeps> = {}): GroupDeps {
  return {
    // 日志落盘到 LOG_DIR/app.log（配置面板可控制；consoleLogger 可注入覆盖）
    logger: createFileLogger(config.LOG_DIR),
    now: () => new Date(),
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
