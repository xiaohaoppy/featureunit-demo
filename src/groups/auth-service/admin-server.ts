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
  CONFIG_KEYS,
  listGroups,
  createGroup,
  portList,
  createPort,
  listUnits,
  readUnitFiles,
  readLocalConfig,
  writeLocalConfig,
  resolveConfigValue,
  generateDraft,
  machineCheck,
  freeze,
  runUnitTest,
  runAllTests,
  buildTicketText,
  readSourceFile,
  listSourceFiles,
  createUnit,
  saveUnitFile,
  checkWiring,
  generateJudgeTest,
  freezeJudge,
  implementUnit,
  unitStatus,
  generateWiring,
  applyWiring,
  unitHistory,
  rollbackUnit,
  portDependencyMap,
  checkErrorCodes,
} from "../../../scripts/ai-contract-lib.mjs";
import { loadConfig } from "./config";
import { buildDeps, createAuthApp } from "./index";
import { createHttpApp } from "./adapters/http";

const ROOT = join(import.meta.dirname, "..", "..", ".."); // src/groups/auth-service → 项目根
const PUBLIC_DIR = join(ROOT, "public");

// 业务应用实例（"试玩"面板直接调用，无需另起 dev 服务）。
// 惰性 + 配置版本检测：管理台「配置」面板改了 USER_STORE 等后，
// 下一次试玩请求自动按新配置重建实例（不用重启管理台）。
let bizCache: { version: string; app: Hono } | null = null;

function bizAppFor(): Hono {
  const cfg = loadConfig(); // 每次读配置（含本地文件），校验失败会 fail fast
  const version = JSON.stringify(cfg);
  if (!bizCache || bizCache.version !== version) {
    bizCache = { version, app: createHttpApp(createAuthApp(buildDeps(cfg))) };
    console.log(`[admin] 业务实例已重建（配置版本变更）: USER_STORE=${cfg.USER_STORE}`);
  }
  return bizCache.app;
}

const app = new Hono();

/** 从 query 读取服务组（默认 auth-service）；前端组切换时附带 ?group=。 */
function groupOf(c: { req: { query(key: string): string | undefined } }): string {
  return c.req.query("group") ?? GROUP;
}

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
// 单元总览 / 详情 / 新建 / 文件编辑 / 接线检查
// ---------------------------------------------------------------------------

app.get("/admin/api/groups", (c) => {
  return c.json({ groups: listGroups(), current: groupOf(c) });
});

/** 新建服务组：body = { name }。生成组骨架（端口/组合根/配置/manifest）。 */
app.post("/admin/api/groups", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { name } = body as { name?: string };
  try {
    createGroup(name ?? "");
    return c.json({ ok: true, name });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

app.get("/admin/api/units", (c) => {
  const group = groupOf(c);
  const units = listUnits(group).map((name) => {
    const files = readUnitFiles(name, group);
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
  return c.json({ group, units, reviewItems: REVIEW_ITEMS });
});

app.get("/admin/api/units/:name", (c) => {
  const name = c.req.param("name");
  const group = groupOf(c);
  const files = readUnitFiles(name, group);
  if (!files.contract) return c.json({ error: `功能单元不存在: ${name}` }, 404);
  return c.json({ name, group, files });
});

/** 新建功能单元（feat new 的界面入口）：body = { name } */
app.post("/admin/api/units", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { name } = body as { name?: string };
  const group = groupOf(c);
  try {
    createUnit(name ?? "", group);
    return c.json({ ok: true, name, group });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

/**
 * 保存单元文件（管理台编辑，人编辑 + git 留痕）：
 * body = { file: "contract"|"spec"|"impl"|"test", content, note }
 */
app.put("/admin/api/units/:name/files", async (c) => {
  const name = c.req.param("name");
  const group = groupOf(c);
  const body = await c.req.json().catch(() => ({}));
  const { file, content, note } = body as {
    file?: "contract" | "spec" | "impl" | "test";
    content?: string;
    note?: string;
  };
  if (typeof content !== "string") {
    return c.json({ error: "content 必须是字符串" }, 400);
  }
  try {
    return c.json(saveUnitFile(name, file ?? "impl", content, note ?? "", group));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

/** 接线检查：组合根/HTTP/manifest 是否已接入该单元。 */
app.get("/admin/api/units/:name/wiring", (c) => {
  const name = c.req.param("name");
  const group = groupOf(c);
  const files = readUnitFiles(name, group);
  if (!files.contract) return c.json({ error: `功能单元不存在: ${name}` }, 404);
  return c.json(checkWiring(name, group));
});

/** 一键接线：生成 diff（不落盘）——人审阅。 */
app.get("/admin/api/units/:name/wiring/preview", (c) => {
  const name = c.req.param("name");
  const group = groupOf(c);
  try {
    return c.json(generateWiring(name, group));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

/** 一键接线：人确认后落盘 + git 提交。body = { note? } */
app.post("/admin/api/units/:name/wiring/apply", async (c) => {
  const name = c.req.param("name");
  const group = groupOf(c);
  const body = await c.req.json().catch(() => ({}));
  const { note } = body as { note?: string };
  try {
    return c.json(applyWiring(name, note ?? "", group));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

/** 开发向导状态：契约冻结/判据/实现/接线/上线 五步进度。 */
app.get("/admin/api/units/:name/status", (c) => {
  const name = c.req.param("name");
  const status = unitStatus(name, groupOf(c));
  if (!status) return c.json({ error: `功能单元不存在: ${name}` }, 404);
  return c.json(status);
});

/** AI 生成判据（Agent-B）：body = { mock }。生成草稿 → 人确认 → 冻结。 */
app.post("/admin/api/units/:name/judge", async (c) => {
  const name = c.req.param("name");
  const group = groupOf(c);
  const body = await c.req.json().catch(() => ({}));
  const { mock = true } = body as { mock?: boolean };
  try {
    const r = await generateJudgeTest(name, mock, group);
    return c.json(r);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

/** 冻结判据（人确认后）：body = { reviewer? }。 */
app.post("/admin/api/units/:name/judge/freeze", async (c) => {
  const name = c.req.param("name");
  const group = groupOf(c);
  const body = await c.req.json().catch(() => ({}));
  const { reviewer } = body as { reviewer?: string };
  try {
    return c.json(freezeJudge(name, reviewer ?? "管理台操作员", group));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

/** 内置实现器（Agent-C 自动迭代）：body = { mock, maxRounds }。 */
app.post("/admin/api/units/:name/implement", async (c) => {
  const name = c.req.param("name");
  const group = groupOf(c);
  const body = await c.req.json().catch(() => ({}));
  const { mock = true, maxRounds = 5 } = body as { mock?: boolean; maxRounds?: number };
  try {
    const r = await implementUnit(name, { mock, maxRounds }, group);
    return c.json(r);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

// ---------------------------------------------------------------------------
// P2：提交历史 / 回滚 / 端口依赖矩阵 / 错误码一致性
// ---------------------------------------------------------------------------

/** 单元最近提交历史（供回滚面板选择）。 */
app.get("/admin/api/units/:name/history", (c) => {
  const name = c.req.param("name");
  const group = groupOf(c);
  try {
    return c.json({ name, group, commits: unitHistory(name, group) });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

/** 回滚该单元的指定提交：body = { commit }。git revert，历史保留。 */
app.post("/admin/api/units/:name/rollback", async (c) => {
  const name = c.req.param("name");
  const group = groupOf(c);
  const body = await c.req.json().catch(() => ({}));
  const { commit } = body as { commit?: string };
  if (!commit) return c.json({ error: "缺少 commit 哈希" }, 400);
  try {
    return c.json(rollbackUnit(name, commit, group));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

/** 端口依赖矩阵：每个单元依赖哪些端口。 */
app.get("/admin/api/ports/map", (c) => {
  return c.json(portDependencyMap(groupOf(c)));
});

/** 端口统一管理：列表（一句话/依赖单元/适配器实现）。 */
app.get("/admin/api/ports", (c) => {
  return c.json(portList(groupOf(c)));
});

/** 新建端口（冻结区模板）：body = { name, description }。 */
app.post("/admin/api/ports", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { name, description } = body as { name?: string; description?: string };
  try {
    const r = createPort(name ?? "", description ?? "", groupOf(c));
    return c.json({ ok: true, ...r });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

/** 错误码一致性检查：spec 声明 vs impl 抛出 vs errors.ts 定义。 */
app.get("/admin/api/units/:name/errorcodes", (c) => {
  const name = c.req.param("name");
  const group = groupOf(c);
  try {
    return c.json(checkErrorCodes(name, group));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
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
// 配置管理（含密钥：默认打码；写入 .featureunit.local.json，不进 git）
// ---------------------------------------------------------------------------

/** 配置面板视图：每个 key 的当前生效值 + 来源（本地文件/环境变量/默认值）+ 可选选项。 */
function configView() {
  const local = readLocalConfig();
  const values = CONFIG_KEYS.map(({ key, label, secret, fallback, options }) => {
    const fromLocal = key in local;
    const fromEnv = process.env[key] !== undefined && process.env[key] !== "";
    const value = resolveConfigValue(key, fallback);
    return {
      key,
      label,
      secret,
      options,
      value: secret && value ? maskSecret(value) : value,
      hasValue: value !== "",
      source: fromLocal ? "本地配置文件" : fromEnv ? "环境变量" : "默认值",
    };
  });
  return { values, localPath: "featureunit-demo/.featureunit.local.json（已在 .gitignore）" };
}

/** 密钥打码：只显示首 4 + 尾 4（sk-abc…wxyz）。 */
function maskSecret(v: string): string {
  if (v.length <= 10) return "••••";
  return `${v.slice(0, 4)}••••${v.slice(-4)}`;
}

/** 读取配置面板视图（密钥打码）。 */
app.get("/admin/api/config", (c) => {
  return c.json(configView());
});

/**
 * 保存配置：body = { values: { key: value } }
 * 写入 .featureunit.local.json；空字符串 = 删除该 key。
 * 保存后返回最新视图（含来源标注）。
 */
app.put("/admin/api/config", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { values } = body as { values?: Record<string, string> };
  if (!values || typeof values !== "object") {
    return c.json({ error: "values 必须是 { key: value } 对象" }, 400);
  }
  // 只接受 CONFIG_KEYS 里登记的 key（防任意写文件）
  const allowed = new Set(CONFIG_KEYS.map((x) => x.key));
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!allowed.has(key)) continue;
    clean[key] = typeof value === "string" ? value.trim() : String(value ?? "");
  }
  writeLocalConfig(clean);
  return c.json(configView());
});

// ---------------------------------------------------------------------------
// 试玩（业务冒烟：注册/登录/查我/登出/改密/改邮箱/找回密码）
// ---------------------------------------------------------------------------

/**
 * 代理到内部业务应用：body = { method, path, body?, cookie? }
 * 返回 { status, body, setCookie }——前端自行保存 cookie 模拟浏览器。
 */
app.post("/admin/api/play", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { method = "GET", path, data, cookie } = body as {
    method?: string;
    path?: string;
    data?: unknown;
    cookie?: string;
  };
  if (typeof path !== "string" || !path.startsWith("/api/")) {
    return c.json({ error: "path 必须以 /api/ 开头" }, 400);
  }
  try {
    const res = await bizAppFor().request(path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: data !== undefined ? JSON.stringify(data) : undefined,
    });
    return c.json({
      status: res.status,
      body: await res.text(),
      setCookie: res.headers.get("set-cookie") ?? null,
      storageMode: loadConfig().USER_STORE, // 附带回当前存储模式，前端展示
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// Ticket 与源码浏览
// ---------------------------------------------------------------------------

app.get("/admin/api/ticket/:name", (c) => {
  const name = c.req.param("name");
  const group = groupOf(c);
  const files = readUnitFiles(name, group);
  if (!files.contract) return c.json({ error: `功能单元不存在: ${name}` }, 404);
  return c.json({ name, ticket: buildTicketText(name, group) });
});

app.get("/admin/api/source", (c) => {
  const file = c.req.query("file") ?? "";
  const content = readSourceFile(file, groupOf(c));
  if (content === null) return c.json({ error: `文件不存在或越界: ${file}` }, 404);
  return c.json({ file, content });
});

app.get("/admin/api/source/list", (c) => {
  return c.json({ files: listSourceFiles(groupOf(c)) });
});

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------

const PORT = Number(process.env.ADMIN_PORT ?? 3001);
serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[admin] FeatureUnit 管理台: http://localhost:${info.port}/admin`);
});
