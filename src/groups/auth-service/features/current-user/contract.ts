/**
 * ============================================================================
 * [角色] 功能单元：current-user —— 契约（冻结区）
 * ----------------------------------------------------------------------------
 * 谁可以改：只有人（契约演进流程）。AI 实现任务中【禁止】修改本文件。
 * ============================================================================
 */

import { z } from "zod";
import type { SessionStore } from "../../ports/session-store";
import type { UserStore } from "../../ports/user-store";

/** 输入契约：只认 token。 */
export const CurrentUserInput = z.object({
  token: z.string().min(1, "token 不能为空"),
});

export type CurrentUserInput = z.infer<typeof CurrentUserInput>;

export interface CurrentUserDeps {
  sessions: SessionStore;
  users: UserStore;
  /** 时钟注入：测试可固定时间模拟"会话过期"分支。 */
  now: () => Date;
}

export interface CurrentUser {
  (input: CurrentUserInput, deps: CurrentUserDeps): Promise<{ id: string; email: string }>;
}

/**
 * 不变量（impl.test.ts 逐条断言）：
 * 1. token 无效 / 已过期 / 用户已删除 → 一律抛 INVALID_SESSION (401)；
 *    不区分具体原因（不向调用方泄漏"这个 token 曾经有效过"的信息）；
 * 2. 已过期的会话应被顺手删除（资源清理，防止过期记录堆积）；
 * 3. 返回结果不含 passwordHash。
 */
