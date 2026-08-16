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
  generatePort,
  freezePort,
  savePortFile,
  generateWiringDraft,
  analyzeRequirement,
  fetchModels,
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
import { buildDeps, createApp } from "./index";
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
    bizCache = { version, app: createHttpApp(createApp(buildDeps(cfg))) };
    console.log(`[admin] 业务实例已重建（配置版本变更: ${version.slice(0, 40)}…）`);
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

/** AI 接入助手（AI 助手-E）：body = { mock }。mock=规则+编译预检；真实=AI 片段+结构自动检查。 */
app.post("/admin/api/units/:name/wiring/ai", async (c) => {
  const name = c.req.param("name");
  const group = groupOf(c);
  const body = await c.req.json().catch(() => ({}));
  const { mock = true } = body as { mock?: boolean };
  try {
    return c.json(await generateWiringDraft(name, { mock }, group));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

/** 开发向导状态：功能规格定稿/判据/实现/接线/上线 五步进度。 */
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

/** AI 生成数据接口草稿（AI 助手 D）：body = { name, description, mock }。 */
app.post("/admin/api/ports/generate", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { name, description, mock = true } = body as { name?: string; description?: string; mock?: boolean };
  try {
    return c.json(await generatePort(name ?? "", description ?? "", mock, groupOf(c)));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

/** 冻结端口（人确认后）：body = { reviewer? }。 */
app.post("/admin/api/ports/:name/freeze", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { reviewer } = body as { reviewer?: string };
  try {
    return c.json(freezePort(c.req.param("name"), reviewer ?? "管理台操作员", groupOf(c)));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

/** 编辑端口文件（人编辑 + git 留痕）：body = { content, note }。 */
app.put("/admin/api/ports/:name", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { content, note } = body as { content?: string; note?: string };
  if (typeof content !== "string") {
    return c.json({ error: "content 必须是字符串" }, 400);
  }
  try {
    return c.json(savePortFile(c.req.param("name"), content, note ?? "", groupOf(c)));
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
// 流水线（超级向导）：一句话需求 → 自动规划 → 逐步生成 → 人逐步确认
// ---------------------------------------------------------------------------

/** 流水线状态（内存态：单条流水线；每一步产出后暂停等人确认）。 */
interface PipelineState {
  requirement: string;
  mock: boolean;
  plan: ReturnType<typeof analyzeRequirement>;
  step: "plan" | "port" | "contract" | "judge" | "implement" | "wiring" | "done";
  unit: string;
  group: string;
  /** 当前步产物（供界面展示）。 */
  artifact: unknown;
  log: string[];
}

let pipeline: PipelineState | null = null;

/** 流水线步骤说明（前端进度条用）。 */
const PIPELINE_STEPS: Array<{ id: string; label: string }> = [
  { id: "plan", label: "① 需求规划" },
  { id: "port", label: "② 数据接口生成" },
  { id: "contract", label: "③ 功能规格生成" },
  { id: "judge", label: "④ 验收测试生成" },
  { id: "implement", label: "⑤ 实现" },
  { id: "wiring", label: "⑥ 自动接入" },
  { id: "done", label: "⑦ 完成" },
];

/** 开始流水线：body = { requirement, mock }。 */
app.post("/admin/api/pipeline/start", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { requirement, mock = true } = body as { requirement?: string; mock?: boolean };
  if (!requirement || requirement.trim().length < 4) {
    return c.json({ error: "请用一句话描述功能需求（至少 4 字）" }, 400);
  }
  try {
    const plan = analyzeRequirement(requirement, groupOf(c));
    pipeline = {
      requirement,
      mock,
      plan,
      step: "plan",
      unit: plan.unitName,
      group: plan.group,
      artifact: { plan, steps: PIPELINE_STEPS },
      log: [`需求分析：${requirement}`, ...plan.reasons.map((r) => `  · ${r}`)],
    };
    return c.json(pipeline);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

/** 当前流水线状态。 */
app.get("/admin/api/pipeline", (c) => {
  return c.json(pipeline ?? { error: "尚未开始流水线", step: null });
});

/**
 * 确认/打回当前步，并推进到下一步。
 * body = { approved: boolean }
 */
app.post("/admin/api/pipeline/confirm", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { approved } = body as { approved?: boolean };
  if (!pipeline) return c.json({ error: "尚未开始流水线" }, 400);
  if (pipeline.step === "done") return c.json(pipeline);

  if (approved === false) {
    pipeline.log.push(`✗ 第 ${PIPELINE_STEPS.findIndex((s) => s.id === pipeline!.step) + 1} 步被打回——流水线终止，请人工处理已生成产物`);
    return c.json({ ...pipeline, rejected: true });
  }
  pipeline.log.push(`✓ 确认：${PIPELINE_STEPS.find((s) => s.id === pipeline!.step)?.label}`);

  const { plan, mock, unit, group } = pipeline;
  try {
    switch (pipeline.step) {
      case "plan": {
        // ① 规划确认：建组（如需要）+ 建单元 + 生成端口草稿（已存在则复用，流水线可重跑）
        if (plan.newGroup) {
          try {
            createGroup(plan.newGroup);
            pipeline.log.push(`  · 已创建服务组 ${plan.group}`);
          } catch (err) {
            pipeline.log.push(`  · 服务组已存在，复用 ${plan.group}`);
          }
        }
        try {
          createUnit(unit, group);
          pipeline.log.push(`  · 已创建单元 ${group}/features/${unit}`);
        } catch (err) {
          pipeline.log.push(`  · 单元已存在，复用 ${group}/features/${unit}`);
        }
        if (plan.portName) {
          const port = await generatePort(plan.portName, plan.portDescription, mock, group, "medium");
          pipeline.log.push("  · 推理等级：medium（端口设计）");
          pipeline.artifact = { port, portName: plan.portName };
          pipeline.log.push(`  · 已生成数据接口草稿 ${plan.portName}（自动检查后待确认）`);
        } else {
          pipeline.artifact = { port: null, note: "复用现有端口" };
        }
        pipeline.step = "port";
        break;
      }
      case "port": {
        // ② 端口确认：冻结端口 → 生成契约草稿
        if (plan.portName) {
          const r = freezePort(plan.portName, "流水线确认", group);
          pipeline.log.push(`  · ${r.message}`);
        }
        const draft = await generateDraft(unit, pipeline.requirement, mock, group, "high");
        pipeline.log.push("  · 推理等级：high（功能规格=考卷，最严谨）");
        const mc = machineCheck(unit, draft.ts, draft.md, group);
        pipeline.artifact = { draft, machine: mc };
        pipeline.log.push(`  · 已生成功能规格草稿（自动检查 ${mc.checks.every((x) => x.ok) ? "通过" : "有告警"}）`);
        pipeline.step = "contract";
        break;
      }
      case "contract": {
        // ③ 契约确认：冻结 → 生成判据骨架
        const r = freeze(unit, { generation: mock ? "模拟 AI" : "真实 AI", reviewer: "流水线确认", approved: "10/10" }, group);
        pipeline.log.push(`  · ${r.message}`);
        const judge = await generateJudgeTest(unit, mock, group, "high");
        pipeline.log.push("  · 推理等级：high（验收测试需覆盖全部要求）");
        pipeline.artifact = { judge };
        pipeline.log.push(`  · 已生成验收测试骨架（${judge.invariants.length} 条不变量）——占位判据需人工补全断言后才能冻结`);
        pipeline.step = "judge";
        break;
      }
      case "judge": {
        // ④ 判据确认：冻结判据（占位会被拦截）→ 交给实现器
        const r = freezeJudge(unit, "流水线确认", group);
        pipeline.log.push(`  · ${r.message}`);
        const impl = await implementUnit(unit, { mock, maxRounds: mock ? 2 : 5 }, group, "medium");
        pipeline.log.push("  · 推理等级：medium（实现迭代）");
        pipeline.artifact = { impl };
        pipeline.log.push(`  · 实现器结果：${impl.message}`);
        pipeline.step = "implement";
        break;
      }
      case "implement": {
        // ⑤ 实现确认（含"停手求援"的人工接受）→ 自动接入
        const wiring = await generateWiringDraft(unit, { mock }, group, "medium");
        pipeline.log.push("  · 推理等级：medium（自动接入）");
        pipeline.artifact = { wiring };
        pipeline.log.push(`  · 接入草稿：${wiring.source}；${mock ? wiring.preflight?.summary : "结构自动检查"}`);
        pipeline.step = "wiring";
        break;
      }
      case "wiring": {
        // ⑥ 接线确认：机器判据先行——预演失败（tsc 有错）禁止确认落盘
        const wiringArt = pipeline.artifact as { wiring?: { preflight?: { ok: boolean; summary: string } } } | undefined;
        if (wiringArt?.wiring?.preflight && !wiringArt.wiring.preflight.ok) {
          pipeline.log.push("✗ 编译预检失败——禁止确认落盘（机器判据拦截），请人工检查或打回");
          return c.json({ ...pipeline, error: `编译预检失败（tsc 有错）：${wiringArt.wiring.preflight.summary}` }, 400);
        }
        const r = applyWiring(unit, "流水线确认", group);
        pipeline.log.push(`  · ${r.message}`);
        pipeline.artifact = { apply: r };
        pipeline.step = "done";
        pipeline.log.push("🎉 流水线完成——请运行总闸（npm run check）并冒烟验证");
        break;
      }
      default:
        break;
    }
  } catch (err) {
    pipeline.log.push(`✗ 执行出错：${err instanceof Error ? err.message : String(err)}`);
    return c.json({ ...pipeline, error: err instanceof Error ? err.message : String(err) }, 400);
  }
  return c.json(pipeline);
});

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
 * 返回：{ ts, md, source, checks, tsc } —— 草稿 + 自动检查结果
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

/** 模型列表缓存（60 秒内不重复请求 /models）。 */
let modelsCache: { at: number; ids: string[] } | null = null;

/** 自动获取模型列表；失败（无 Key/网络）→ 兜底默认列表。 */
async function cachedModels(): Promise<string[]> {
  if (modelsCache && Date.now() - modelsCache.at < 60_000) return modelsCache.ids;
  try {
    const ids = await fetchModels();
    modelsCache = { at: Date.now(), ids };
    return ids;
  } catch {
    return CONFIG_KEYS.find((k) => k.key === "AI_MODEL")?.options ?? ["deepseek-v4-flash"];
  }
}

/** 配置面板视图：每个 key 的当前生效值 + 来源（本地文件/环境变量/默认值）+ 可选选项。 */
async function configView() {
  const local = readLocalConfig();
  const values = await Promise.all(CONFIG_KEYS.map(async ({ key, label, secret, fallback, options }) => {
    const fromLocal = key in local;
    const fromEnv = process.env[key] !== undefined && process.env[key] !== "";
    const value = resolveConfigValue(key, fallback);
    return {
      key,
      label,
      secret,
      // AI_MODEL：自动从 API 拉取可用模型（失败时用静态兜底列表）
      options: key === "AI_MODEL" ? await cachedModels() : options,
      fallback, // 供前端显示"默认值"占位
      value: secret && value ? maskSecret(value) : value,
      hasValue: value !== "",
      source: fromLocal ? "本地配置文件" : fromEnv ? "环境变量" : "默认值",
    };
  }));
  return { values, localPath: "featureunit-demo/.featureunit.local.json（已在 .gitignore）" };
}

/** 密钥打码：只显示首 4 + 尾 4（sk-abc…wxyz）。 */
function maskSecret(v: string): string {
  if (v.length <= 10) return "••••";
  return `${v.slice(0, 4)}••••${v.slice(-4)}`;
}

/** 读取配置面板视图（密钥打码）。 */
app.get("/admin/api/config", async (c) => {
  return c.json(await configView());
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
  return c.json(await configView());
});

// ---------------------------------------------------------------------------
// 试玩（业务冒烟：空框架为健康检查；功能接入后前端补充对应操作）
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
      storageMode: loadConfig().USER_STORE, // 当前数据存储模式（前端试玩面板展示）
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
