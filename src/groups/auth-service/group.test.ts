/**
 * ============================================================================
 * [角色] 组判据：auth-service —— 组合判据（空框架占位）
 * ----------------------------------------------------------------------------
 * 登录业务已移除。当前只有框架健康检查可测；
 * 第一个功能接线后，请在这里补充真实的端到端用例。
 * ============================================================================
 */

import { describe, expect, it } from "vitest";
import { createApp, buildDeps } from "./index";
import { loadConfig } from "./config";

describe("auth-service 组判据（空框架）", () => {
  it("健康检查：组合根与配置可用", () => {
    const app = createApp(buildDeps(loadConfig()));
    expect(app.health()).toEqual({ ok: true });
  });
});
