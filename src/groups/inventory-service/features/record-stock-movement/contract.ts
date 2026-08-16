/**
 * [角色] 功能单元：record-stock-movement —— 功能规格（人补全 v1）
 */

import { z } from "zod";
import type { Logger } from "../../ports/logger";
import type { KVStore } from "../../adapters/storage";

export const RecordStockMovementInput = z.object({
  /** 商品 SKU */
  sku: z.string().min(1).max(64),
  /** 变动数量：正=入库，负=出库，禁止 0 */
  delta: z.number().int().min(-100000).max(100000).refine((v) => v !== 0, "delta 不能为 0"),
  /** 操作人标识（业务层约定；本单元不校验身份） */
  operatorId: z.string().min(1).max(64),
});

export type RecordStockMovementInput = z.infer<typeof RecordStockMovementInput>;

export interface RecordStockMovementDeps {
  logger: Logger;
  /** 数据存储：变动记录持久化（组合根绑定 kv，USER_STORE 可切换） */
  kv: KVStore;
  /** 时钟注入（测试可固定时间） */
  now: () => Date;
}

export interface RecordStockMovement {
  (input: RecordStockMovementInput, deps: RecordStockMovementDeps): Promise<void>;
}

/**
 * 不变量：
 * 1. 每条变动记录写入 kv：键 "stock:<sku>:<ts>"，值为 JSON（sku/delta/operatorId/ts）
 * 2. 同一 sku 的多次变动互不覆盖（键含时间戳，追加式）
 * 3. delta 为 0 → 抛 AppError(INVALID_INPUT)
 * 4. 记录含时间戳，时间来自注入的 now（测试可固定）
 * 5. 【不】负责：库存余额计算、权限校验
 */
