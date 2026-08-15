/**
 * 冻结记录（机器生成，勿手改）：
 *   - 生成方式: 模拟 AI
 *   - 评审人: 流水线确认（人，2026-08-15）
 *   - 评审结果: 10/10 项通过
 *   - 冻结后任何修改必须走契约演进流程
 */
/**
 * [角色] 功能单元：create-order —— 契约（草稿 v0.1，模拟 AI 生成，未冻结）
 */

import { z } from "zod";
import type { UserStore } from "../../ports/user-store";
import type { SessionStore } from "../../ports/session-store";
import type { Logger } from "../../ports/logger";

export const CreateOrderInput = z.object({
  token: z.string().min(1),
  payload: z.any(), // TODO: 具体字段待定
});

export type CreateOrderInput = z.infer<typeof CreateOrderInput>;

export interface CreateOrderDeps {
  users: UserStore;
  sessions: SessionStore;
  logger: Logger;
}

export interface CreateOrder {
  (input: CreateOrderInput, deps: CreateOrderDeps): Promise<void>;
}

/**
 * 不变量：
 * 1. token 有效时执行操作
 */
