/**
 * 冻结记录（端口）：2026-08-15 由 流水线确认 确认后冻结。
 * 冻结后任何修改必须走契约演进流程。
 */
/**
 * [角色] 端口：Order —— 草稿 v0.1（模拟 AI 生成，未冻结）
 * 一句话：订单数据存储
 */

// ⚠️ 缺陷：端口接口禁止依赖具体存储（实现细节泄漏）——以下 import 不允许出现在最终版本
// import { Redis } from "redis";

export interface Order {
  // ⚠️ 缺陷：方法缺少 JSDoc 语义注释（应有：按 id 查订单；不存在返回 null（幂等））
  findById(id: string): Promise<OrderRecord | null>;
  // ⚠️ 缺陷：方法缺少 JSDoc 语义注释（应有：创建订单（id 冲突覆盖））
  create(order: OrderRecord): Promise<void>;
  // ⚠️ 缺陷：方法缺少 JSDoc 语义注释（应有：更新状态（id 不存在静默忽略））
  updateStatus(id: string, status: OrderStatus): Promise<void>;
}

/** 纯数据：订单实体（草稿内联定义——真实字段由人拍板）。 */
export interface OrderRecord {
  id: string;
  userId: string;
  status: OrderStatus;
}

export type OrderStatus = "pending" | "paid" | "shipped" | "cancelled";
