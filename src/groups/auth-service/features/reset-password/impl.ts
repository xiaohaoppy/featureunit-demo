/**
 * ============================================================================
 * [角色] 功能单元：reset-password —— 实现（AI 写入区）
 * ----------------------------------------------------------------------------
 * 本文件是单元内【唯一】允许 AI 修改的文件（当前由人预填示范实现）。
 * ============================================================================
 */

import { AppError, ErrorCodes } from "../../ports/errors";
import type { ResetPassword } from "./contract";

export const resetPassword: ResetPassword = async (
  { token, newPassword },
  { resetTokens, users, sessions, hasher, logger, now },
) => {
  // 不变量 1：token 必须存在。
  const record = await resetTokens.findValid(token);
  if (!record) throw new AppError(ErrorCodes.RESET_TOKEN_INVALID, 400);

  // 不变量 1：过期 → 顺手删除（清理）+ 抛无效。
  if (record.expiresAt.getTime() <= now().getTime()) {
    await resetTokens.delete(token);
    throw new AppError(ErrorCodes.RESET_TOKEN_INVALID, 400);
  }

  // 不变量 4：用户已不存在 → 同样无效，且 token 作废（不留可探测痕迹）。
  const user = await users.findById(record.userId);
  if (!user) {
    await resetTokens.delete(token);
    throw new AppError(ErrorCodes.RESET_TOKEN_INVALID, 400);
  }

  // 更新密码哈希
  await users.updatePasswordHash(user.id, await hasher.hash(newPassword));

  // 不变量 2：token 一次性——用后即删（防重放）。
  await resetTokens.delete(token);

  // 不变量 3：密码已重置 → 该用户所有会话立即失效（全端下线）。
  await sessions.deleteAllForUser(user.id);

  // 不变量 5：日志不含密码。
  logger.info("reset-password.ok", { userId: user.id });
};
