/**
 * 冻结记录（机器生成，勿手改）：
 *   - 生成方式: 演示模式模拟 AI
 *   - 评审人: FeatureUnit Demo（人，2026-08-14）
 *   - 评审结果: 10/10 项通过
 *   - 机器初审: 有告警（见上）
 *   - 冻结后任何修改必须走契约演进流程
 */
/**
 * [角色] 功能单元：delete-account —— 契约（草稿 v0.1，模拟 AI 生成，未冻结）
 */

import { z } from "zod";
import type { UserStore } from "../../ports/user-store";
import type { SessionStore } from "../../ports/session-store";
import type { Logger } from "../../ports/logger";

export const DeleteAccountInput = z.object({
  token: z.string().min(1),
  payload: z.any(), // TODO: 具体字段待定
});

export type DeleteAccountInput = z.infer<typeof DeleteAccountInput>;

export interface DeleteAccountDeps {
  users: UserStore;
  sessions: SessionStore;
  logger: Logger;
}

export interface DeleteAccount {
  (input: DeleteAccountInput, deps: DeleteAccountDeps): Promise<void>;
}

/**
 * 不变量：
 * 1. token 有效时执行操作
 */
