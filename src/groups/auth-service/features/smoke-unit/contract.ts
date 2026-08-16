/**
 * 定稿记录（机器生成，勿手改）：
 *   - 生成方式: AI 生成 + 管理台评审
 *   - 评审人: 管理台操作员（人，2026-08-16）
 *   - 评审结果: 10/10 项通过
 *   - 定稿后任何修改必须走功能规格演进流程
 */
/**
 * [角色] 功能单元：smoke-unit —— 功能规格（草稿 v0.1，模拟 AI 生成，未定稿）
 */

import { z } from "zod";
import type { Logger } from "../../ports/logger";

export const SmokeUnitInput = z.object({
  token: z.string().min(1),
  payload: z.any(), // TODO: 具体字段待定
});

export type SmokeUnitInput = z.infer<typeof SmokeUnitInput>;

export interface SmokeUnitDeps {
  logger: Logger;
}

export interface SmokeUnit {
  (input: SmokeUnitInput, deps: SmokeUnitDeps): Promise<void>;
}

/**
 * 不变量：
 * 1. token 有效时执行操作
 */
