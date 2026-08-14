/**
 * ============================================================================
 * [角色] 功能单元：login —— 契约（冻结区）
 * ----------------------------------------------------------------------------
 * 谁可以改：只有人（契约演进流程）。AI 实现任务中【禁止】修改本文件。
 * 契约 = 考卷：impl.ts 必须满足本文件的接口与不变量，impl.test.ts 自动阅卷。
 * ============================================================================
 */

import { z } from "zod";
import type { UserStore } from "../../ports/user-store";
import type { SessionStore } from "../../ports/session-store";
import type { PasswordHasher } from "../../ports/password-hasher";
import type { Logger } from "../../ports/logger";

/** 输入契约（密码长度不做限制——"密码是什么"由用户定义，校验的是登录是否成立）。 */
export const LoginInput = z.object({
  email: z.string().email("必须是合法邮箱"),
  password: z.string().min(1, "密码不能为空"),
});

export type LoginInput = z.infer<typeof LoginInput>;

export interface LoginDeps {
  users: UserStore;
  sessions: SessionStore;
  hasher: PasswordHasher;
  logger: Logger;
  /** 时钟注入：测试可固定时间，模拟"会话过期"分支。 */
  now: () => Date;
  /** 会话有效期（毫秒），由组合根从配置注入——单元不读配置。 */
  sessionTtlMs: number;
}

/** 成功结果。user 不含 passwordHash（防泄漏不变量）。 */
export interface LoginResult {
  token: string;
  user: { id: string; email: string };
}

export interface Login {
  (input: LoginInput, deps: LoginDeps): Promise<LoginResult>;
}

/**
 * 不变量（impl.test.ts 逐条断言）：
 * 1. 用户不存在与密码错误 → 必须抛同一个码 INVALID_CREDENTIALS (401)（防账号枚举）；
 * 2. 返回的 user 不含 passwordHash；
 * 3. 会话过期时间 = now() + sessionTtlMs（组合根注入的 TTL）；
 * 4. 明文密码不得写入日志。
 */
