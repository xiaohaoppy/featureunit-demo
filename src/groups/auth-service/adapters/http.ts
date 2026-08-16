/**
 * ============================================================================
 * [角色] 适配器：http —— 薄 HTTP 层（全组唯一接触 Web 框架的地方）
 * ----------------------------------------------------------------------------
 * 空框架壳：只有健康检查路由。业务路由由 Agent-E 打包时插入
 * （锚点：`return app;` 之前），错误处理协议已就位。
 * ============================================================================
 */

import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError } from "../ports/errors";
import type { GroupApi } from "../index";

/**
 * 把 GroupApi 包成 Hono 应用。
 * 打包（Agent-E / 一键接线）在 `return app;` 前插入业务路由。
 */
export function createHttpApp(api: GroupApi): Hono {
  const app = new Hono();

  // 全局错误兜底：AppError → 状态码；未知错误 → 500（不泄漏堆栈）
  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: err.code }, err.status as ContentfulStatusCode);
    }
    console.error("[http] unhandled error:", err);
    return c.json({ error: "INTERNAL" }, 500);
  });

  // 健康检查（框架保留路由）
  app.get("/api/health", (c) => c.json(api.health()));

  // ← 打包插入点：Agent-E 生成的路由会加在这里（`return app;` 之前）
  return app;
}
