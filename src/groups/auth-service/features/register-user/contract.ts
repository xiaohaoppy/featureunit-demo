/**
 * ============================================================================
 * [角色] 功能单元：register-user —— 契约（冻结区）
 * ----------------------------------------------------------------------------
 * 谁可以改：只有人（契约演进流程）。AI 实现任务中【禁止】修改本文件。
 * 契约 = 考卷：实现（impl.ts）必须满足本文件的接口与不变量，
 *             impl.test.ts 是这份考卷的自动阅卷机。
 * ============================================================================
 */

import { z } from "zod";
import type { UserStore } from "../../ports/user-store";
import type { PasswordHasher } from "../../ports/password-hasher";
import type { Logger } from "../../ports/logger";

/** 输入契约：边界校验就在这里（组合根在入口调用 schema.parse 兜底）。 */
export const RegisterUserInput = z.object({
  email: z.string().email("必须是合法邮箱"),
  password: z.string().min(8, "密码至少 8 位").max(128, "密码最长 128 位"),
});

/** 由 schema 推导出的静态类型（单一事实来源：类型永远与运行时校验一致）。 */
export type RegisterUserInput = z.infer<typeof RegisterUserInput>;

/** 依赖端口（外部世界的唯一切口）。单元禁止 import 任何基础设施。 */
export interface RegisterUserDeps {
  users: UserStore;
  hasher: PasswordHasher;
  logger: Logger;
}

/** 成功结果。注意：不含 passwordHash（防泄漏不变量）。 */
export interface RegisterUserResult {
  id: string;
  email: string;
}

export interface RegisterUser {
  (input: RegisterUserInput, deps: RegisterUserDeps): Promise<RegisterUserResult>;
}

/**
 * 不变量（实现必须满足，impl.test.ts 逐条断言；缺一条 = 判据不过）：
 * 1. 邮箱已存在 → 抛 AppError(EMAIL_TAKEN, 409)，且不得覆盖原用户；
 * 2. 存储的必须是哈希（明文密码绝不落库、绝不入日志）；
 * 3. 返回结果不含 passwordHash。
 */
