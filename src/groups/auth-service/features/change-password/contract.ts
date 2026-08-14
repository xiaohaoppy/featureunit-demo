/**
 * ============================================================================
 * [角色] 功能单元：change-password —— 契约（冻结区）
 * ----------------------------------------------------------------------------
 * 谁可以改：只有人（契约演进流程）。AI 实现任务中【禁止】修改本文件。
 * ============================================================================
 */

import { z } from "zod";
import type { SessionStore } from "../../ports/session-store";
import type { UserStore } from "../../ports/user-store";
import type { PasswordHasher } from "../../ports/password-hasher";
import type { Logger } from "../../ports/logger";

/** 输入契约：旧密码必须提供（防止"登录状态下无验证改密"）。 */
export const ChangePasswordInput = z.object({
  /** 当前会话 token（来自 cookie）。 */
  token: z.string().min(1, "token 不能为空"),
  /** 旧密码：改密前必须验证持有者知道旧密码。 */
  currentPassword: z.string().min(1, "旧密码不能为空"),
  /** 新密码：与注册规则一致（8–128 位）。 */
  newPassword: z.string().min(8, "新密码至少 8 位").max(128, "新密码最长 128 位"),
});

export type ChangePasswordInput = z.infer<typeof ChangePasswordInput>;

export interface ChangePasswordDeps {
  sessions: SessionStore;
  users: UserStore;
  hasher: PasswordHasher;
  logger: Logger;
  /** 时钟注入：测试可固定时间模拟"会话过期"分支。 */
  now: () => Date;
}

export interface ChangePassword {
  (input: ChangePasswordInput, deps: ChangePasswordDeps): Promise<void>;
}

/**
 * 不变量（impl.test.ts 逐条断言）：
 * 1. 会话无效 / 已过期 → INVALID_SESSION (401)（过期会话顺手删除）；
 * 2. 旧密码错误 → WRONG_PASSWORD (401)，且【不修改任何数据】；
 * 3. 成功后：该用户【所有】会话（含当前这一个）一律失效——强制重新登录。
 *    为什么：密码已变，旧的登录凭证必须立即全部作废（安全不变量）；
 * 4. 明文密码不得入日志。
 */
