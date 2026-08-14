/**
 * ============================================================================
 * [角色] 适配器：http —— 薄 HTTP 层（全组唯一接触 Web 框架的地方）
 * ----------------------------------------------------------------------------
 * 职责（只有三件事，不做任何业务）：
 *   1. 翻译：HTTP 请求 ↔ AuthApi 调用（JSON 解析、cookie 读写）；
 *   2. 映射：AppError 错误码 → HTTP 状态码 + 响应体（用户消息只存在于这里）；
 *   3. 兜底：未知异常 → 500 + 服务端日志（绝不把堆栈泄漏给客户端）。
 *
 * 安全细节（都在这层落地，业务单元完全无感）：
 *   - 会话 cookie：httpOnly（JS 读不到，防 XSS 窃取）+ SameSite=Lax（防 CSRF）
 *   - 生产必须加 secure: true（HTTPS 下才发送）
 * ============================================================================
 */

import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError, ErrorCodes, type ErrorCode } from "../ports/errors";
import type { AuthApi } from "../index";

/** 错误码 → HTTP 状态码 映射表（唯一允许出现"用户可见状态"的地方）。 */
const STATUS_BY_CODE: Record<ErrorCode, number> = {
  [ErrorCodes.INVALID_INPUT]: 400,
  [ErrorCodes.INVALID_CREDENTIALS]: 401,
  [ErrorCodes.INVALID_SESSION]: 401,
  [ErrorCodes.WRONG_PASSWORD]: 401,
  [ErrorCodes.RESET_TOKEN_INVALID]: 400,
  [ErrorCodes.EMAIL_TAKEN]: 409,
  [ErrorCodes.RATE_LIMITED]: 429,
};

/** 用户可见消息（展示层归属地；业务单元永不产生这些文案）。 */
const MESSAGE_BY_CODE: Record<ErrorCode, string> = {
  [ErrorCodes.INVALID_INPUT]: "输入不合法",
  [ErrorCodes.INVALID_CREDENTIALS]: "邮箱或密码错误",
  [ErrorCodes.INVALID_SESSION]: "登录状态已失效，请重新登录",
  [ErrorCodes.WRONG_PASSWORD]: "旧密码不正确",
  [ErrorCodes.RESET_TOKEN_INVALID]: "重置链接无效或已过期",
  [ErrorCodes.EMAIL_TAKEN]: "该邮箱已被注册",
  [ErrorCodes.RATE_LIMITED]: "操作过于频繁，请稍后再试",
};

/** 读取并解析 JSON body；非法 JSON → INVALID_INPUT（而不是 500）。 */
async function readJson(c: { req: { json(): Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new AppError(ErrorCodes.INVALID_INPUT, 400);
  }
}

/** 会话 cookie 名。 */
export const SESSION_COOKIE = "sid";

/**
 * 把 AuthApi 包成 Hono 应用。这是"唯一知道路由形状"的文件——
 * 新增端点 = 在这里加一行 + 组合根加一行，功能单元零改动。
 */
export function createHttpApp(api: AuthApi): Hono {
  const app = new Hono();

  // 全局错误兜底：AppError → 映射表；未知错误 → 500 + 服务端日志
  app.onError((err, c) => {
    if (err instanceof AppError) {
      const status = (STATUS_BY_CODE[err.code] ?? 500) as ContentfulStatusCode;
      return c.json(
        { error: err.code, message: MESSAGE_BY_CODE[err.code] ?? "请求失败" },
        status,
      );
    }
    // 未知异常：记录完整错误（服务端），客户端只看到笼统的 INTERNAL
    console.error("[http] unhandled error:", err);
    return c.json({ error: "INTERNAL", message: "服务器开小差了" }, 500);
  });

  // ── 注册 ────────────────────────────────────────────────────────────────
  app.post("/api/register", async (c) => {
    const result = await api.register(await readJson(c));
    return c.json({ user: result }, 201);
  });

  // ── 登录：写 httpOnly 会话 cookie ────────────────────────────────────────
  app.post("/api/login", async (c) => {
    const { token, user } = await api.login(await readJson(c));
    // httpOnly：JS 读不到；SameSite=Lax：跨站请求不带 cookie（防 CSRF）。
    // 生产（HTTPS）必须加 secure: true。
    setCookie(c, SESSION_COOKIE, token, { httpOnly: true, sameSite: "Lax", path: "/" });
    return c.json({ user });
  });

  // ── 登出：删 cookie + 销毁会话（幂等，永远 200）──────────────────────────
  app.post("/api/logout", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await api.logout({ token });
    deleteCookie(c, SESSION_COOKIE);
    return c.json({ ok: true });
  });

  // ── 当前用户（所有"需要登录"的页面都调它）────────────────────────────────
  app.get("/api/me", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (!token) throw new AppError(ErrorCodes.INVALID_SESSION, 401);
    return c.json({ user: await api.me({ token }) });
  });

  // ── 修改密码 ────────────────────────────────────────────────────────────
  app.post("/api/change-password", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (!token) throw new AppError(ErrorCodes.INVALID_SESSION, 401);
    const body = (await readJson(c)) as Record<string, unknown>;
    await api.changePassword({ token, ...body });
    deleteCookie(c, SESSION_COOKIE); // 改密后全端下线，当前 cookie 也删掉
    return c.json({ ok: true });
  });

  // ── 修改邮箱（敏感操作：body 必须带旧密码，见 change-email 契约）──────────
  app.post("/api/change-email", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (!token) throw new AppError(ErrorCodes.INVALID_SESSION, 401);
    const body = (await readJson(c)) as Record<string, unknown>;
    await api.changeEmail({ token, ...body });
    deleteCookie(c, SESSION_COOKIE); // 邮箱已变，当前 cookie 一并失效
    return c.json({ ok: true });
  });

  // ── 找回密码：请求重置链接（防枚举：无论邮箱是否存在都返回 200）───────────
  app.post("/api/password-reset/request", async (c) => {
    await api.requestPasswordReset(await readJson(c));
    return c.json({ ok: true });
  });

  // ── 找回密码：用 token 重置 ──────────────────────────────────────────────
  app.post("/api/password-reset", async (c) => {
    await api.resetPassword(await readJson(c));
    deleteCookie(c, SESSION_COOKIE); // 密码已重置，旧会话 cookie 一并清掉
    return c.json({ ok: true });
  });

  return app;
}
