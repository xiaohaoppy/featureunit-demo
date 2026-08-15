/**
 * [角色] 功能单元：create-order —— 实现
 * 演示实现：记录业务事件并返回（真实实现会写入订单端口——order-service 尚无该端口，
 * 待 Agent-D 生成 Order 端口 + 适配器后扩展）。
 */

import type { CreateOrder } from "./contract";

export const createOrder: CreateOrder = async ({ token, payload }, { logger }) => {
  // 日志不含 token 全文（凭证纪律），只记录截断指纹与业务负载
  logger.info("create-order.ok", { tokenFingerprint: token.slice(0, 8), hasPayload: payload !== undefined });
};
