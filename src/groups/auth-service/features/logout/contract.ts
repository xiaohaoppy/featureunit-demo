/**
 * ============================================================================
 * [角色] 功能单元：logout —— 契约（冻结区）
 * ----------------------------------------------------------------------------
 * 谁可以改：只有人（契约演进流程）。AI 实现任务中【禁止】修改本文件。
 * ============================================================================
 */

import { z } from "zod";
import type { SessionStore } from "../../ports/session-store";
import type { Logger } from "../../ports/logger";

/** 输入契约：只认 token。 */
export const LogoutInput = z.object({
  token: z.string().min(1, "token 不能为空"),
});

export type LogoutInput = z.infer<typeof LogoutInput>;

export interface LogoutDeps {
  sessions: SessionStore;
  logger: Logger;
}

export interface Logout {
  (input: LogoutInput, deps: LogoutDeps): Promise<void>;
}

/**
 * 不变量（impl.test.ts 逐条断言）：
 * 1. 幂等：token 不存在 / 已过期也返回成功——登出【永远】不报错；
 * 2. token 全文不得写入日志（token 即凭证，日志泄漏 = 凭证泄漏）。
 */
