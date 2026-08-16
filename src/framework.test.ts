/**
 * ============================================================================
 * [角色] 判据：framework —— 框架核心逻辑自检
 * ----------------------------------------------------------------------------
 * 登录业务已移除，这是框架自身的判据：保护核心库（ai-contract-lib）不被改坏。
 * 覆盖：需求解析 / mock 契约（按组引用端口）/ 端口纪律初审 / 判据占位检测。
 * ============================================================================
 */

import { describe, expect, it } from "vitest";
import {
  analyzeRequirement,
  mockDraft,
  machineCheckPort,
  isJudgePlaceholder,
} from "../scripts/ai-contract-lib.mjs";

describe("需求解析（analyzeRequirement）", () => {
  it("新业务域 → 新组 + 端口 + 单元", () => {
    const p = analyzeRequirement("支持用户收藏商品", "auth-service");
    expect(p.newGroup).toBe("favorite-service");
    expect(p.unitName).toBe("toggle-favorite");
    expect(p.portName).toBe("favorite-item");
  });

  it("已有域 → 复用 auth-service", () => {
    const p = analyzeRequirement("用户登录", "auth-service");
    expect(p.newGroup).toBeNull();
    expect(p.group).toBe("auth-service");
  });
});

describe("mock 契约（按组引用端口）", () => {
  it("空框架组只有通用端口 → 契约只引用 logger", () => {
    const { ts } = mockDraft("demo-unit", "测试", "auth-service");
    const refs = [...ts.matchAll(/ports\/([a-z-]+)/g)].map((m) => m[1]);
    expect(refs).toEqual(["logger"]);
  });
});

describe("端口纪律初审（machineCheckPort）", () => {
  it("合格端口通过 7 项检查", () => {
    const good = `/**
 * [角色] 端口：X —— 测试
 * 一句话：测试端口。
 */
export interface X {
  /** 按 id 查找；不存在返回 null。幂等。 */
  findById(id: string): Promise<Xxx | null>;
}
export interface Xxx { id: string }
`;
    const r = machineCheckPort(good);
    expect(r.checks.every((c) => c.ok)).toBe(true);
  });

  it("泄漏实现的草稿被抓住（import + 缺 JSDoc）", () => {
    const bad = `/**
 * [角色] 端口：X —— 测试
 * 一句话：测试端口。
 */
import { Redis } from "redis";
export interface X {
  findById(id: string): Promise<Xxx | null>;
}
`;
    const r = machineCheckPort(bad);
    expect(r.ok).toBe(false);
  });
});

describe("判据占位检测（isJudgePlaceholder）", () => {
  it("TODO 骨架与 expect(true) 都是占位", () => {
    expect(isJudgePlaceholder('it("x", () => { throw new Error("TODO: 断言") })')).toBe(true);
    expect(isJudgePlaceholder('it("x", () => { expect(true).toBe(true) })')).toBe(true);
  });
  it("真实断言不是占位", () => {
    expect(isJudgePlaceholder('it("x", () => { expect(1).toBe(1) })')).toBe(false);
  });
});

describe("存储分离（日志 / 错误 / 数据 独立落盘）", () => {
  it("业务日志写入 LOG_DIR/app.log（JSON lines），与错误目录分开", async () => {
    const { createFileLogger } = await import("./groups/auth-service/adapters/file-logger");
    const { mkdtempSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const base = mkdtempSync(join(tmpdir(), "fu-log-"));
    const logger = createFileLogger(join(base, "logs"));
    logger.info("unit.ok", { id: 1 });
    logger.warn("unit.slow", { ms: 12 });
    const lines = readFileSync(join(base, "logs", "app.log"), "utf8").trim().split("\n");
    expect(lines.length).toBe(2);
    const first = JSON.parse(lines[0]!);
    expect(first.level).toBe("info");
    expect(first.msg).toBe("unit.ok");
    expect(first.ts).toBeTruthy();
    expect(readFileSync(join(base, "logs", "app.log"), "utf8")).not.toContain("errors.log");
  });

  it("错误记录写入 ERROR_LOG_DIR/errors.log（错误码/消息/堆栈），与业务日志分开", async () => {
    const { recordError } = await import("./groups/auth-service/adapters/file-logger");
    const { AppError } = await import("./groups/auth-service/ports/errors");
    const { mkdtempSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const base = mkdtempSync(join(tmpdir(), "fu-err-"));
    const errDir = join(base, "errors");
    const logDir = join(base, "logs");
    const err = new AppError("INVALID_INPUT", 400);
    recordError(errDir, err, { route: "/api/x" });
    recordError(errDir, new Error("boom"));
    const lines = readFileSync(join(errDir, "errors.log"), "utf8").trim().split("\n");
    expect(lines.length).toBe(2);
    const first = JSON.parse(lines[0]!);
    expect(first.code).toBe("INVALID_INPUT");
    expect(first.route).toBe("/api/x");
    expect(first.type).toBe("AppError");
    // 错误目录与日志目录互不污染
    expect(readFileSync(join(errDir, "errors.log"), "utf8")).not.toContain('"level"');
  });
});
