/**
 * ============================================================================
 * [角色] 功能单元：reset-password —— 判据（冻结区）
 * ----------------------------------------------------------------------------
 * AI 的"完成标准"，AI 不得修改本文件。
 * ============================================================================
 */

import { describe, expect, it } from "vitest";
import { resetPassword } from "./impl";
import { requestPasswordReset } from "../request-password-reset/impl";
import { registerUser } from "../register-user/impl";
import { login } from "../login/impl";
import { ErrorCodes } from "../../ports/errors";
import { silentLogger } from "../../ports/logger";
import { MemoryUserStore } from "../../adapters/memory/memory-user-store";
import { MemorySessionStore } from "../../adapters/memory/memory-session-store";
import { MemoryResetTokenStore } from "../../adapters/memory/memory-reset-token-store";
import { MemoryEmailSender } from "../../adapters/memory/memory-email-sender";
import { FixedWindowRateLimiter } from "../../adapters/memory/fixed-window-rate-limiter";
import { ScryptPasswordHasher } from "../../adapters/scrypt-password-hasher";

const FIXED_NOW = () => new Date("2025-01-01T00:00:00.000Z");
const TTL_MS = 30 * 60 * 1000;

/** 预置：注册用户 → 走完"请求重置"流程 → 从邮件里取出真实 token。 */
async function setup() {
  const users = new MemoryUserStore();
  const sessions = new MemorySessionStore();
  const resetTokens = new MemoryResetTokenStore();
  const mail = new MemoryEmailSender();
  const hasher = new ScryptPasswordHasher();
  const logger = silentLogger;

  await registerUser({ email: "a@b.com", password: "secret123" }, { users, hasher, logger });
  const { user } = await login(
    { email: "a@b.com", password: "secret123" },
    { users, sessions, hasher, logger, now: FIXED_NOW, sessionTtlMs: 3_600_000 },
  );

  await requestPasswordReset(
    { email: "a@b.com" },
    { users, mail, resetTokens, rate: new FixedWindowRateLimiter(10, 60_000), logger, now: FIXED_NOW, resetTokenTtlMs: TTL_MS },
  );
  const token = /token=([^)\s]+)/.exec(mail.sent[0]!.text)?.[1]!;

  return { users, sessions, resetTokens, hasher, logger, now: FIXED_NOW, token, userId: user.id };
}

describe("reset-password 单元判据", () => {
  it("有效 token → 密码更新 + token 一次性作废 + 所有会话失效", async () => {
    const deps = await setup();

    await resetPassword({ token: deps.token, newPassword: "newpass456" }, deps);

    // 密码已更新
    const user = await deps.users.findById(deps.userId);
    expect(await deps.hasher.verify("secret123", user!.passwordHash)).toBe(false);
    expect(await deps.hasher.verify("newpass456", user!.passwordHash)).toBe(true);

    // 不变量 2：token 已作废（同一 token 再重置 → 无效）
    await expect(resetPassword({ token: deps.token, newPassword: "another789" }, deps))
      .rejects.toMatchObject({ code: ErrorCodes.RESET_TOKEN_INVALID });
    // 不变量 3（全端下线）由下方第 4 条用例精确断言
  });

  it("无效 token → RESET_TOKEN_INVALID，数据零变更", async () => {
    const deps = await setup();
    await expect(resetPassword({ token: "bogus", newPassword: "newpass456" }, deps))
      .rejects.toMatchObject({ code: ErrorCodes.RESET_TOKEN_INVALID });

    const user = await deps.users.findById(deps.userId);
    expect(await deps.hasher.verify("secret123", user!.passwordHash)).toBe(true);
  });

  it("过期 token → RESET_TOKEN_INVALID，且过期 token 被删除", async () => {
    const deps = await setup();
    // 模拟时间流逝：把 token 的过期时间改成过去（绕过 request 流程，精确控制）
    const expiredToken = "expired-token";
    await deps.resetTokens.save({ token: expiredToken, userId: deps.userId, expiresAt: new Date(FIXED_NOW().getTime() - 1000) });

    await expect(resetPassword({ token: expiredToken, newPassword: "newpass456" }, deps))
      .rejects.toMatchObject({ code: ErrorCodes.RESET_TOKEN_INVALID });

    expect(await deps.resetTokens.findValid(expiredToken)).toBeNull(); // 已清理
  });

  it("会话确实被全部清除：重置后原会话 token 查不到", async () => {
    const deps = await setup();
    // 预置两个会话（模拟两台设备）
    const sessions = deps.sessions as MemorySessionStore;
    await sessions.create({ token: "dev1", userId: deps.userId, expiresAt: new Date(FIXED_NOW().getTime() + 3600_000) });
    await sessions.create({ token: "dev2", userId: deps.userId, expiresAt: new Date(FIXED_NOW().getTime() + 3600_000) });

    await resetPassword({ token: deps.token, newPassword: "newpass456" }, deps);

    expect(await sessions.findByToken("dev1")).toBeNull();
    expect(await sessions.findByToken("dev2")).toBeNull();
  });
});
