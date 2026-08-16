/**
 * [角色] 适配器：http —— 薄 HTTP 层（全组唯一接触 Web 框架的地方）
 * 空框架壳：业务路由由 Agent-E 接入时插入（锚点：`return app;` 之前）。
 * 助手（readJson / cookie / ErrorCodes）已就位——接入生成的路由直接可编译。
 */

import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError, ErrorCodes } from "../ports/errors";
import { recordError } from "./file-logger";
import { loadConfig } from "../config";
import type { GroupApi } from "../index";

/** 会话 cookie 名（接入生成的"从 cookie 取 token"路由使用）。 */
export const SESSION_COOKIE = "sid";

/** 读取并解析 JSON body；非法 JSON → INVALID_INPUT。 */
async function readJson(c: { req: { json(): Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new AppError(ErrorCodes.INVALID_INPUT, 400);
  }
}

export function createHttpApp(api: GroupApi): Hono {
  const app = new Hono();

  app.onError((err, c) => {
    recordError(loadConfig().ERROR_LOG_DIR, err, { route: c.req.path });
    if (err instanceof AppError) {
      return c.json({ error: err.code }, err.status as ContentfulStatusCode);
    }
    console.error("[http] unhandled error:", err);
    return c.json({ error: "INTERNAL" }, 500);
  });

  app.get("/api/health", (c) => c.json(api.health()));

  // ← 接入插入点：Agent-E 生成的路由会加在这里（`return app;` 之前）
  return app;
  // ── record-stock-movement ────────────────────────────────────────────────
  app.post("/api/record-stock-movement", async (c) => {
    const body = (await readJson(c)) as Record<string, unknown>;
    await api.recordStockMovement(body);
    return c.json({ ok: true });
  });
}
