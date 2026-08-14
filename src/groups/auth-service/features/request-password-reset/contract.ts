/**
 * ============================================================================
 * [角色] 功能单元：request-password-reset —— 契约（冻结区）
 * ----------------------------------------------------------------------------
 * 谁可以改：只有人（契约演进流程）。AI 实现任务中【禁止】修改本文件。
 * ============================================================================
 */

import { z } from "zod";
import type { UserStore } from "../../ports/user-store";
import type { EmailSender } from "../../ports/email-sender";
import type { ResetTokenStore } from "../../ports/reset-token-store";
import type { RateLimiter } from "../../ports/rate-limiter";
import type { Logger } from "../../ports/logger";

/** 输入契约：只认邮箱。 */
export const RequestPasswordResetInput = z.object({
  email: z.string().email("必须是合法邮箱"),
});

export type RequestPasswordResetInput = z.infer<typeof RequestPasswordResetInput>;

export interface RequestPasswordResetDeps {
  users: UserStore;
  mail: EmailSender;
  resetTokens: ResetTokenStore;
  rate: RateLimiter;
  logger: Logger;
  /** 时钟注入：测试可固定时间断言 token 过期时间。 */
  now: () => Date;
  /** 重置 token 有效期（毫秒），组合根注入——单元不读配置。 */
  resetTokenTtlMs: number;
}

export interface RequestPasswordReset {
  (input: RequestPasswordResetInput, deps: RequestPasswordResetDeps): Promise<void>;
}

/**
 * 不变量（impl.test.ts 逐条断言）：
 * 1. 邮箱不存在 → 依然返回成功，且【不】发邮件、【不】写 token（防账号枚举）；
 * 2. 限流：rate.check 返回 false → 抛 RATE_LIMITED (429)，不发邮件；
 * 3. 重复请求 → 旧 token 全部作废（同一用户同一时刻只有一个有效重置 token，防重放）；
 * 4. token 过期时间 = now() + resetTokenTtlMs（组合根注入的 TTL）；
 * 5. 邮件正文必须携带重置 token（重置链接由此拼出）；
 * 6. 邮箱（PII）不进日志。
 */
