/**
 * ============================================================================
 * [角色] 功能单元：change-password —— 判据（冻结区）
 * ----------------------------------------------------------------------------
 * AI 的"完成标准"，AI 不得修改本文件。
 * ============================================================================
 */

import { describe, expect, it } from "vitest";
import { changePassword } from "./impl";
import { registerUser } from "../register-user/impl";
import { login } from "../login/impl";
import { ErrorCodes } from "../../ports/errors";
import { silentLogger } from "../../ports/logger";
import { MemoryUserStore } from "../../adapters/memory/memory-user-store";
import { MemorySessionStore } from "../../adapters/memory/memory-session-store";
import { ScryptPasswordHasher } from "../../adapters/scrypt-password-hasher";

const FIXED_NOW = () => new Date("2025-01-01T00:00:00.000Z");
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** 预置：注册 + 登录（产生一个有效会话），并再开一个"第二个设备"的会话。 */
async function setup() {
  const users = new MemoryUserStore();
  const sessions = new MemorySessionStore();
  const hasher = new ScryptPasswordHasher();
  await registerUser({ email: "a@b.com", password: "secret123" }, { users, hasher, logger: silentLogger });

  const base = { users, sessions, hasher, logger: silentLogger, now: FIXED_NOW, sessionTtlMs: TTL_MS };
  const first = await login({ email: "a@b.com", password: "secret123" }, base);
  // 模拟第二台设备：直接把另一个会话写进 store
  await sessions.create({ token: "second-device", userId: first.user.id, expiresAt: new Date(FIXED_NOW().getTime() + TTL_MS) });

  return { ...base, token: first.token, userId: first.user.id };
}

describe("change-password 单元判据", () => {
  it("旧密码错误 → WRONG_PASSWORD，且哈希与会话都【不】变", async () => {
    const deps = await setup();

    await expect(
      changePassword({ token: deps.token, currentPassword: "wrong-old", newPassword: "newpass456" }, deps),
    ).rejects.toMatchObject({ code: ErrorCodes.WRONG_PASSWORD });

    // 不变量 2：数据零变更
    const user = await deps.users.findById(deps.userId);
    expect(await deps.hasher.verify("secret123", user!.passwordHash)).toBe(true); // 旧密码仍有效
    expect(await deps.sessions.findByToken(deps.token)).not.toBeNull(); // 会话还在
    expect(await deps.sessions.findByToken("second-device")).not.toBeNull();
  });

  it("成功改密：哈希更新 + 所有会话（含当前）全部失效", async () => {
    const deps = await setup();

    await changePassword({ token: deps.token, currentPassword: "secret123", newPassword: "newpass456" }, deps);

    // 不变量 3：所有会话失效
    expect(await deps.sessions.findByToken(deps.token)).toBeNull();
    expect(await deps.sessions.findByToken("second-device")).toBeNull();

    // 哈希已更新：旧密码失效、新密码有效
    const user = await deps.users.findById(deps.userId);
    expect(await deps.hasher.verify("secret123", user!.passwordHash)).toBe(false);
    expect(await deps.hasher.verify("newpass456", user!.passwordHash)).toBe(true);
  });

  it("无效 token → INVALID_SESSION，不修改任何数据", async () => {
    const deps = await setup();

    await expect(
      changePassword({ token: "bogus", currentPassword: "secret123", newPassword: "newpass456" }, deps),
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_SESSION });

    const user = await deps.users.findById(deps.userId);
    expect(await deps.hasher.verify("secret123", user!.passwordHash)).toBe(true);
  });

  it("过期 token → INVALID_SESSION，且过期会话被删除", async () => {
    const deps = await setup();
    const expiredToken = "expired";
    await deps.sessions.create({ token: expiredToken, userId: deps.userId, expiresAt: new Date(FIXED_NOW().getTime() - 1000) });

    await expect(
      changePassword({ token: expiredToken, currentPassword: "secret123", newPassword: "newpass456" }, deps),
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_SESSION });

    expect(await deps.sessions.findByToken(expiredToken)).toBeNull();
  });
});
