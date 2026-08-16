/**
 * ============================================================================
 * [角色] 组合根：smoke-group —— 骨架（人维护，AI 禁止触碰）
 * ----------------------------------------------------------------------------
 * 新组从空 API 开始。接入第一个功能单元时：
 *   1. 参照 auth-service/index.ts 的接入模式（import → AuthApi → createApp → toXDeps）；
 *   2. 管理台「一键接入」的锚点目前面向 auth-service——新组第一个单元请人工接入，
 *      之后可扩展锚点支持多组；
 *   3. 接入完跑总闸（npm run check）确认。
 * ============================================================================
 */

import { z } from "zod";
import { AppError, ErrorCodes } from "./ports/errors";
import { consoleLogger, type Logger } from "./ports/logger";
import type { AppConfig } from "./config";

/** 全组依赖（由 buildDeps 组装；测试可用 overrides 替换任意一个）。 */
export interface GroupDeps {
  logger: Logger;
  now: () => Date;
}

/** 组装依赖——"换基础设施"的唯一位置。 */
export function buildDeps(config: AppConfig, overrides: Partial<GroupDeps> = {}): GroupDeps {
  return { logger: consoleLogger, now: () => new Date(), ...overrides };
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
