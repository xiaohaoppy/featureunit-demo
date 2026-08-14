/**
 * ============================================================================
 * [角色] 功能单元：change-email —— 判据（冻结区）
 * ----------------------------------------------------------------------------
 * AI 的"完成标准"：AI 不得修改本文件（改了判据 = 作弊）。
 * 契约 5 条不变量 → 以下 7 条用例逐条翻译。全部内存适配器，毫秒级可复现。
 * ============================================================================
 */

import { describe, expect, it } from "vitest";
import { changeEmail } from "./impl";
import { registerUser } from "../register-user/impl";
import { login } from "../login/impl";
import { ErrorCodes, type ErrorCode } from "../../ports/errors";
import type { Logger } from "../../ports/logger";
import { MemoryUserStore } from "../../adapters/memory/memory-user-store";
import { MemorySessionStore } from "../../adapters/memory/memory-session-store";
import { ScryptPasswordHasher } from "../../adapters/scrypt-password-hasher";

const FIXED_NOW = () => new Date("2025-01-01T00:00:00.000Z");
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** 记录日志调用的测试 Logger：用于断言"邮箱不进日志"（不变量 5）。 */
class RecordingLogger implements Logger {
  calls: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
  info(msg: string, meta?: Record<string, unknown>): void { this.calls.push({ msg, meta }); }
  warn(msg: string, meta?: Record<string, unknown>): void { this.calls.push({ msg, meta }); }
  error(msg: string, meta?: Record<string, unknown>): void { this.calls.push({ msg, meta }); }
}

/** 预置：注册 a@b.com 并登录，产生有效会话；另注册一个"占用者" b@b.com。 */
async function setup() {
  const users = new MemoryUserStore();
  const sessions = new MemorySessionStore();
  const hasher = new ScryptPasswordHasher();
  const logger = new RecordingLogger();

  await registerUser({ email: "a@b.com", password: "secret123" }, { users, hasher, logger });
  const { token, user } = await login(
    { email: "a@b.com", password: "secret123" },
    { users, sessions, hasher, logger, now: FIXED_NOW, sessionTtlMs: TTL_MS },
  );
  // 模拟第二台设备
  await sessions.create({ token: "second-device", userId: user.id, expiresAt: new Date(FIXED_NOW().getTime() + TTL_MS) });
  // 占用者
  await registerUser({ email: "b@b.com", password: "otherpass9" }, { users, hasher, logger });

  return { users, sessions, hasher, logger, now: FIXED_NOW, token, userId: user.id };
}

describe("change-email 单元判据", () => {
  it("不变量4｜成功改邮箱：邮箱已更新 + 所有会话（含当前）全部失效", async () => {
    const deps = await setup();
    await changeEmail({ token: deps.token, currentPassword: "secret123", newEmail: "new@b.com" }, deps);

    const user = await deps.users.findById(deps.userId);
    expect(user?.email).toBe("new@b.com"); // 邮箱确实变了
    expect(await deps.sessions.findByToken(deps.token)).toBeNull(); // 当前会话失效
    expect(await deps.sessions.findByToken("second-device")).toBeNull(); // 其他设备也失效
  });

  it("不变量2｜旧密码错误 → WRONG_PASSWORD，数据零变更", async () => {
    const deps = await setup();
    await expect(
      changeEmail({ token: deps.token, currentPassword: "wrong-pass", newEmail: "new@b.com" }, deps),
    ).rejects.toMatchObject({ code: ErrorCodes.WRONG_PASSWORD });

    // 邮箱、密码哈希、会话全都没动
    const user = await deps.users.findById(deps.userId);
    expect(user?.email).toBe("a@b.com");
    expect(await deps.hasher.verify("secret123", user!.passwordHash)).toBe(true);
    expect(await deps.sessions.findByToken(deps.token)).not.toBeNull();
  });

  it("不变量3｜新邮箱被他人占用 → EMAIL_TAKEN，数据零变更", async () => {
    const deps = await setup();
    await expect(
      changeEmail({ token: deps.token, currentPassword: "secret123", newEmail: "b@b.com" }, deps),
    ).rejects.toMatchObject({ code: ErrorCodes.EMAIL_TAKEN });

    const user = await deps.users.findById(deps.userId);
    expect(user?.email).toBe("a@b.com"); // 自己没被改
    expect(await deps.sessions.findByToken(deps.token)).not.toBeNull(); // 会话也没被清
  });

  it("不变量3｜新邮箱 = 自己的旧邮箱 → 幂等成功", async () => {
    const deps = await setup();
    await expect(
      changeEmail({ token: deps.token, currentPassword: "secret123", newEmail: "a@b.com" }, deps),
    ).resolves.toBeUndefined();

    const user = await deps.users.findById(deps.userId);
    expect(user?.email).toBe("a@b.com");
    expect(await deps.sessions.findByToken(deps.token)).not.toBeNull(); // 会话保留
  });

  it("不变量1｜无效 token → INVALID_SESSION，数据零变更", async () => {
    const deps = await setup();
    await expect(
      changeEmail({ token: "bogus", currentPassword: "secret123", newEmail: "new@b.com" }, deps),
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_SESSION });
  });

  it("不变量1｜过期 token → INVALID_SESSION，且过期会话被删除", async () => {
    const deps = await setup();
    const expiredToken = "expired";
    await deps.sessions.create({ token: expiredToken, userId: deps.userId, expiresAt: new Date(FIXED_NOW().getTime() - 1000) });

    await expect(
      changeEmail({ token: expiredToken, currentPassword: "secret123", newEmail: "new@b.com" }, deps),
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_SESSION });

    expect(await deps.sessions.findByToken(expiredToken)).toBeNull(); // 顺手清理
  });

  it("不变量5｜日志不含邮箱（PII 纪律）", async () => {
    const deps = await setup();
    await changeEmail({ token: deps.token, currentPassword: "secret123", newEmail: "new@b.com" }, deps);

    const logged = JSON.stringify(deps.logger.calls);
    expect(logged).not.toContain("a@b.com");
    expect(logged).not.toContain("new@b.com");
    // 但业务事件确实被记录了
    expect(deps.logger.calls.some((c) => c.msg === "change-email.ok")).toBe(true);
  });
});
