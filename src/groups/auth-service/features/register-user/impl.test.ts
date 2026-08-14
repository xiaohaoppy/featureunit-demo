/**
 * ============================================================================
 * [角色] 功能单元：register-user —— 判据（冻结区）
 * ----------------------------------------------------------------------------
 * 这些测试是 AI 的"完成标准"：AI 不得修改本文件（改了判据 = 作弊，
 * 框架用 git 钩子/CI 校验文件 hash 来机器化这条纪律）。
 * 测试全部使用内存适配器，不依赖任何基础设施——判据可复现、毫秒级。
 * ============================================================================
 */

import { describe, expect, it } from "vitest";
import { RegisterUserInput } from "./contract"; // 契约 schema（单一事实来源）
import { registerUser } from "./impl";
import { ErrorCodes } from "../../ports/errors";
import { silentLogger } from "../../ports/logger";
import { MemoryUserStore } from "../../adapters/memory/memory-user-store";
import { ScryptPasswordHasher } from "../../adapters/scrypt-password-hasher";

/** 组装本单元的判据环境（真实 scrypt 哈希 + 内存存储 + 哑日志）。 */
function setup() {
  return {
    users: new MemoryUserStore(),
    hasher: new ScryptPasswordHasher(),
    logger: silentLogger,
  };
}

describe("register-user 单元判据", () => {
  it("成功注册：返回 id+email，且库中存的是哈希而非明文", async () => {
    const deps = setup();
    const result = await registerUser({ email: "a@b.com", password: "secret123" }, deps);

    // 返回结果正确
    expect(result.email).toBe("a@b.com");
    expect(result.id).toBeTruthy();

    // 不变量 2：明文绝不落库；但哈希可被 verify 验证
    const stored = await deps.users.findByEmail("a@b.com");
    expect(stored).not.toBeNull();
    expect(stored!.passwordHash).not.toBe("secret123");
    expect(await deps.hasher.verify("secret123", stored!.passwordHash)).toBe(true);

    // 不变量 3：返回结果不含 passwordHash
    expect(result).not.toHaveProperty("passwordHash");
  });

  it("重复注册 → EMAIL_TAKEN，且不覆盖原用户", async () => {
    const deps = setup();
    await registerUser({ email: "a@b.com", password: "secret123" }, deps);

    await expect(
      registerUser({ email: "a@b.com", password: "another456" }, deps),
    ).rejects.toMatchObject({ code: ErrorCodes.EMAIL_TAKEN });

    // 原用户未被覆盖：旧密码仍有效，新密码无效
    const stored = await deps.users.findByEmail("a@b.com");
    expect(await deps.hasher.verify("secret123", stored!.passwordHash)).toBe(true);
    expect(await deps.hasher.verify("another456", stored!.passwordHash)).toBe(false);
  });

  it("契约边界：密码少于 8 位在 schema 层就被拒绝（组合根兜底）", () => {
    const parsed = RegisterUserInput.safeParse({ email: "a@b.com", password: "short" });
    expect(parsed.success).toBe(false);
  });
});
