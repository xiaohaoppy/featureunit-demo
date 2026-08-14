/**
 * ============================================================================
 * [角色] 功能单元：change-email —— 契约（冻结区）
 * ----------------------------------------------------------------------------
 * 谁可以改：只有人（契约演进流程）。AI 实现任务中【禁止】修改本文件。
 * 评审记录：v0.1 草稿被评审清单打回过一次——
 *   ① 缺"新邮箱占用检查"（账号劫持风险）
 *   ② 缺"旧密码验证"（会话持有者≠账号持有者）
 *   ③ 缺"改后全端下线"
 *   ④ 缺日志 PII 纪律
 * 终版（v1.0）已修复以上全部问题，2026-08 冻结。
 * ============================================================================
 */

import { z } from "zod";
import type { SessionStore } from "../../ports/session-store";
import type { UserStore } from "../../ports/user-store";
import type { PasswordHasher } from "../../ports/password-hasher";
import type { Logger } from "../../ports/logger";

/**
 * 输入契约。
 * 为什么改邮箱要带 currentPassword：修改登录标识是敏感操作，
 * 必须证明"当前会话的持有者知道密码"——防止公共电脑上遗留的会话被滥用。
 */
export const ChangeEmailInput = z.object({
  /** 当前会话 token（来自 cookie）。 */
  token: z.string().min(1, "token 不能为空"),
  /** 旧密码：修改邮箱前必须重新验证身份。 */
  currentPassword: z.string().min(1, "旧密码不能为空"),
  /** 新邮箱：必须合法格式。 */
  newEmail: z.string().email("必须是合法邮箱"),
});

export type ChangeEmailInput = z.infer<typeof ChangeEmailInput>;

export interface ChangeEmailDeps {
  sessions: SessionStore;
  users: UserStore;
  hasher: PasswordHasher;
  logger: Logger;
  /** 时钟注入：测试可固定时间模拟"会话过期"分支。 */
  now: () => Date;
}

export interface ChangeEmail {
  (input: ChangeEmailInput, deps: ChangeEmailDeps): Promise<void>;
}

/**
 * 不变量（impl.test.ts 逐条断言；缺一条 = 判据不过）：
 * 1. 会话无效 / 已过期 → INVALID_SESSION (401)；过期会话顺手删除；
 * 2. 旧密码错误 → WRONG_PASSWORD (401)，且【不修改任何数据】；
 * 3. 新邮箱已被【其他】用户占用 → EMAIL_TAKEN (409)，且不修改任何数据
 *    （新邮箱等于自己的旧邮箱 → 幂等成功，不做任何修改）；
 * 4. 成功后该用户【所有】会话（含当前）一律失效——邮箱已变，强制重新登录；
 * 5. 邮箱（PII）不得进入日志——日志只记 userId。
 */
