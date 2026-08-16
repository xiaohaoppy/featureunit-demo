/**
 * ============================================================================
 * [角色] 业务服务入口：dev-server —— 把某业务系统的组合根跑成真实 HTTP 服务
 * ----------------------------------------------------------------------------
 * 用法：
 *   npm run dev                       # 默认启动 auth-service（:3000）
 *   GROUP=order-service npm run dev   # 启动指定业务系统
 *
 * 生成的功能接入后（组合根 + http 路由 + manifest），这里就是它的访问入口：
 *   http://localhost:3000/api/health               健康检查
 *   http://localhost:3000/api/<功能名>             业务路由（接入时生成）
 *
 * 与管理台的关系：管理台（:3001）内置的「业务测试」面板用的是内部实例；
 * 本入口是独立的真实服务——给浏览器 / 前端 / 联调用。
 * ============================================================================
 */

import { serve } from "@hono/node-server";
import { join } from "node:path";
import { checkGit } from "./ai-contract-lib.mjs";

const ROOT = join(import.meta.dirname, ".."); // scripts/ → 项目根

// 启动前检查 git（框架硬依赖：定稿/预演/回滚全靠它）
const gitCheck = checkGit();
if (!gitCheck.ok) {
  console.warn("[server] ⚠️ 未检测到 git——本框架的留痕/回滚依赖 git，请先安装：https://git-scm.com");
}
const GROUP = process.env.GROUP ?? "auth-service";

/** 加载指定业务系统的组合根与 HTTP 适配器（每组有自己独立的 index.ts / http.ts / config.ts）。 */
const indexMod = await import(join(ROOT, "src/groups", GROUP, "index.ts"));
const httpMod = await import(join(ROOT, "src/groups", GROUP, "adapters", "http.ts"));
const configMod = await import(join(ROOT, "src/groups", GROUP, "config.ts"));

const cfg = configMod.loadConfig();
const app = httpMod.createHttpApp(indexMod.createApp(indexMod.buildDeps(cfg)));

serve({ fetch: app.fetch, port: cfg.PORT }, (info) => {
  console.log(`[server] 业务服务已启动：业务系统=${GROUP}，http://localhost:${info.port}（管理台在 :3001/admin）`);
});
