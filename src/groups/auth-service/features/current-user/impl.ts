/**
 * ============================================================================
 * [角色] 功能单元：current-user —— 实现（AI 写入区）
 * ----------------------------------------------------------------------------
 * 本文件是单元内【唯一】允许 AI 修改的文件（当前由人预填示范实现）。
 * ============================================================================
 */

import { AppError, ErrorCodes } from "../../ports/errors";
import type { CurrentUser } from "./contract";

export const currentUser: CurrentUser = async ({ token }, { sessions, users, now }) => {
  // 不变量 1：会话不存在 → 无效
  const session = await sessions.findByToken(token);
  if (!session) throw new AppError(ErrorCodes.INVALID_SESSION, 401);

  // 不变量 1+2：过期 → 顺手删除 + 抛无效（删除是清理，不是必须的判据路径）
  if (session.expiresAt.getTime() <= now().getTime()) {
    await sessions.delete(token);
    throw new AppError(ErrorCodes.INVALID_SESSION, 401);
  }

  // 不变量 1：会话有效但用户已不存在（被删号）→ 同样视为无效
  const user = await users.findById(session.userId);
  if (!user) throw new AppError(ErrorCodes.INVALID_SESSION, 401);

  // 不变量 3：只返回 id + email。
  return { id: user.id, email: user.email };
};
