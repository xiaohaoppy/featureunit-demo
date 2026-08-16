#!/usr/bin/env node
/**
 * ============================================================================
 * [角色] 环境自检：doctor —— 回答"这台机器还缺什么"
 * ----------------------------------------------------------------------------
 * 用法：npm run doctor
 * 检查：Node 版本 / git / 依赖完整性 / better-sqlite3 原生模块 / 类型检查 / AI 配置。
 * 任何一项 ❌ 都会给出处理建议；全绿 = 环境就绪，可以 npm run admin。
 * ============================================================================
 */

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readLocalConfig } from "./ai-contract-lib.mjs";

const req = createRequire(import.meta.url);
const results = [];
const report = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// 1. Node 版本（engines: >=20）
const nodeMajor = Number(process.versions.node.split(".")[0]);
report("Node.js ≥ 20", nodeMajor >= 20, `当前 v${process.versions.node}${nodeMajor >= 20 ? "" : "（请升级：https://nodejs.org）"}`);

// 2. git（框架硬依赖：定稿提交/编译预检还原/历史回滚）
const git = spawnSync("git", ["--version"], { encoding: "utf8" });
report("git 已安装", git.status === 0, git.status === 0 ? git.stdout.trim() : "请安装：https://git-scm.com");

// 3. 运行依赖完整性（生产 npm start 也依赖这些）
for (const pkg of ["hono", "zod", "better-sqlite3", "@hono/node-server", "tsx"]) {
  try {
    req.resolve(pkg);
    report(`运行依赖 ${pkg}`, true);
  } catch {
    report(`运行依赖 ${pkg}`, false, "缺失——请运行 npm install");
  }
}

// 4. better-sqlite3 原生模块可加载（无预编译二进制时需要编译工具链）
try {
  const Database = req("better-sqlite3");
  const db = new Database(":memory:");
  db.prepare("select 1 as x").get();
  db.close();
  report("better-sqlite3 原生模块可加载", true);
} catch (e) {
  report("better-sqlite3 原生模块可加载", false,
    String(e.message ?? e).split("\n")[0] + "（无预编译二进制时需安装 python3/make/g++ 后重装）");
}

// 5. 类型检查（总闸的一部分）
const tsc = spawnSync("npx", ["tsc", "--noEmit"], { encoding: "utf8" });
const tscErr = (tsc.stdout + tsc.stderr).split("\n").filter(Boolean).slice(0, 1).join(" | ");
report("类型检查 tsc --noEmit", tsc.status === 0, tsc.status === 0 ? "" : tscErr);

// 6. AI 配置（可选：无密钥用 mock 模式体验完整流程，不算环境缺失）
const cfg = readLocalConfig();
console.log(cfg.AI_API_KEY
  ? "✅ AI 密钥已配置——真实模式可用"
  : "ℹ️ AI 密钥未配置（可选）——mock 模式可体验完整流程，管理台⚙️配置可填写");

const fails = results.filter((x) => !x).length;
console.log(`\n${fails === 0 ? "🎉 环境就绪——npm run admin 即可开始" : `⚠️ 有 ${fails} 项需要处理（见上方 ❌）`}`);
process.exit(fails === 0 ? 0 : 1);
