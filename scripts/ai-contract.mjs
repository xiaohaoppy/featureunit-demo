#!/usr/bin/env node
/**
 * ============================================================================
 * [角色] CLI 入口：ai-contract —— AI 生成契约草稿，人确认后才冻结
 * ----------------------------------------------------------------------------
 * 本文件只是"薄壳"：所有逻辑在 ai-contract-lib.mjs（与管理界面共用）。
 * 这里只负责：命令行参数解析 + 交互式评审（逐条 y/n）+ 结果打印。
 *
 * 用法：
 *   npm run feat -- ai-contract <功能名> "<一句话需求>" [--mock] [--yes]
 *
 * 配置（真实模式）：AI_API_KEY（或 DEEPSEEK_API_KEY）、AI_BASE_URL、AI_MODEL
 * ============================================================================
 */

import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { join } from "node:path";
import {
  ROOT,
  REVIEW_ITEMS,
  generateDraft,
  machineCheck,
  freeze,
} from "./ai-contract-lib.mjs";

// ---------------------------------------------------------------------------
// 参数解析
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const name = args[0];
const flags = args.filter((a) => a.startsWith("--"));
const requirement = args.filter((a) => !a.startsWith("--")).slice(1).join(" ");
const MOCK = flags.includes("--mock");
const AUTO_YES = flags.includes("--yes");

if (!name || !/^[a-z0-9-]+$/.test(name)) {
  console.error("用法: npm run feat -- ai-contract <功能名> \"<一句话需求>\" [--mock] [--yes]");
  process.exit(1);
}
if (!requirement) {
  console.error("✗ 缺少需求描述。示例: npm run feat -- ai-contract delete-account \"登录用户可以删除自己的账号\"");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// ① 生成草稿
// ---------------------------------------------------------------------------

console.log(`\n${"═".repeat(64)}`);
console.log(`① AI 契约设计（Agent-A）`);
console.log(`${"═".repeat(64)}`);
console.log(`功能: ${name}`);
console.log(`需求: ${requirement}`);
console.log(`模式: ${MOCK ? "演示模式（内置模拟 AI）" : "真实模式"}\n`);

const { ts, md, source } = await generateDraft(name, requirement, MOCK);

// ---------------------------------------------------------------------------
// ② 机器初审
// ---------------------------------------------------------------------------

console.log(`${"═".repeat(64)}`);
console.log(`② 机器初审（机器查语法，人查语义）`);
console.log(`${"═".repeat(64)}`);

const { checks, tsc } = machineCheck(name, ts, md);
for (const c of checks) {
  console.log(`  ${c.ok ? "✅" : "⚠️ "} ${c.label}`);
}
if (tsc.unitErrors.length > 0) {
  console.log(tsc.unitErrors.slice(0, 5).map((l) => `     ${l}`).join("\n"));
}

// ---------------------------------------------------------------------------
// ③ 人评审（逐条 y/n，任一 n = 打回；EOF 默认打回）
// ---------------------------------------------------------------------------

console.log(`\n${"═".repeat(64)}`);
console.log(`③ 人评审确认（冻结权在人：逐条 y/n，任一 n = 打回）`);
console.log(`${"═".repeat(64)}`);

const rl = AUTO_YES ? null : createInterface({ input: process.stdin, output: process.stdout });
const lineGen = rl ? rl[Symbol.asyncIterator]() : null;
const rejections = [];

for (let i = 0; i < REVIEW_ITEMS.length; i++) {
  let ok;
  if (AUTO_YES) {
    ok = true;
  } else {
    process.stdout.write(`  [${String(i + 1).padStart(2)}/10] ${REVIEW_ITEMS[i]} (y/n) > `);
    const { value, done } = await lineGen.next();
    ok = !done && value.trim().toLowerCase() === "y";
  }
  console.log(`         ${ok ? "✅ 通过" : "❌ 打回"}`);
  if (!ok) rejections.push(REVIEW_ITEMS[i]);
}
rl?.close();

if (rejections.length > 0) {
  console.log(`\n✗ 评审未通过，打回 ${rejections.length} 项：`);
  rejections.forEach((r, i) => console.log(`   ${i + 1}. ${r}`));
  console.log("\n打回处理选项：");
  console.log("   1. 修改草稿后重新评审（人工编辑 contract.ts / spec.md）");
  console.log("   2. 重新运行本命令让 AI 带着意见重生成（真实模式）");
  console.log("   ✗ 未冻结：该契约不会进入 AI 实现队列。");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// ④ 冻结
// ---------------------------------------------------------------------------

console.log(`\n${"═".repeat(64)}`);
console.log(`④ 评审通过（${REVIEW_ITEMS.length}/${REVIEW_ITEMS.length}）→ 冻结`);
console.log(`${"═".repeat(64)}`);

const reviewer = spawnSync("git", ["config", "user.name"], { cwd: ROOT, encoding: "utf8" }).stdout.trim() || "未知评审人";
const result = freeze(name, {
  generation: MOCK ? "演示模式模拟 AI" : "真实 AI（Agent-A）",
  reviewer,
  approved: String(REVIEW_ITEMS.length),
});
console.log(result.committed ? `✅ ${result.message}` : `⚠️  ${result.message}`);

console.log(`\n下一步（照旧流程）：`);
console.log(`   1. 写判据: ${join(ROOT, "src/groups/auth-service/features", name, "impl.test.ts")}（把不变量逐条翻译成测试）`);
console.log(`   2. 发 ticket: npm run feat -- ticket ${name}`);
console.log(`   3. AI 实现: 只写 impl.ts，跑到判据全绿`);
