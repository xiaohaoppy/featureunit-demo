/**
 * ============================================================================
 * [角色] 入口：dev-server —— 本地开发服务器
 * ----------------------------------------------------------------------------
 * 职责：loadConfig → buildDeps → createAuthApp → createHttpApp → 监听端口。
 * 这四行就是整个服务组的"出生证明"：所有部件在这里第一次见面。
 *
 * 运行：npm run dev（默认 http://localhost:3000）
 * ============================================================================
 */

import { serve } from "@hono/node-server";
import { loadConfig } from "./config";
import { buildDeps, createAuthApp } from "./index";
import { createHttpApp } from "./adapters/http";

const config = loadConfig();
const app = createHttpApp(createAuthApp(buildDeps(config)));

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`[dev-server] auth-service 已启动: http://localhost:${info.port}`);
  console.log(`[dev-server] 用户存储: ${config.USER_STORE}（生产请替换为 Postgres/Redis 适配器）`);
});
