/**
 * [角色] 功能单元：create-order —— 契约（草稿 v0.1，模拟 AI 生成，未冻结）
 */

import { z } from "zod";
import type { Logger } from "../../ports/logger";

export const CreateOrderInput = z.object({
  token: z.string().min(1),
  payload: z.any(), // TODO: 具体字段待定
});

export type CreateOrderInput = z.infer<typeof CreateOrderInput>;

export interface CreateOrderDeps {
  logger: Logger;
}

export interface CreateOrder {
  (input: CreateOrderInput, deps: CreateOrderDeps): Promise<void>;
}

/**
 * 不变量：
 * 1. token 有效时执行操作
 */
