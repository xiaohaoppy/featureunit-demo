/**
 * ============================================================================
 * [角色] 判据：SQLite 适配器集成测试（真库验证）
 * ----------------------------------------------------------------------------
 * 为什么需要它（内存判据之外的"第二层判据"）：
 *   - 单元判据用内存适配器（快、可复现）——验证"零件对"；
 *   - 本文件用真 SQLite——验证"适配器与内存行为一致 + 数据库语义"
 *     （唯一约束兜底、持久化、幂等），这是端口语义的参照物校验。
 *
 * 覆盖点：
 *   1. 三个 store 的 CRUD 与内存适配器行为一致；
 *   2. email UNIQUE 约束：并发抢邮箱 → EMAIL_TAKEN（适配器层兜底）；
 *   3. 持久化：关闭连接重开，数据仍在（真库与内存的差别所在）。
 * ============================================================================
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "./db";
import { SqliteUserStore } from "./sqlite-user-store";
import { SqliteSessionStore } from "./sqlite-session-store";
import { SqliteResetTokenStore } from "./sqlite-reset-token-store";
import { ErrorCodes, AppError } from "../../ports/errors";

describe("SqliteUserStore 集成判据", () => {
  it("CRUD 与内存适配器行为一致：create → findByEmail/findById → 更新", async () => {
    const db = openDb(":memory:");
    const store = new SqliteUserStore(db);

    await store.create({ id: "u1", email: "a@b.com", passwordHash: "hash1" });
    expect((await store.findByEmail("a@b.com"))?.passwordHash).toBe("hash1");
    expect((await store.findById("u1"))?.email).toBe("a@b.com");
    expect(await store.findByEmail("nobody@b.com")).toBeNull();

    await store.updatePasswordHash("u1", "hash2");
    expect((await store.findById("u1"))?.passwordHash).toBe("hash2");
    // 幂等：不存在的 id 静默忽略
    await expect(store.updatePasswordHash("nope", "hash3")).resolves.toBeUndefined();

    await store.updateEmail("u1", "new@b.com");
    expect((await store.findByEmail("new@b.com"))?.id).toBe("u1");
    expect(await store.findByEmail("a@b.com")).toBeNull(); // 旧 email 键已迁移
    db.close();
  });

  it("唯一约束兜底：并发抢同一邮箱 → 第二个 create 抛 EMAIL_TAKEN", async () => {
    const db = openDb(":memory:");
    const store = new SqliteUserStore(db);
    await store.create({ id: "u1", email: "a@b.com", passwordHash: "h" });

    // 模拟"单元先查后建"的并发窗口：绕过查重直接插入
    await expect(
      store.create({ id: "u2", email: "a@b.com", passwordHash: "h" }),
    ).rejects.toMatchObject({ code: ErrorCodes.EMAIL_TAKEN, status: 409 });

    // updateEmail 撞他人唯一约束同样转 EMAIL_TAKEN
    await store.create({ id: "u3", email: "b@b.com", passwordHash: "h" });
    await expect(store.updateEmail("u1", "b@b.com"))
      .rejects.toMatchObject({ code: ErrorCodes.EMAIL_TAKEN });
    db.close();
  });
});

describe("SqliteSessionStore / SqliteResetTokenStore 集成判据", () => {
  it("会话 CRUD 与内存版一致：创建/查找/单删/全删 + 幂等", async () => {
    const db = openDb(":memory:");
    const store = new SqliteSessionStore(db);
    const t = new Date("2025-01-01T00:00:00Z").getTime();

    // 先建用户（真库有外键约束：sessions.user_id 必须引用存在的 users.id——
    // 这是内存适配器没有的"数据库语义"，测试场景必须符合真实数据流）
    const users = new SqliteUserStore(db);
    await users.create({ id: "u1", email: "a@b.com", passwordHash: "h" });
    await users.create({ id: "u2", email: "b@b.com", passwordHash: "h" });

    await store.create({ token: "t1", userId: "u1", expiresAt: new Date(t) });
    expect((await store.findByToken("t1"))?.expiresAt.getTime()).toBe(t);
    expect(await store.findByToken("missing")).toBeNull();

    await store.delete("t1");
    expect(await store.findByToken("t1")).toBeNull();
    await expect(store.delete("t1")).resolves.toBeUndefined(); // 幂等

    await store.create({ token: "t2", userId: "u1", expiresAt: new Date(t) });
    await store.create({ token: "t3", userId: "u1", expiresAt: new Date(t) });
    await store.create({ token: "t4", userId: "u2", expiresAt: new Date(t) });
    await store.deleteAllForUser("u1");
    expect(await store.findByToken("t2")).toBeNull();
    expect(await store.findByToken("t3")).toBeNull();
    expect((await store.findByToken("t4"))?.userId).toBe("u2"); // 他人会话不受影响
    db.close();
  });

  it("重置 token CRUD：保存/查找/删除/按用户作废 + size", async () => {
    const db = openDb(":memory:");
    const store = new SqliteResetTokenStore(db);
    const t = new Date("2025-01-01T00:00:00Z").getTime();

    // 外键约束：token 必须引用存在的用户
    await new SqliteUserStore(db).create({ id: "u1", email: "a@b.com", passwordHash: "h" });

    await store.save({ token: "r1", userId: "u1", expiresAt: new Date(t) });
    await store.save({ token: "r2", userId: "u1", expiresAt: new Date(t) });
    expect(store.size).toBe(2);

    await store.invalidateForUser("u1");
    expect(store.size).toBe(0);

    await store.save({ token: "r3", userId: "u1", expiresAt: new Date(t) });
    await store.delete("r3");
    expect(await store.findValid("r3")).toBeNull();
    db.close();
  });
});

describe("SQLite 持久化（真库与内存的差别）", () => {
  it("关闭连接重开：数据仍在（写入落盘）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "feat-sqlite-"));
    const file = join(dir, "test.db");

    // 第一次打开：写入
    let db = openDb(file);
    await new SqliteUserStore(db).create({ id: "u1", email: "persist@b.com", passwordHash: "h" });
    await new SqliteSessionStore(db).create({ token: "t1", userId: "u1", expiresAt: new Date(Date.now() + 3600_000) });
    db.close();

    // 重新打开：数据仍在（模拟服务重启）
    db = openDb(file);
    expect((await new SqliteUserStore(db).findByEmail("persist@b.com"))?.id).toBe("u1");
    expect((await new SqliteSessionStore(db).findByToken("t1"))?.userId).toBe("u1");
    db.close();

    rmSync(dir, { recursive: true, force: true });
  });
});

// 类型自检：AppError 引用避免未使用告警
void AppError;
