/**
 * ============================================================================
 * [角色] 功能单元：logout —— 判据（冻结区）
 * ----------------------------------------------------------------------------
 * AI 的"完成标准"，AI 不得修改本文件。
 * ============================================================================
 */

import { describe, expect, it } from "vitest";
import { logout } from "./impl";
import { login } from "../login/impl";
import { registerUser } from "../register-user/impl";
import { silentLogger } from "../../ports/logger";
import { MemoryUserStore } from "../../adapters/memory/memory-user-store";
import { MemorySessionStore } from "../../adapters/memory/memory-session-store";
import { ScryptPasswordHasher } from "../../adapters/scrypt-password-hasher";

/** 预置：注册 + 登录，拿到一个真实会话。 */
async function setup() {
  const users = new MemoryUserStore();
  const sessions = new MemorySessionStore();
  const hasher = new ScryptPasswordHasher();
  await registerUser({ email: "a@b.com", password: "secret123" }, { users, hasher, logger: silentLogger });
  const { token } = await login(
    { email: "a@b.com", password: "secret123" },
    { users, sessions, hasher, logger: silentLogger, now: () => new Date(), sessionTtlMs: 3_600_000 },
  );
  return { sessions, token };
}

describe("logout 单元判据", () => {
  it("登出后：会话被删除，token 查不到", async () => {
    const { sessions, token } = await setup();
    await logout({ token }, { sessions, logger: silentLogger });
    expect(await sessions.findByToken(token)).toBeNull();
  });

  it("幂等：对不存在的 token 登出也成功（不抛错）", async () => {
    const { sessions } = await setup();
    await expect(logout({ token: "no-such-token" }, { sessions, logger: silentLogger })).resolves.toBeUndefined();
  });

  it("登出不影响其他用户的会话", async () => {
    const { sessions, token } = await setup();
    // 再造一个"其他用户"的会话，直接写入 store
    await sessions.create({ token: "other-token", userId: "other-user", expiresAt: new Date(Date.now() + 3600_000) });
    await logout({ token }, { sessions, logger: silentLogger });
    expect(await sessions.findByToken("other-token")).not.toBeNull();
  });
});
