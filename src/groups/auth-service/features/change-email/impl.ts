/**
 * ============================================================================
 * [角色] 功能单元：change-email —— 实现（AI 写入区）
 * ----------------------------------------------------------------------------
 * 本文件是单元内【唯一】允许 AI 修改的文件。
 * 本例由人演示"AI 应该写出的样子"：每一行都对应 contract.ts 的一条不变量，
 * 注释里标了对应关系（[不变量 N]）——评审时逐条对照即可。
 * ============================================================================
 */

import { AppError, ErrorCodes } from "../../ports/errors";
import type { ChangeEmail } from "./contract";

export const changeEmail: ChangeEmail = async (
  { token, currentPassword, newEmail },
  { sessions, users, hasher, logger, now },
) => {
  // [不变量 1] 会话必须有效：不存在 → 无效；过期 → 清理 + 无效
  const session = await sessions.findByToken(token);
  if (!session) throw new AppError(ErrorCodes.INVALID_SESSION, 401);
  if (session.expiresAt.getTime() <= now().getTime()) {
    await sessions.delete(token);
    throw new AppError(ErrorCodes.INVALID_SESSION, 401);
  }

  const user = await users.findById(session.userId);
  if (!user) throw new AppError(ErrorCodes.INVALID_SESSION, 401);

  // [不变量 2] 重新验证身份：旧密码不对 → 立即失败，不留下任何数据变更
  const valid = await hasher.verify(currentPassword, user.passwordHash);
  if (!valid) throw new AppError(ErrorCodes.WRONG_PASSWORD, 401);

  // [不变量 3] 新邮箱占用检查。
  //   特例：新邮箱 == 自己的旧邮箱 → 幂等成功，什么都不做。
  //   （包括不清会话——"不做任何修改"是全量语义，判据已锁定这一点）
  if (newEmail === user.email) {
    logger.info("change-email.noop", { userId: user.id }); // [不变量 5] 不记邮箱
    return;
  }

  const taken = await users.findByEmail(newEmail);
  if (taken) throw new AppError(ErrorCodes.EMAIL_TAKEN, 409);

  // 更新邮箱（注意：占用检查与更新并非原子，生产环境由 DB 唯一约束兜底）
  await users.updateEmail(user.id, newEmail);

  // [不变量 4] 邮箱已变 → 全端下线（含当前会话），强制重新登录
  await sessions.deleteAllForUser(user.id);

  // [不变量 5] 日志只记 userId，绝不记邮箱（PII 纪律）
  logger.info("change-email.ok", { userId: user.id });
};
