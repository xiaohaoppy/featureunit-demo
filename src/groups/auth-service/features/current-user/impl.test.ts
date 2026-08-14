/**
 * ============================================================================
 * [角色] 功能单元：current-user —— 判据（冻结区）
 * ----------------------------------------------------------------------------
 * AI 的"完成标准"，AI 不得修改本文件。
 * ============================================================================
 */

import { describe, expect, it } from "vitest";
import { currentUser } from "./impl";
import { registerUser } from "../register-user/impl";
import { login } from "../login/impl";
import { ErrorCodes } from "../../ports/errors";
import { silentLogger } from "../../ports/logger";
import { MemoryUserStore } from "../../adapters/memory/memory-user-store";
import { MemorySessionStore } from "../../adapters/memory/memory-session-store";
import { ScryptPasswordHasher } from "../../adapters/scrypt-password-hasher";

const FIXED_NOW = () => new Date("2025-01-01T00:00:00.000Z");

/** 预置：注册 + 登录，返回环境与真实 token。 */
async function setup() {
  const users = new MemoryUserStore();
  const sessions = new MemorySessionStore();
  const hasher = new ScryptPasswordHasher();
  await registerUser({ email: "a@b.com", password: "secret123" }, { users, hasher, logger: silentLogger });
  const { token, user } = await login(
    { email: "a@b.com", password: "secret123" },
    { users, sessions, hasher, logger: silentLogger, now: FIXED_NOW, sessionTtlMs: 3_600_000 },
  );
  return { users, sessions, token, userId: user.id };
}

describe("current-user 单元判据", () => {
  it("有效 token → 返回用户信息，且不含 passwordHash", async () => {
    const { users, sessions, token, userId } = await setup();
    const result = await currentUser({ token }, { sessions, users, now: FIXED_NOW });
    expect(result).toEqual({ id: userId, email: "a@b.com" });
    expect(result).not.toHaveProperty("passwordHash");
  });

  it("无效 token → INVALID_SESSION", async () => {
    const { users, sessions } = await setup();
    await expect(currentUser({ token: "bogus" }, { sessions, users, now: FIXED_NOW }))
      .rejects.toMatchObject({ code: ErrorCodes.INVALID_SESSION });
  });

  it("过期 token → INVALID_SESSION，且过期会话被顺手删除", async () => {
    const { users, sessions } = await setup();
    // 直接注入一条已过期 1 小时的会话（绕过 login，精确控制过期时间）
    const expiredToken = "expired-token";
    await sessions.create({
      token: expiredToken,
      userId: "u1",
      expiresAt: new Date(FIXED_NOW().getTime() - 3_600_000), // 1 小时前过期
    });

    await expect(currentUser({ token: expiredToken }, { sessions, users, now: FIXED_NOW }))
      .rejects.toMatchObject({ code: ErrorCodes.INVALID_SESSION });

    // 不变量 2：过期记录已被清理
    expect(await sessions.findByToken(expiredToken)).toBeNull();
  });

  it("用户已删除 → INVALID_SESSION", async () => {
    const { sessions, token } = await setup();
    // 模拟"用户被删"：用一个会话存在但用户查不到的 user store
    const emptyUsers = new MemoryUserStore();
    await expect(currentUser({ token }, { sessions, users: emptyUsers, now: FIXED_NOW }))
      .rejects.toMatchObject({ code: ErrorCodes.INVALID_SESSION });
  });
});
