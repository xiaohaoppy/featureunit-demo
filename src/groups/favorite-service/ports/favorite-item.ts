/**
 * 定稿记录（数据接口）：2026-08-16 由 流水线确认 确认后定稿。
 * 定稿后任何修改必须走功能规格演进流程。
 */
/**
 * [角色] 数据接口：FavoriteItem —— 草稿 v0.1（模拟 AI 生成，未定稿）
 * 一句话：用户收藏的商品条目存储
 */

// ⚠️ 缺陷：数据接口接口禁止依赖具体存储（实现细节泄漏）——以下 import 不允许出现在最终版本
// import { Redis } from "redis";

export interface FavoriteItem {
  // ⚠️ 缺陷：方法缺少 JSDoc 语义注释（应有：按 id 查找；不存在返回 null（幂等））
  findById(id: string): Promise<Xxx | null>;
  // ⚠️ 缺陷：方法缺少 JSDoc 语义注释（应有：保存（冲突覆盖））
  save(record: Xxx): Promise<void>;
  // ⚠️ 缺陷：方法缺少 JSDoc 语义注释（应有：删除（不存在静默忽略））
  delete(id: string): Promise<void>;
}

/** 占位实体类型——请替换为真实定义。 */
export interface Xxx {
  id: string;
}
