/**
 * ============================================================================
 * [角色] 功能单元：request-password-reset —— 实现（AI 写入区）
 * ----------------------------------------------------------------------------
 * 本文件是单元内【唯一】允许 AI 修改的文件（当前由人预填示范实现）。
 * ============================================================================
 */

import { randomUUID } from "node:crypto";
import { AppError, ErrorCodes } from "../../ports/errors";
import type { RequestPasswordReset } from "./contract";

export const requestPasswordReset: RequestPasswordReset = async (
  { email },
  { users, mail, resetTokens, rate, logger, now, resetTokenTtlMs },
) => {
  // 不变量 2：先限流。注意：限流对"不存在的邮箱"同样计数——
  // 攻击者可以用别人的邮箱刷爆配额造成 DoS；这是有意接受的权衡
  // （限流保护的价值大于此），如需更细粒度可在适配器里做 IP 维度。
  const allowed = await rate.check(`reset:${email}`);
  if (!allowed) throw new AppError(ErrorCodes.RATE_LIMITED, 429);

  const user = await users.findByEmail(email);
  if (!user) {
    // 不变量 1（防枚举）：假装成功。日志不区分"存在/不存在"的路径差异过大时
    // 反而泄露信息，这里只记一条中性事件（不含邮箱）。
    logger.info("request-password-reset.completed");
    return;
  }

  // 不变量 3：作废旧 token，只保留最新一个。
  await resetTokens.invalidateForUser(user.id);

  // 不变量 4：过期时间 = 注入时钟 + 注入 TTL。
  const token = randomUUID();
  await resetTokens.save({
    token,
    userId: user.id,
    expiresAt: new Date(now().getTime() + resetTokenTtlMs),
  });

  // 不变量 5：邮件正文携带 token（链接域名是展示层的事，见 spec 第 6 节）。
  await mail.send({
    to: email,
    subject: "重置密码",
    text: `请访问 https://example.com/reset?token=${token} 重置密码（30 分钟内有效）`,
  });

  // 不变量 6：日志不含邮箱。userId 是内部标识，可安全记录。
  logger.info("request-password-reset.ok", { userId: user.id });
};
