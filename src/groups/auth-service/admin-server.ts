/**
 * ============================================================================
 * [角色] 管理台：admin-server —— 用界面管理 FeatureUnit 框架
 * ----------------------------------------------------------------------------
 * 独立于业务服务的管理端（端口 3001），把框架的日常动作收进一个页面：
 *
 *   单元总览     → GET  /admin/api/units
 *   单元详情     → GET  /admin/api/units/:name          （4 文件内容）
 *   运行判据     → POST /admin/api/units/:name/test
 *   运行全部     → POST /admin/api/tests/all
 *   AI 生成契约  → POST /admin/api/ai/generate          （mock/真实）
 *   人评审冻结   → POST /admin/api/ai/freeze            （10 项逐条确认，全过才冻结）
 *   Ticket      → GET  /admin/api/ticket/:name
 *   源码浏览     → GET  /admin/api/source?file=...
 *   页面         → GET  /admin （单页 HTML，无前端构建链）
 *
 * 设计原则：
 *   - 所有管理逻辑复用 scripts/ai-contract-lib.mjs（与 CLI 同源，行为一致）；
 *   - 冻结权在人：/api/ai/freeze 收到任一项 false 即拒绝冻结；
 *   - 源码浏览限制在 src/groups/auth-service 内（lib 内做路径穿越防护）。
 *
 * 运行：npm run admin（http://localhost:3001/admin）
 * ============================================================================
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  GROUP,
  REVIEW_ITEMS,
  listUnits,
  readUnitFiles,
  generateDraft,
  machineCheck,
  freeze,
  runUnitTest,
  runAllTests,
  buildTicketText,
  readSourceFile,
  listSourceFiles,
} from "../../../scripts/ai-contract-lib.mjs";

const ROOT = join(import.meta.dirname, "..", "..", ".."); // src/groups/auth-service → 项目根
const PUBLIC_DIR = join(ROOT, "public");

const app = new Hono();

// ---------------------------------------------------------------------------
// 静态页面（零构建：直接读 public/ 下的 HTML/JS 返回）
// ---------------------------------------------------------------------------

app.get("/admin", (c) => {
  const html = readFileSync(join(PUBLIC_DIR, "admin.html"), "utf8");
  return c.html(html);
});

app.get("/admin/app.js", (c) => {
  const js = readFileSync(join(PUBLIC_DIR, "admin.js"), "utf8");
  return c.body(js, 200, { "content-type": "text/javascript; charset=utf-8" });
});

// ---------------------------------------------------------------------------
// 单元总览 / 详情
// ---------------------------------------------------------------------------

app.get("/admin/api/units", (c) => {
  const units = listUnits().map((name) => {
    const files = readUnitFiles(name);
    return {
      name,
      hasContract: files.contract !== null,
      hasSpec: files.spec !== null,
      hasImpl: files.impl !== null,
      hasTest: files.test !== null,
      // 是否已冻结：契约文件头部带"冻结记录"标记
      frozen: (files.contract ?? "").includes("冻结记录"),
    };
  });
  return c.json({ group: GROUP, units, reviewItems: REVIEW_ITEMS });
});

app.get("/admin/api/units/:name", (c) => {
  const name = c.req.param("name");
  const files = readUnitFiles(name);
  if (!files.contract) return c.json({ error: `功能单元不存在: ${name}` }, 404);
  return c.json({ name, files });
});

// ---------------------------------------------------------------------------
// 判据运行
// ---------------------------------------------------------------------------

app.post("/admin/api/units/:name/test", async (c) => {
  const name = c.req.param("name");
  return c.json(runUnitTest(name));
});

app.post("/admin/api/tests/all", async (c) => {
  return c.json(runAllTests());
});

// ---------------------------------------------------------------------------
// AI 生成契约 + 人评审冻结
// ---------------------------------------------------------------------------

/**
 * 生成契约草稿：body = { name, requirement, mock }
 * 返回：{ ts, md, source, checks, tsc } —— 草稿 + 机器初审结果
 */
app.post("/admin/api/ai/generate", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { name, requirement, mock = true } = body as {
    name?: string;
    requirement?: string;
    mock?: boolean;
  };

  if (!name || !/^[a-z0-9-]+$/.test(name ?? "")) {
    return c.json({ error: "功能名不合法（只允许小写字母/数字/连字符）" }, 400);
  }
  if (!requirement || requirement.trim().length < 4) {
    return c.json({ error: "需求描述太短（至少 4 个字符）" }, 400);
  }

  try {
    const draft = await generateDraft(name, requirement, mock);
    const { checks, tsc } = machineCheck(name, draft.ts, draft.md);
    return c.json({ ...draft, checks, tsc });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

/**
 * 人评审冻结：body = { name, reviews: boolean[10] }
 * 全部 true → 冻结（冻结记录 + git 提交）；任一 false → 打回，绝不冻结。
 */
app.post("/admin/api/ai/freeze", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { name, reviews } = body as { name?: string; reviews?: boolean[] };

  if (!name || !Array.isArray(reviews) || reviews.length !== REVIEW_ITEMS.length) {
    return c.json({ error: `reviews 必须是 ${REVIEW_ITEMS.length} 项布尔数组` }, 400);
  }

  const rejected = reviews.map((ok, i) => (ok ? null : REVIEW_ITEMS[i])).filter(Boolean);
  if (rejected.length > 0) {
    // 打回：不写冻结记录、不提交。草稿保留在文件里供人工修改。
    return c.json({ frozen: false, rejected });
  }

  try {
    const result = freeze(name, {
      generation: "AI 生成 + 管理台评审",
      reviewer: "管理台操作员",
      approved: `${REVIEW_ITEMS.length}/${REVIEW_ITEMS.length}`,
    });
    return c.json({ frozen: true, rejected: [], ...result });
  } catch (err) {
    // 单元不存在 / 文件缺失等 → 结构化错误（而不是裸 500）
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// Ticket 与源码浏览
// ---------------------------------------------------------------------------

app.get("/admin/api/ticket/:name", (c) => {
  const name = c.req.param("name");
  const files = readUnitFiles(name);
  if (!files.contract) return c.json({ error: `功能单元不存在: ${name}` }, 404);
  return c.json({ name, ticket: buildTicketText(name) });
});

app.get("/admin/api/source", (c) => {
  const file = c.req.query("file") ?? "";
  const content = readSourceFile(file);
  if (content === null) return c.json({ error: `文件不存在或越界: ${file}` }, 404);
  return c.json({ file, content });
});

app.get("/admin/api/source/list", (c) => {
  return c.json({ files: listSourceFiles() });
});

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------

const PORT = Number(process.env.ADMIN_PORT ?? 3001);
serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[admin] FeatureUnit 管理台: http://localhost:${info.port}/admin`);
});
