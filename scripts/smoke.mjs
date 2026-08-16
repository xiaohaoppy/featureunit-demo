#!/usr/bin/env node
/**
 * ============================================================================
 * [角色] 全量冒烟：smoke —— 一键自检框架所有功能
 * ----------------------------------------------------------------------------
 * 用法：npm run smoke
 *
 * 覆盖（每一项独立判定，汇总输出）：
 *   A. 静态完整性  prompt 文件 / 核心文件 / 脚本
 *   B. 构建与测试  tsc + vitest
 *   C. 管理台 API  业务系统/功能/数据接口/配置/源码/试玩/新建/生成/定稿守卫
 *   D. 流水线全链路  一句话需求 → 7 步（含空框架打包编译预检）
 *   E. CLI 与迁移   feat new / migrate
 *
 * 自包含：自动在独立端口(3101)起管理台、结束后清理全部演示产物与提交。
 * ============================================================================
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PORT = 3101;
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
let admin = null;

function report(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "content-type": "application/json" },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function run(cmd, args, env = {}) {
  return spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", env: { ...process.env, ...env }, timeout: 120_000 });
}

function runAsync(cmd, args, env = {}) {
  return spawn(cmd, args, { cwd: ROOT, stdio: "ignore", env: { ...process.env, ...env } });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// 启动管理台（独立端口，测试完关闭）
// ---------------------------------------------------------------------------

admin = runAsync("npx", ["tsx", "src/groups/auth-service/admin-server.ts"], { ADMIN_PORT: String(PORT) });
let ready = false;
for (let i = 0; i < 30; i++) {
  await sleep(500);
  try {
    const r = await fetch(`${BASE}/admin`);
    if (r.ok) { ready = true; break; }
  } catch { /* 等待启动 */ }
}
report("管理台启动（:3101）", ready, ready ? "" : "30 次重试未就绪");

// ---------------------------------------------------------------------------
// A. 静态完整性
// ---------------------------------------------------------------------------

console.log("\n── A. 静态完整性 ──");
const prompts = ["01-contract-drafter.md", "02-contract-reviewer.md", "03-unit-implementer.md",
  "04-judge-drafter.md", "05-port-drafter.md", "06-composition-drafter.md"];
report("6 份 AI 助手提示词齐全", prompts.every((f) => existsSync(join(ROOT, "docs/agent-prompts", f))),
  prompts.filter((f) => !existsSync(join(ROOT, "docs/agent-prompts", f))).join(","));

const core = [
  "scripts/ai-contract-lib.mjs", "scripts/feat.mjs", "scripts/migrate.ts",
  "src/groups/auth-service/index.ts", "src/groups/auth-service/adapters/http.ts",
  "src/groups/auth-service/config.ts", "src/groups/auth-service/admin-server.ts",
  "src/groups/auth-service/ports/errors.ts", "src/groups/auth-service/ports/logger.ts",
  "public/admin.html", "public/admin.js",
];
report("核心文件齐全", core.every((f) => existsSync(join(ROOT, f))),
  core.filter((f) => !existsSync(join(ROOT, f))).join(","));

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const needScripts = ["check", "admin", "migrate", "feat", "smoke"];
report("package.json 脚本齐全", needScripts.every((s) => pkg.scripts?.[s]),
  needScripts.filter((s) => !pkg.scripts?.[s]).join(","));

// ---------------------------------------------------------------------------
// B. 构建与测试
// ---------------------------------------------------------------------------

console.log("\n── B. 构建与测试 ──");
let tsc = run("npx", ["tsc", "--noEmit"]);
report("类型检查 tsc --noEmit", tsc.status === 0, tsc.status === 0 ? "" : (tsc.stdout + tsc.stderr).split("\n").filter(Boolean).slice(0, 2).join(" | "));
let vitest = run("npx", ["vitest", "run"]);
const vt = (vitest.stdout + vitest.stderr).match(/Tests\s+(\d+)\s+(passed|failed)/)?.[0] ?? "";
report("单元测试 vitest", vitest.status === 0, vt);

// ---------------------------------------------------------------------------
// C. 管理台 API
// ---------------------------------------------------------------------------

console.log("\n── C. 管理台 API ──");
if (ready) {
  let r = await api("/admin/api/groups");
  report("业务系统列表", r.status === 200 && r.data.groups?.includes("auth-service"), JSON.stringify(r.data.groups));

  r = await api("/admin/api/units");
  report("功能列表（空框架）", r.status === 200 && Array.isArray(r.data.units), `${r.data.units?.length ?? "?"} 个`);

  r = await api("/admin/api/ports");
  const portNames = (r.data.ports ?? []).map((p) => p.name).join(",");
  report("数据接口列表（通用接口）", r.status === 200 && r.data.ports?.length === 2, portNames);

  r = await api("/admin/api/config");
  const keys = r.data.values?.map((v) => v.key) ?? [];
  const needKeys = ["AI_API_KEY", "AI_MODEL", "AI_REASONING", "USER_STORE", "SQLITE_PATH", "PORT"];
  report("配置项齐全", needKeys.every((k) => keys.includes(k)), keys.filter((k) => needKeys.includes(k)).join(","));
  report("存储模式下拉", r.data.values?.find((v) => v.key === "USER_STORE")?.options?.length === 3, "");
  report("推理等级下拉", r.data.values?.find((v) => v.key === "AI_REASONING")?.options?.length === 3, "");

  // 配置保存（写入本地文件 → 恢复）
  r = await api("/admin/api/config", { method: "PUT", body: JSON.stringify({ values: { USER_STORE: "sqlite" } }) });
  const saved = r.data.values?.find((v) => v.key === "USER_STORE");
  report("配置保存生效", r.status === 200 && saved?.value === "sqlite" && saved?.source === "本地配置文件", `source=${saved?.source}`);
  await api("/admin/api/config", { method: "PUT", body: JSON.stringify({ values: { USER_STORE: "" } }) });

  r = await api("/admin/api/source/list");
  report("代码浏览列表", r.status === 200 && r.data.files?.length > 0, `${r.data.files?.length ?? 0} 个文件`);
  r = await api("/admin/api/source?file=ports/errors.ts");
  report("代码浏览读取", r.status === 200 && r.data.content?.includes("AppError"), "");

  r = await api("/admin/api/play", { method: "POST", body: JSON.stringify({ method: "GET", path: "/api/health" }) });
  report("试玩健康检查", r.status === 200 && r.data.body?.includes("ok"), `HTTP ${r.status}`);
  report("试玩携带存储模式", typeof r.data.storageMode === "string", `storageMode=${r.data.storageMode}`);

  // 新建业务系统（冒烟组）
  r = await api("/admin/api/groups", { method: "POST", body: JSON.stringify({ name: "smoke-group" }) });
  report("新建业务系统", r.status === 200, r.data.error ?? "");
  const gFiles = ["features", "ports/errors.ts", "ports/logger.ts", "adapters/http.ts", "index.ts", "config.ts", "manifest.json", "group.test.ts"];
  report("业务系统骨架完整", gFiles.every((f) => existsSync(join(ROOT, "src/groups/smoke-group", f))),
    gFiles.filter((f) => !existsSync(join(ROOT, "src/groups/smoke-group", f))).join(","));

  // 新建功能
  r = await api("/admin/api/units", { method: "POST", body: JSON.stringify({ name: "smoke-unit" }) });
  report("新建功能", r.status === 200, r.data.error ?? "");

  // AI 生成功能规格（mock）→ 自动检查 → 定稿守卫
  r = await api("/admin/api/ai/generate", { method: "POST", body: JSON.stringify({ name: "smoke-unit", requirement: "冒烟测试功能", mock: true }) });
  const mc = r.data.checks?.map((c) => (c.ok ? "✅" : "⚠️")).join("");
  report("AI 生成功能规格（自动检查）", r.status === 200 && Array.isArray(r.data.checks), mc ?? "");
  const reviews = Array(10).fill(true);
  r = await api("/admin/api/ai/freeze", { method: "POST", body: JSON.stringify({ name: "smoke-unit", reviews }) });
  report("功能规格定稿", r.data.frozen === true, r.data.message ?? "");
  r = await api("/admin/api/ai/generate", { method: "POST", body: JSON.stringify({ name: "smoke-unit", requirement: "x", mock: true }) });
  report("定稿守卫（拒绝覆盖）", r.status !== 200 && /已定稿/.test(r.data.error ?? ""), r.data.error ?? "");
}

// ---------------------------------------------------------------------------
// D. 流水线全链路（含空框架打包编译预检）
// ---------------------------------------------------------------------------

console.log("\n── D. 流水线全链路 ──");
if (ready) {
  let r = await api("/admin/api/pipeline/start", { method: "POST", body: JSON.stringify({ requirement: "支持用户收藏商品", mock: true }) });
  report("流水线启动（自动规划）", r.status === 200 && r.data.plan?.newGroup === "favorite-service", `${r.data.plan?.group ?? "?"}/${r.data.plan?.unitName ?? "?"}`);

  r = await api("/admin/api/pipeline/confirm", { method: "POST", body: JSON.stringify({ approved: true }) });
  report("① 规划确认 → 建系统/功能/数据接口", r.status === 200 && r.data.step === "port", `端口草稿初审 ${r.data.artifact?.port?.checks?.map((c) => (c.ok ? "✅" : "⚠️")).join("") ?? ""}`);

  r = await api("/admin/api/pipeline/confirm", { method: "POST", body: JSON.stringify({ approved: true }) });
  report("② 数据接口定稿 → 功能规格生成", r.status === 200 && r.data.step === "contract", "");

  r = await api("/admin/api/pipeline/confirm", { method: "POST", body: JSON.stringify({ approved: true }) });
  report("③ 功能规格定稿 → 验收测试骨架", r.status === 200 && r.data.step === "judge", `${r.data.artifact?.judge?.invariants?.length ?? 0} 条要求`);

  // 占位验收测试定稿应被拦截
  r = await api("/admin/api/pipeline/confirm", { method: "POST", body: JSON.stringify({ approved: true }) });
  report("④ 占位验收测试被拦截", r.status !== 200 && /占位/.test(r.data.error ?? ""), r.data.error ?? "");

  // 人补全验收测试
  const judge = `import { describe, expect, it } from "vitest";
import { toggleFavorite } from "./impl";
import { silentLogger } from "../../ports/logger";
describe("toggle-favorite 单元判据", () => {
  it("不变量1｜token 有效时执行操作", async () => {
    await expect(toggleFavorite({ token: "t1", payload: {} }, { logger: silentLogger })).resolves.toBeUndefined();
  });
});`;
  r = await api("/admin/api/units/toggle-favorite/files?group=favorite-service", {
    method: "PUT",
    body: JSON.stringify({ file: "test", content: judge, note: "冒烟补全验收测试" }),
  });
  report("人补全验收测试（git 留痕）", r.status === 200, r.data.message ?? "");

  r = await api("/admin/api/pipeline/confirm", { method: "POST", body: JSON.stringify({ approved: true }) });
  report("④ 验收测试定稿 → 实现", r.status === 200 && r.data.step === "implement", r.data.artifact?.impl?.message?.slice(0, 30) ?? "");

  r = await api("/admin/api/pipeline/confirm", { method: "POST", body: JSON.stringify({ approved: true }) });
  report("⑤ 实现确认 → 自动接入（编译预检）", r.status === 200 && r.data.step === "wiring", r.data.artifact?.wiring?.preflight?.summary?.slice(0, 50) ?? "");

  r = await api("/admin/api/pipeline/confirm", { method: "POST", body: JSON.stringify({ approved: true }) });
  const doneOk = r.data.step === "done" && (r.data.error ?? "") === "";
  report("⑥ 接入确认 → 完成", doneOk, r.data.error ?? r.data.artifact?.apply?.message ?? "");
}

// ---------------------------------------------------------------------------
// E. CLI 与迁移
// ---------------------------------------------------------------------------

console.log("\n── E. CLI 与迁移 ──");
let feat = run("node", ["scripts/feat.mjs", "ticket", "login"]);
report("feat ticket（打印任务单）", feat.status === 0 && /功能规格/.test(feat.stdout) === false && feat.stdout.includes("impl.ts"), "OK");

let migrate = run("npx", ["tsx", "scripts/migrate.ts"], { USER_STORE: "sqlite" });
report("npm run migrate（sqlite 建库）", migrate.status === 0 && /framework_meta/.test(migrate.stdout), (migrate.stdout.match(/表:.*/) ?? [""])[0]);

// ---------------------------------------------------------------------------
// 清理：删除演示产物 + 撤销冒烟提交 + 恢复配置
// ---------------------------------------------------------------------------

console.log("\n── 清理 ──");
const cleanDirs = ["src/groups/smoke-group", "src/groups/favorite-service", "data"];
for (const d of cleanDirs) rmSync(join(ROOT, d), { recursive: true, force: true });
// 撤销冒烟期间产生的提交（定稿/编辑/接入等），回到冒烟前 HEAD
const baseHead = run("git", ["log", "-1", "--format=%H"]);
spawnSync("git", ["add", "-A"], { cwd: ROOT });
const commitCount = run("git", ["rev-list", "--count", "HEAD", "--not", baseHead.stdout.trim()]);
for (let i = 0; i < parseInt(commitCount.stdout, 10); i++) {
  spawnSync("git", ["reset", "-q", "--hard", "HEAD~1"], { cwd: ROOT });
}
spawnSync("git", ["clean", "-q", "-fd", "--", "src/groups/", "data/"], { cwd: ROOT });
report("演示产物与提交已清理", run("git", ["status", "--short"]).stdout.trim() === "", "");

// 关闭管理台
admin?.kill("SIGTERM");

// ---------------------------------------------------------------------------
// 汇总
// ---------------------------------------------------------------------------

console.log("\n" + "═".repeat(52));
console.log("全量冒烟汇总");
console.log("═".repeat(52));
const fails = results.filter((r) => !r.ok);
for (const r of results) console.log(`  ${r.ok ? "✅" : "❌"} ${r.name}`);
console.log("─".repeat(52));
console.log(`通过 ${results.length - fails.length}/${results.length}${fails.length ? `，缺失 ${fails.length} 项：\n  ${fails.map((f) => f.name).join("\n  ")}` : "，全部通过 🎉"}`);
process.exit(fails.length ? 1 : 0);
