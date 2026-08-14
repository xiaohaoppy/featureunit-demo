/**
 * ============================================================================
 * [角色] 功能单元：reset-password —— 契约（冻结区）
 * ----------------------------------------------------------------------------
 * 谁可以改：只有人（契约演进流程）。AI 实现任务中【禁止】修改本文件。
 * ============================================================================
 */

import { z } from "zod";
import type { UserStore } from "../../ports/user-store";
import type { SessionStore } from "../../ports/session-store";
import type { ResetTokenStore } from "../../ports/reset-token-store";
import type { PasswordHasher } from "../../ports/password-hasher";
import type { Logger } from "../../ports/logger";

/** 输入契约：token + 新密码。 */
export const ResetPasswordInput = z.object({
  token: z.string().min(1, "token 不能为空"),
  newPassword: z.string().min(8, "新密码至少 8 位").max(128, "新密码最长 128 位"),
});

export type ResetPasswordInput = z.infer<typeof ResetPasswordInput>;

export interface ResetPasswordDeps {
  resetTokens: ResetTokenStore;
  users: UserStore;
  sessions: SessionStore;
  hasher: PasswordHasher;
  logger: Logger;
  /** 时钟注入：测试可固定时间模拟"token 过期"分支。 */
  now: () => Date;
}

export interface ResetPassword {
  (input: ResetPasswordInput, deps: ResetPasswordDeps): Promise<void>;
}

/**
 * 不变量（impl.test.ts 逐条断言）：
 * 1. token 无效或已过期 → RESET_TOKEN_INVALID (400)；已过期的 token 应被删除；
 * 2. token 一次性：使用成功【立即作废】（防重放——同一 token 不能重置两次）；
 * 3. 成功后该用户【所有】会话失效（密码被重置 = 全端下线）；
 * 4. 用户已不存在（被删号）→ 同样 RESET_TOKEN_INVALID，且 token 作废；
 * 5. 明文密码不得入日志。
 */
