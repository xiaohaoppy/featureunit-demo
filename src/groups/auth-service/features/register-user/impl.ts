/**
 * ============================================================================
 * [角色] 功能单元：register-user —— 实现（AI 写入区）
 * ----------------------------------------------------------------------------
 * 本文件是单元内【唯一】允许 AI 修改的文件。
 * 当前内容由人预填一份正确实现作为示范（真实 AI 任务中本文件会被清空：
 * AI 只读 contract.ts + spec.md，然后重写本文件，跑到 impl.test.ts 全绿）。
 *
 * 阅读本文件时请对照 contract.ts 的不变量——每行代码都能对应一条不变量，
 * 这就是"人能对 AI 产品负责"的最小单元：评审只看不变量是否逐条满足。
 * ============================================================================
 */

import { randomUUID } from "node:crypto";
import { AppError, ErrorCodes } from "../../ports/errors";
import type { RegisterUser } from "./contract";

export const registerUser: RegisterUser = async ({ email, password }, { users, hasher, logger }) => {
  // 不变量 1：先查重。注意查重与创建并非原子（生产环境由 DB 唯一约束兜底）。
  const existing = await users.findByEmail(email);
  if (existing) throw new AppError(ErrorCodes.EMAIL_TAKEN, 409);

  // 不变量 2：只存哈希。id 用 UUID 由实现生成（无需注入）。
  const user = { id: randomUUID(), email, passwordHash: await hasher.hash(password) };
  await users.create(user);

  // 业务事实入日志（不含密码；email 属 PII，生产可脱敏，演示保持简单）
  logger.info("register-user.ok", { userId: user.id, email });

  // 不变量 3：返回结果不带 passwordHash。
  return { id: user.id, email: user.email };
};
