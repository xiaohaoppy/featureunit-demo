/**
 * ============================================================================
 * [角色] 组测试：group.test —— 组合判据（"装起来对不对"）
 * ----------------------------------------------------------------------------
 * 单元测试证明"每个零件对"，组测试证明"装起来对"。
 * 全部走 HTTP 层（createHttpApp）——这是用户真实接触的入口，
 * 因此覆盖 cookie 语义、错误码→状态码映射、跨单元协作。
 *
 * 全部使用内存适配器：可复现、毫秒级、无任何基础设施依赖。
 * ============================================================================
 */

import { describe, expect, it, beforeEach } from "vitest";
import type { Hono } from "hono";
import { loadConfig } from "./config";
import { buildDeps, createAuthApp, type AuthApi, type AuthDeps } from "./index";
import { createHttpApp, SESSION_COOKIE } from "./adapters/http";
import { MemoryEmailSender } from "./adapters/memory/memory-email-sender";

/** 测试配置：全内存、零外部依赖。 */
function testConfig() {
  return loadConfig({ USER_STORE: "memory", RATE_LIMIT_MAX: "3" });
}

/** 每个用例独立环境：组合根 + 内存依赖（mail 换成可断言的 MemoryEmailSender）。 */
let deps: AuthDeps;
let api: AuthApi;
let http: Hono;

beforeEach(() => {
  deps = buildDeps(testConfig(), { mail: new MemoryEmailSender() });
  api = createAuthApp(deps);
  http = createHttpApp(api);
});

/** 从登录响应里提取会话 cookie 值（Hono 测试直接读 set-cookie 头）。 */
function cookieFrom(res: Response): string {
  const setCookie = res.headers.get("set-cookie");
  const m = /sid=([^;]+)/.exec(setCookie ?? "");
  if (!m) throw new Error(`响应没有设置 ${SESSION_COOKIE} cookie: ${setCookie}`);
  return m[1]!;
}

const post = (path: string, body: unknown, cookie?: string) =>
  http.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}) },
    body: JSON.stringify(body),
  });

const get = (path: string, cookie?: string) =>
  http.request(path, { headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {} });

/** 从错误响应里取错误码（@types/node 的 Response.json() 返回 unknown，这里收窄）。 */
async function errorOf(res: Response): Promise<string> {
  return ((await res.json()) as { error?: string }).error ?? "";
}

describe("auth-service 组判据（端到端，HTTP 层）", () => {
  it("完整生命周期：注册 → 登录 → 查我 → 登出 → 再查我被拒", async () => {
    const reg = await post("/api/register", { email: "a@b.com", password: "secret123" });
    expect(reg.status).toBe(201);

    const loginRes = await post("/api/login", { email: "a@b.com", password: "secret123" });
    expect(loginRes.status).toBe(200);
    const cookie = cookieFrom(loginRes);

    const me = await get("/api/me", cookie);
    expect(me.status).toBe(200);
    expect(((await me.json()) as { user: { email: string } }).user.email).toBe("a@b.com");

    const out = await post("/api/logout", {}, cookie);
    expect(out.status).toBe(200);

    const meAfter = await get("/api/me", cookie);
    expect(meAfter.status).toBe(401); // 会话已销毁
  });

  it("重复注册 → 409 EMAIL_TAKEN；错误码与状态码映射正确", async () => {
    await post("/api/register", { email: "a@b.com", password: "secret123" });
    const res = await post("/api/register", { email: "a@b.com", password: "secret123" });
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toBe("EMAIL_TAKEN");
  });

  it("非法输入 → 400（边界校验在组合根，用户拿不到 500）", async () => {
    const res = await post("/api/register", { email: "不是邮箱", password: "短" });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe("INVALID_INPUT");
  });

  it("错误密码 → 401，且响应体不泄漏内部细节", async () => {
    await post("/api/register", { email: "a@b.com", password: "secret123" });
    const res = await post("/api/login", { email: "a@b.com", password: "wrong-pass" });
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("INVALID_CREDENTIALS");
    expect(JSON.stringify(body)).not.toContain("stack"); // 不泄漏堆栈
  });

  it("改密端到端：改密后旧 cookie 失效、旧密码登录被拒、新密码可登录", async () => {
    await post("/api/register", { email: "a@b.com", password: "secret123" });
    const loginRes = await post("/api/login", { email: "a@b.com", password: "secret123" });
    const cookie = cookieFrom(loginRes);

    const change = await post("/api/change-password", { currentPassword: "secret123", newPassword: "newpass456" }, cookie);
    expect(change.status).toBe(200);

    // 旧会话已失效（含当前 cookie）
    expect((await get("/api/me", cookie)).status).toBe(401);
    // 旧密码登录被拒
    expect((await post("/api/login", { email: "a@b.com", password: "secret123" })).status).toBe(401);
    // 新密码可登录
    expect((await post("/api/login", { email: "a@b.com", password: "newpass456" })).status).toBe(200);
  });

  it("找回密码端到端：请求 → 邮件取 token → 重置 → 新密码登录 → 旧 token 复用被拒", async () => {
    await post("/api/register", { email: "a@b.com", password: "secret123" });
    const before = deps.mail as MemoryEmailSender;

    const req = await post("/api/password-reset/request", { email: "a@b.com" });
    expect(req.status).toBe(200);
    expect(before.sent).toHaveLength(1);

    // 从"发出的邮件"里提取重置 token（真实系统里用户从邮箱点链接）
    const token = /token=([^)\s]+)/.exec(before.sent[0]!.text)?.[1]!;
    expect(token).toBeTruthy();

    const reset = await post("/api/password-reset", { token, newPassword: "resetpass9" });
    expect(reset.status).toBe(200);

    // 新密码可登录；旧密码不可
    expect((await post("/api/login", { email: "a@b.com", password: "resetpass9" })).status).toBe(200);
    expect((await post("/api/login", { email: "a@b.com", password: "secret123" })).status).toBe(401);

    // 不变量：token 一次性——复用同一 token 再重置 → 400
    const replay = await post("/api/password-reset", { token, newPassword: "another789" });
    expect(replay.status).toBe(400);
    expect(await errorOf(replay)).toBe("RESET_TOKEN_INVALID");
  });

  it("改邮箱端到端：改后旧 cookie 失效、旧邮箱登录被拒、新邮箱可登录；占用他人邮箱 → 409", async () => {
    // 两个用户：a@b.com 是改邮箱的主角，b@b.com 是"被占用"的受害者
    await post("/api/register", { email: "a@b.com", password: "secret123" });
    await post("/api/register", { email: "b@b.com", password: "otherpass9" });
    const loginRes = await post("/api/login", { email: "a@b.com", password: "secret123" });
    const cookie = cookieFrom(loginRes);

    // ① 新邮箱被 b 占用 → 409 EMAIL_TAKEN，cookie 仍有效（数据零变更）
    const taken = await post("/api/change-email", { currentPassword: "secret123", newEmail: "b@b.com" }, cookie);
    expect(taken.status).toBe(409);
    expect(await errorOf(taken)).toBe("EMAIL_TAKEN");
    expect((await get("/api/me", cookie)).status).toBe(200);

    // ② 旧密码错误 → 401 WRONG_PASSWORD
    const badPw = await post("/api/change-email", { currentPassword: "wrong", newEmail: "new@b.com" }, cookie);
    expect(badPw.status).toBe(401);

    // ③ 正确改邮箱 → 200；旧会话立即失效（含当前 cookie）
    const ok = await post("/api/change-email", { currentPassword: "secret123", newEmail: "new@b.com" }, cookie);
    expect(ok.status).toBe(200);
    expect((await get("/api/me", cookie)).status).toBe(401);

    // ④ 旧邮箱不能再登录；新邮箱可以
    expect((await post("/api/login", { email: "a@b.com", password: "secret123" })).status).toBe(401);
    expect((await post("/api/login", { email: "new@b.com", password: "secret123" })).status).toBe(200);
  });

  it("防枚举：不存在的邮箱请求重置 → 200 且没有邮件发出", async () => {
    const mail = deps.mail as MemoryEmailSender;
    const res = await post("/api/password-reset/request", { email: "nobody@b.com" });
    expect(res.status).toBe(200);
    expect(mail.sent).toHaveLength(0);
  });

  it("限流：同一邮箱第 4 次请求重置 → 429 RATE_LIMITED", async () => {
    for (let i = 0; i < 3; i++) {
      expect((await post("/api/password-reset/request", { email: "a@b.com" })).status).toBe(200);
    }
    const res = await post("/api/password-reset/request", { email: "a@b.com" });
    expect(res.status).toBe(429);
    expect(await errorOf(res)).toBe("RATE_LIMITED");
  });

  it("未带 cookie 访问 /api/me → 401（而非 500）", async () => {
    const res = await get("/api/me");
    expect(res.status).toBe(401);
  });
});
