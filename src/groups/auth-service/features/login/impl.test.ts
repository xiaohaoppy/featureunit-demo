/**
 * ============================================================================
 * [角色] 功能单元：login —— 判据（冻结区）
 * ----------------------------------------------------------------------------
 * AI 的"完成标准"，AI 不得修改本文件。全部内存适配器，毫秒级可复现。
 * ============================================================================
 */

import { describe, expect, it } from "vitest";
import { login } from "./impl";
import { registerUser } from "../register-user/impl"; // 复用：登录判据需要先有用户
import { ErrorCodes } from "../../ports/errors";
import { silentLogger } from "../../ports/logger";
import { MemoryUserStore } from "../../adapters/memory/memory-user-store";
import { MemorySessionStore } from "../../adapters/memory/memory-session-store";
import { ScryptPasswordHasher } from "../../adapters/scrypt-password-hasher";

/** 固定时钟：2025-01-01T00:00:00Z，让"过期时间 = now + TTL"可精确断言。 */
const FIXED_NOW = () => new Date("2025-01-01T00:00:00.000Z");
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

/** 组装判据环境，并预置一个已注册用户 a@b.com / secret123。 */
async function setup() {
  const users = new MemoryUserStore();
  const sessions = new MemorySessionStore();
  const hasher = new ScryptPasswordHasher();
  await registerUser(
    { email: "a@b.com", password: "secret123" },
    { users, hasher, logger: silentLogger },
  );
  return {
    users,
    sessions,
    hasher,
    logger: silentLogger,
    now: FIXED_NOW,
    sessionTtlMs: TTL_MS,
  };
}

describe("login 单元判据", () => {
  it("正确凭据 → 返回 token 和用户；会话已保存且过期时间精确 = now + TTL", async () => {
    const deps = await setup();
    const result = await login({ email: "a@b.com", password: "secret123" }, deps);

    expect(result.token).toBeTruthy();
    expect(result.user.email).toBe("a@b.com");
    expect(result.user).not.toHaveProperty("passwordHash"); // 不变量 2

    const session = await deps.sessions.findByToken(result.token);
    expect(session?.userId).toBe(result.user.id);
    expect(session!.expiresAt.getTime()).toBe(FIXED_NOW().getTime() + TTL_MS); // 不变量 3
  });

  it("密码错误 → INVALID_CREDENTIALS，且不创建任何会话", async () => {
    const deps = await setup();
    await expect(
      login({ email: "a@b.com", password: "wrong-pass" }, deps),
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_CREDENTIALS });

    // 直接查内存会话表：一条都没有
    expect(await deps.sessions.findByToken("any-token")).toBeNull();
  });

  it("用户不存在 → 与密码错误【完全相同】的错误码（防枚举）", async () => {
    const deps = await setup();
    await expect(
      login({ email: "nobody@b.com", password: "secret123" }, deps),
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_CREDENTIALS });
  });
});
