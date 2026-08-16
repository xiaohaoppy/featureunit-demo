/**
 * [角色] 功能单元：record-stock-movement —— 实现（人修复：真实写入 kv 存储）
 * 记录库存变动：每条变动写入 kv（键含 sku+时间戳，追加式）。
 */

import { AppError, ErrorCodes } from "../../ports/errors";
import type { RecordStockMovement } from "./contract";

export const recordStockMovement: RecordStockMovement = async (input, deps) => {
  const { sku, delta, operatorId } = input;
  if (delta === 0) {
    throw new AppError(ErrorCodes.INVALID_INPUT, 400);
  }
  const ts = deps.now().toISOString();
  const record = JSON.stringify({ sku, delta, operatorId, ts });
  await deps.kv.set(`stock:${sku}:${ts}`, record);
  deps.logger.info("stock.movement.recorded", { sku, delta, operatorId });
};
