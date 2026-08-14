/**
 * ============================================================================
 * [角色] 功能单元：request-password-reset —— 判据（冻结区）
 * ----------------------------------------------------------------------------
 * AI 的"完成标准"，AI 不得修改本文件。
 * ============================================================================
 */

import { describe, expect, it } from "vitest";
import { requestPasswordReset } from "./impl";
import { registerUser } from "../register-user/impl";
import { ErrorCodes } from "../../ports/errors";
import { silentLogger } from "../../ports/logger";
import { MemoryUserStore } from "../../adapters/memory/memory-user-store";
import { MemoryResetTokenStore } from "../../adapters/memory/memory-reset-token-store";
import { MemoryEmailSender } from "../../adapters/memory/memory-email-sender";
import { FixedWindowRateLimiter } from "../../adapters/memory/fixed-window-rate-limiter";
import { ScryptPasswordHasher } from "../../adapters/scrypt-password-hasher";

const FIXED_NOW = () => new Date("2025-01-01T00:00:00.000Z");
const TTL_MS = 30 * 60 * 1000; // 30 分钟

/** 预置：一个已注册用户 a@b.com。 */
async function setup() {
  const users = new MemoryUserStore();
  const hasher = new ScryptPasswordHasher();
  await registerUser({ email: "a@b.com", password: "secret123" }, { users, hasher, logger: silentLogger });
  return {
    users,
    mail: new MemoryEmailSender(),
    resetTokens: new MemoryResetTokenStore(),
    rate: new FixedWindowRateLimiter(3, 10 * 60 * 1000), // 3 次 / 10 分钟
    logger: silentLogger,
    now: FIXED_NOW,
    resetTokenTtlMs: TTL_MS,
  };
}

describe("request-password-reset 单元判据", () => {
  it("已存在邮箱 → 发邮件且邮件含 token；token 已存且过期时间精确 = now + TTL", async () => {
    const deps = await setup();
    await requestPasswordReset({ email: "a@b.com" }, deps);

    // 不变量 5：恰好发了一封，且正文携带 token
    expect(deps.mail.sent).toHaveLength(1);
    const token = /token=([^)\s]+)/.exec(deps.mail.sent[0]!.text)?.[1];
    expect(token).toBeTruthy();

    // 不变量 4：过期时间精确
    const record = await deps.resetTokens.findValid(token!);
    expect(record?.userId).toBeTruthy();
    expect(record!.expiresAt.getTime()).toBe(FIXED_NOW().getTime() + TTL_MS);
  });

  it("邮箱不存在 → 返回成功、不发邮件、不写 token（防枚举）", async () => {
    const deps = await setup();
    await expect(requestPasswordReset({ email: "nobody@b.com" }, deps)).resolves.toBeUndefined();
    expect(deps.mail.sent).toHaveLength(0);
    expect(deps.resetTokens.size).toBe(0); // 不变量 1：不写任何 token
  });

  it("重复请求 → 旧 token 作废，只保留最新", async () => {
    const deps = await setup();
    await requestPasswordReset({ email: "a@b.com" }, deps);
    const firstToken = /token=([^)\s]+)/.exec(deps.mail.sent[0]!.text)?.[1]!;

    await requestPasswordReset({ email: "a@b.com" }, deps);
    const secondToken = /token=([^)\s]+)/.exec(deps.mail.sent[1]!.text)?.[1]!;

    expect(secondToken).not.toBe(firstToken);
    expect(await deps.resetTokens.findValid(firstToken)).toBeNull(); // 旧 token 已作废
    expect(await deps.resetTokens.findValid(secondToken)).not.toBeNull();
  });

  it("超过限流 → RATE_LIMITED，且不发邮件", async () => {
    const deps = await setup();
    await requestPasswordReset({ email: "a@b.com" }, deps);
    await requestPasswordReset({ email: "a@b.com" }, deps);
    await requestPasswordReset({ email: "a@b.com" }, deps);

    await expect(requestPasswordReset({ email: "a@b.com" }, deps))
      .rejects.toMatchObject({ code: ErrorCodes.RATE_LIMITED });

    expect(deps.mail.sent).toHaveLength(3); // 第 4 次没有发邮件
  });
});
