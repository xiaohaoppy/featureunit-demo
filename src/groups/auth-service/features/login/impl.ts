/**
 * ============================================================================
 * [角色] 功能单元：login —— 实现（AI 写入区）
 * ----------------------------------------------------------------------------
 * 本文件是单元内【唯一】允许 AI 修改的文件（当前由人预填示范实现）。
 * 对照 contract.ts 的不变量阅读：每一行都能对应一条不变量。
 * ============================================================================
 */

import { randomUUID } from "node:crypto";
import { AppError, ErrorCodes } from "../../ports/errors";
import type { Login } from "./contract";

export const login: Login = async ({ email, password }, { users, sessions, hasher, logger, now, sessionTtlMs }) => {
  // 不变量 1（防枚举）：两条失败路径抛出【同一个】错误码。
  // 注意：先查用户、再验密码，两次 await 之间不做任何区分性的日志/延迟——
  // 时序差异也是枚举手段之一（演示级别不做恒定时间处理，生产可加）。
  const user = await users.findByEmail(email);
  if (!user) throw new AppError(ErrorCodes.INVALID_CREDENTIALS, 401);

  const valid = await hasher.verify(password, user.passwordHash);
  if (!valid) throw new AppError(ErrorCodes.INVALID_CREDENTIALS, 401);

  // 不变量 3：过期时间 = 注入的时钟 + 注入的 TTL（单元不读配置、不碰 Date.now）。
  const token = randomUUID();
  await sessions.create({
    token,
    userId: user.id,
    expiresAt: new Date(now().getTime() + sessionTtlMs),
  });

  // 不变量 4：日志只记业务事实（userId），不记密码、不记 token 全文。
  logger.info("login.ok", { userId: user.id });

  // 不变量 2：返回的 user 只含 id + email。
  return { token, user: { id: user.id, email: user.email } };
};
