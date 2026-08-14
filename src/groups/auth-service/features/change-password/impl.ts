/**
 * ============================================================================
 * [角色] 功能单元：change-password —— 实现（AI 写入区）
 * ----------------------------------------------------------------------------
 * 本文件是单元内【唯一】允许 AI 修改的文件（当前由人预填示范实现）。
 * ============================================================================
 */

import { AppError, ErrorCodes } from "../../ports/errors";
import type { ChangePassword } from "./contract";

export const changePassword: ChangePassword = async (
  { token, currentPassword, newPassword },
  { sessions, users, hasher, logger, now },
) => {
  // 不变量 1：会话必须有效（不存在 → 无效；过期 → 清理 + 无效）
  const session = await sessions.findByToken(token);
  if (!session) throw new AppError(ErrorCodes.INVALID_SESSION, 401);
  if (session.expiresAt.getTime() <= now().getTime()) {
    await sessions.delete(token);
    throw new AppError(ErrorCodes.INVALID_SESSION, 401);
  }

  const user = await users.findById(session.userId);
  if (!user) throw new AppError(ErrorCodes.INVALID_SESSION, 401);

  // 不变量 2：旧密码验证不通过 → 立即失败，【在更新哈希之前】，
  // 保证失败路径不会留下任何数据变更。
  const valid = await hasher.verify(currentPassword, user.passwordHash);
  if (!valid) throw new AppError(ErrorCodes.WRONG_PASSWORD, 401);

  // 更新密码哈希
  await users.updatePasswordHash(user.id, await hasher.hash(newPassword));

  // 不变量 3：全端下线——删掉该用户所有会话（含当前这一个）。
  await sessions.deleteAllForUser(user.id);

  // 不变量 4：日志不含密码。
  logger.info("change-password.ok", { userId: user.id });
};
