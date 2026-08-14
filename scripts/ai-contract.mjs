#!/usr/bin/env node
/**
 * ============================================================================
 * [角色] AI 功能：ai-contract —— AI 生成契约草稿，人确认后才冻结
 * ----------------------------------------------------------------------------
 * 一句话：把 docs/agent-prompts/01-contract-drafter.md（Agent-A 角色）变成
 *         一条真实命令。流程：
 *
 *   feat new <功能名>          ① 先生成单元目录（脚手架）
 *   feat ai-contract <功能名> "<一句话需求>"
 *                              ② AI 生成 contract.ts + spec.md 草稿
 *                              ③ 机器初审（结构 + 端口引用 + tsc）
 *                              ④ 人逐条过 10 项评审清单（y/n）
 *                              ⑤ 全部 y → 写入冻结记录 + git 提交（冻结）
 *                                 任一 n → 打回，可带意见重新生成（最多 3 轮）
 *
 * 核心原则（人要为 AI 的产品负责）：
 *   - AI 只负责把需求翻译成结构化草稿，【冻结权永远在人】；
 *   - 没有"人确认"这一步，契约就永远只是草稿，不会进入 AI 实现队列。
 *
 * 配置（真实模式）：
 *   AI_API_KEY 或 DEEPSEEK_API_KEY   必填（任意 OpenAI 兼容 API 都行）
 *   AI_BASE_URL  默认 https://api.deepseek.com
 *   AI_MODEL     默认 deepseek-chat
 *
 * 演示模式：
 *   --mock   不调用任何 API，由内置"模拟 AI"生成一份带典型缺陷的草稿
 *            （缺陷刻意保留，用来演示评审清单如何逐条抓问题）
 *   --yes    跳过逐条提问，全部确认（自动化/演示用）
 * ============================================================================
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

const ROOT = resolve(import.meta.dirname, "..");
const GROUPS_DIR = join(ROOT, "src/groups");
const DRAFTER_PROMPT = join(ROOT, "docs/agent-prompts/01-contract-drafter.md");
const TEMPLATE = join(ROOT, "docs/contract-template.md");
const CHECKLIST = join(ROOT, "docs/contract-review-checklist.md");

// ---------------------------------------------------------------------------
// 评审清单：与 docs/contract-review-checklist.md 的 10 条保持一致
// （脚本内置一份，保证交互评审与文档评审不脱节）
// ---------------------------------------------------------------------------

const REVIEW_ITEMS = [
  "安全边界是否覆盖（防枚举/防注入/防重放/防爆破/限流）？",
  "每个失败路径都有错误码？",
  "端口里有没有泄漏实现细节（ORM/HTTP/框架类型）？",
  "不变量 ≥ 3 条，且每条可被测试断言？",
  "有没有【不】负责声明？",
  "输入 schema 够严（该枚举的枚举、该限长的限长）？",
  "有没有写死'怎么实现'而不是'做什么'？",
  "时钟/随机数/ID 是否可注入（测试要能固定时间）？",
  "日志内容是否声明'禁止敏感字段'？",
  "成功结果是否声明'不含敏感字段'？",
];

// ---------------------------------------------------------------------------
// 解析命令行参数
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const name = args[0];
const flags = args.filter((a) => a.startsWith("--"));
const requirement = args.filter((a) => !a.startsWith("--")).slice(1).join(" ");

const MOCK = flags.includes("--mock");
const AUTO_YES = flags.includes("--yes");

if (!name || !/^[a-z0-9-]+$/.test(name)) {
  console.error("用法: npm run feat -- ai-contract <功能名> \"<一句话需求>\" [--mock] [--yes]");
  console.error("       <功能名> 需先用 feat new 生成");
  process.exit(1);
}
if (!requirement) {
  console.error("✗ 缺少需求描述。示例: npm run feat -- ai-contract delete-account \"登录用户可以删除自己的账号\"");
  process.exit(1);
}

// 定位功能单元目录
const group = "auth-service";
const dir = join(GROUPS_DIR, group, "features", name);
if (!existsSync(join(dir, "contract.ts"))) {
  console.error(`✗ 功能单元不存在: ${group}/features/${name}（请先执行 feat new ${name}）`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// ① AI 生成草稿（真实模式调 API；演示模式用内置模拟）
// ---------------------------------------------------------------------------

console.log(`\n${"═".repeat(64)}`);
console.log(`① AI 契约设计（Agent-A）`);
console.log(`${"═".repeat(64)}`);
console.log(`功能: ${name}`);
console.log(`需求: ${requirement}`);
console.log(`模式: ${MOCK ? "演示模式（内置模拟 AI，未调用真实 API）" : "真实模式"}\n`);

/** 组装给 AI 的 prompt：Agent-A 角色设定 + 六要素模板 + 本次需求。 */
function buildPrompt() {
  const drafter = readFileSync(DRAFTER_PROMPT, "utf8").replace("{PASTE_REQUIREMENT_HERE}", requirement);
  const template = readFileSync(TEMPLATE, "utf8");
  return {
    system: `${drafter}\n\n【六要素模板（必须严格遵循）】\n${template}`,
    user: `请为功能单元「${name}」生成契约。\n需求：${requirement}\n\n只输出两个代码块，不要输出任何其他文字：\n第一个代码块标记为 ts（contract.ts 的完整内容），第二个代码块标记为 md（spec.md 的完整内容）。`,
  };
}

/** 内置模拟 AI：生成一份"典型第一版草稿"——结构齐全但带着真实缺陷，供评审环节抓问题。 */
function mockDraft() {
  const ts = `/**
 * [角色] 功能单元：${name} —— 契约（草稿 v0.1，模拟 AI 生成，未冻结）
 */

import { z } from "zod";
import type { UserStore } from "../../ports/user-store";
import type { SessionStore } from "../../ports/session-store";
import type { Logger } from "../../ports/logger";

export const ${pascal(name)}Input = z.object({
  token: z.string().min(1),
  payload: z.any(), // TODO: 具体字段待定
});

export type ${pascal(name)}Input = z.infer<typeof ${pascal(name)}Input>;

export interface ${pascal(name)}Deps {
  users: UserStore;
  sessions: SessionStore;
  logger: Logger;
}

export interface ${pascal(name)} {
  (input: ${pascal(name)}Input, deps: ${pascal(name)}Deps): Promise<void>;
}

/**
 * 不变量：
 * 1. token 有效时执行操作
 */
`;
  const md = `# 契约规格：${name}（v0.1-draft，模拟 AI 生成）

## 1. 一句话目标
${requirement}

## 2. 输入
- token：会话凭证
- payload：业务参数（待定）

## 3. 输出
成功 → void

## 4. 错误码
（待补）

## 5. 端口
- users: UserStore
- sessions: SessionStore
- logger: Logger

## 6. 不变量 / 边界情况
- token 有效时执行
`;
  return { ts, md };
}

/** 调用 OpenAI 兼容 API 生成契约。 */
async function callLLM(prompt) {
  const key = process.env.AI_API_KEY ?? process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      "未配置 API Key：请设置环境变量 AI_API_KEY（或 DEEPSEEK_API_KEY）。\n" +
      "演示模式请加 --mock 参数：npm run feat -- ai-contract <功能名> \"<需求>\" --mock",
    );
  }
  const base = process.env.AI_BASE_URL ?? "https://api.deepseek.com";
  const model = process.env.AI_MODEL ?? "deepseek-chat";

  console.log(`调用 ${base} (model: ${model}) ...`);
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      temperature: 0.2,
      max_tokens: 4000,
    }),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`API 调用失败 (${res.status}): ${detail}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

/** 从模型回复中提取 ts / md 两个代码块。 */
function parseBlocks(text) {
  const ts = /```(?:ts|typescript)\n([\s\S]*?)```/.exec(text)?.[1];
  const md = /```(?:md|markdown)\n([\s\S]*?)```/.exec(text)?.[1];
  return { ts, md };
}

// 生成草稿（失败可带评审意见重试，最多 3 轮）
let draft = null;
let feedback = "";
for (let round = 1; round <= 3 && !draft; round++) {
  if (round > 1) console.log(`\n第 ${round} 轮重新生成（携带上轮评审意见）...`);

  let ts, md;
  if (MOCK) {
    ({ ts, md } = mockDraft());
    if (round > 1) console.log("（演示模式：模拟 AI 内容不变；真实模式下会带着你的意见重新生成）");
  } else {
    const text = await callLLM(buildPrompt());
    ({ ts, md } = parseBlocks(text));
    if (!ts || !md) {
      console.error(`✗ 模型输出无法解析（需要 ts/md 两个代码块）。原始输出片段：\n${text.slice(0, 300)}`);
      if (round === 3) process.exit(1);
      continue;
    }
  }

  // 写入草稿文件（注意：此时只是草稿，尚未冻结）
  writeFileSync(join(dir, "contract.ts"), ts);
  writeFileSync(join(dir, "spec.md"), md);
  draft = { ts, md };
}

// ---------------------------------------------------------------------------
// ② 机器初审：结构检查 + 端口引用检查 + 类型检查
// ---------------------------------------------------------------------------

console.log(`\n${"═".repeat(64)}`);
console.log(`② 机器初审（机器查语法，人查语义）`);
console.log(`${"═".repeat(64)}`);

const machineChecks = [
  { label: "结构：包含 z.object 输入 schema", ok: draft.ts.includes("z.object") },
  { label: "结构：不变量注释 ≥ 3 条", ok: (draft.ts.match(/不变量/g) ?? []).length >= 3 },
  { label: "结构：spec 含错误码与不变量章节", ok: draft.md.includes("## 4. 错误码") && draft.md.includes("## 6. 不变量") },
];

// 端口引用检查：解析草稿里 import 的 ports 相对路径，验证对应文件真实存在
const portRefs = [...draft.ts.matchAll(/from "((?:\.\.\/)+ports\/[a-z-]+)"/g)].map((m) => m[1]);
const portsDir = join(GROUPS_DIR, group, "ports");
machineChecks.push({
  label: `端口引用：${portRefs.length ? portRefs.join(", ") : "(无)"} 均存在`,
  ok: portRefs.every((p) => {
    const segments = p.split("/").filter((s) => s !== "..");
    return existsSync(join(portsDir, segments[segments.length - 1] + ".ts"));
  }),
});

let tscNote = "";
for (const c of machineChecks) {
  console.log(`  ${c.ok ? "✅" : "⚠️ "} ${c.label}`);
}
// tsc 全项目类型检查（草稿的代码级体检）
const tsc = spawnSync("npx", ["tsc", "--noEmit"], { cwd: ROOT, encoding: "utf8" });
const tscErrors = (tsc.stdout + tsc.stderr)
  .split("\n")
  .filter((l) => l.includes(`features/${name}/`));
if (tsc.status === 0) {
  tscNote = "tsc 全项目通过";
  console.log(`  ✅ tsc 全项目通过（含新契约）`);
} else if (tscErrors.length === 0) {
  tscNote = `tsc 有 ${(tsc.stdout + tsc.stderr).split("\n").filter(Boolean).length} 处错误，但都不在本单元（可能是草稿引用了尚未实现的端口）`;
  console.log(`  ⚠️  tsc 有错误，但不在本单元文件内：`);
  console.log(`     （提示：AI 草稿若引用了不存在的端口方法，类型错误会出现在适配器/组合根）`);
  console.log((tsc.stdout + tsc.stderr).split("\n").filter(Boolean).slice(0, 3).map((l) => `     ${l}`).join("\n"));
} else {
  tscNote = `tsc 在本单元发现 ${tscErrors.length} 处错误`;
  console.log(`  ⚠️  tsc 在本单元发现错误（这通常意味着端口/类型不匹配，需要打回或人工修）：`);
  console.log(tscErrors.slice(0, 5).map((l) => `     ${l}`).join("\n"));
}
machineChecks.push({ label: `类型：${tscNote}`, ok: tsc.status === 0 });

// ---------------------------------------------------------------------------
// ③ 人评审：逐条确认（核心环节——冻结权在人）
// ---------------------------------------------------------------------------

console.log(`\n${"═".repeat(64)}`);
console.log(`③ 人评审确认（冻结权在人：逐条 y/n，任一 n = 打回）`);
console.log(`${"═".repeat(64)}`);
console.log(`草稿位置: ${join(dir, "contract.ts")}`);
console.log(`          ${join(dir, "spec.md")}\n`);

const rl = AUTO_YES ? null : createInterface({ input: process.stdin, output: process.stdout });
const rejections = [];

for (let i = 0; i < REVIEW_ITEMS.length; i++) {
  const ok = AUTO_YES || (await rl.question(`  [${String(i + 1).padStart(2)}/10] ${REVIEW_ITEMS[i]} (y/n) > `)).trim().toLowerCase() === "y";
  console.log(`         ${ok ? "✅ 通过" : "❌ 打回"}`);
  if (!ok) rejections.push(REVIEW_ITEMS[i]);
}
rl?.close();

if (rejections.length > 0) {
  console.log(`\n✗ 评审未通过，打回 ${rejections.length} 项：`);
  rejections.forEach((r, i) => console.log(`   ${i + 1}. ${r}`));
  console.log("\n打回处理选项：");
  console.log("   1. 修改草稿后重新评审（人工编辑 contract.ts / spec.md）");
  console.log(`   2. 重新运行本命令让 AI 带着意见重生成（真实模式）`);
  console.log("   ✗ 未冻结：该契约不会进入 AI 实现队列。");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// ④ 冻结：写入冻结记录 + git 提交
// ---------------------------------------------------------------------------

console.log(`\n${"═".repeat(64)}`);
console.log(`④ 评审通过（${REVIEW_ITEMS.length}/${REVIEW_ITEMS.length}）→ 冻结`);
console.log(`${"═".repeat(64)}`);

const reviewer = spawnSync("git", ["config", "user.name"], { cwd: ROOT, encoding: "utf8" }).stdout.trim() || "未知评审人";
const date = new Date().toISOString().slice(0, 10);
const freezeRecord = `/**
 * 冻结记录（机器生成，勿手改）：
 *   - 生成方式: ${MOCK ? "演示模式模拟 AI" : "真实 AI（Agent-A）"}
 *   - 评审人: ${reviewer}（人，${date}）
 *   - 评审结果: ${REVIEW_ITEMS.length}/${REVIEW_ITEMS.length} 项通过
 *   - 机器初审: ${machineChecks.every((c) => c.ok) ? "全部通过" : "有告警（见上）"}
 *   - 冻结后任何修改必须走契约演进流程
 */
`;

// 冻结记录插到契约文件头部
writeFileSync(join(dir, "contract.ts"), freezeRecord + readFileSync(join(dir, "contract.ts"), "utf8"));

// git 提交 = 机器可追溯的冻结（CI 可对冻结后的文件做 hash 锁定）
const git = spawnSync("git", ["add", "-A"], { cwd: ROOT });
const commit = spawnSync("git", ["commit", "-q", "-m", `contract: ${name} 冻结（AI 生成 + 人评审 ${REVIEW_ITEMS.length}/10 通过）`], { cwd: ROOT });
if (commit.status === 0) {
  console.log(`✅ 已冻结并提交: contract: ${name} 冻结（AI 生成 + 人评审 10/10 通过）`);
} else {
  console.log(`⚠️  git 提交失败（${commit.stderr?.toString().trim() || "无变更可提交"}）——冻结记录已写入文件，请手动提交`);
}

console.log(`\n下一步（照旧流程）：`);
console.log(`   1. 写判据: ${join(dir, "impl.test.ts")}（把不变量逐条翻译成测试）`);
console.log(`   2. 发 ticket: npm run feat -- ticket ${name}`);
console.log(`   3. AI 实现: 只写 impl.ts，跑到判据全绿`);

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/** kebab-case → PascalCase（delete-account → DeleteAccount）。 */
function pascal(kebab) {
  return kebab.split("-").map((s) => s[0].toUpperCase() + s.slice(1)).join("");
}
