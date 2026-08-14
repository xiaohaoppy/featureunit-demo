#!/usr/bin/env node
/**
 * ============================================================================
 * [角色] 核心库：ai-contract-lib —— CLI 与管理界面共用的业务逻辑
 * ----------------------------------------------------------------------------
 * 从 ai-contract.mjs（CLI）中提取的纯函数集合：
 *   - listUnits / readUnitFiles     单元扫描与文件读取
 *   - generateDraft                  AI 生成契约草稿（真实 API 或演示 mock）
 *   - machineCheck                   机器初审（结构/端口引用/tsc）
 *   - freeze                         冻结（冻结记录 + git 提交）
 *   - runUnitTest                    运行单单元判据（vitest）
 *   - buildTicketText                生成 AI ticket 文本
 *
 * 为什么单独成库：CLI（node 直跑）和管理界面（Hono 服务）必须共用
 * 同一套逻辑，避免"命令行和界面行为不一致"。
 * 本文件是纯 JS（零依赖、零类型），配套声明文件 ai-contract-lib.d.mts
 * 供 TypeScript 侧使用。
 * ============================================================================
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "..");
export const GROUPS_DIR = join(ROOT, "src/groups");
export const GROUP = "auth-service";

// ---------------------------------------------------------------------------
// 评审清单：与 docs/contract-review-checklist.md 的 10 条保持一致
// ---------------------------------------------------------------------------

export const REVIEW_ITEMS = [
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

/** 功能单元目录。 */
export function unitDir(name) {
  return join(GROUPS_DIR, GROUP, "features", name);
}

/** kebab-case → PascalCase（delete-account → DeleteAccount）。 */
export function pascal(kebab) {
  return kebab.split("-").map((s) => s[0].toUpperCase() + s.slice(1)).join("");
}

// ---------------------------------------------------------------------------
// 单元扫描与文件读取
// ---------------------------------------------------------------------------

/** 列出全部功能单元（目录含 contract.ts 即算一个单元）。 */
export function listUnits() {
  const dir = join(GROUPS_DIR, GROUP, "features");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "contract.ts")))
    .map((d) => d.name)
    .sort();
}

/** 读取单元的 4 个文件（缺失的文件返回 null）。 */
export function readUnitFiles(name) {
  const dir = unitDir(name);
  const read = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8") : null);
  return {
    contract: read("contract.ts"),
    spec: read("spec.md"),
    impl: read("impl.ts"),
    test: read("impl.test.ts"),
  };
}

// ---------------------------------------------------------------------------
// ① AI 生成契约草稿
// ---------------------------------------------------------------------------

/** 组装给 AI 的 prompt：Agent-A 角色设定 + 六要素模板 + 本次需求。 */
function buildPrompt(name, requirement) {
  const drafter = readFileSync(join(ROOT, "docs/agent-prompts/01-contract-drafter.md"), "utf8").replace(
    "{PASTE_REQUIREMENT_HERE}",
    requirement,
  );
  const template = readFileSync(join(ROOT, "docs/contract-template.md"), "utf8");
  return {
    system: `${drafter}\n\n【六要素模板（必须严格遵循）】\n${template}`,
    user: `请为功能单元「${name}」生成契约。\n需求：${requirement}\n\n只输出两个代码块，不要输出任何其他文字：\n第一个代码块标记为 ts（contract.ts 的完整内容），第二个代码块标记为 md（spec.md 的完整内容）。`,
  };
}

/** 内置模拟 AI：生成一份"典型第一版草稿"——结构齐全但带着真实缺陷，供评审环节抓问题。 */
export function mockDraft(name, requirement) {
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

/** 调用 OpenAI 兼容 API 生成契约（真实模式）。 */
async function callLLM(prompt) {
  const key = process.env.AI_API_KEY ?? process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("未配置 API Key：请设置环境变量 AI_API_KEY（或 DEEPSEEK_API_KEY）。演示模式请用 mock: true");
  }
  const base = process.env.AI_BASE_URL ?? "https://api.deepseek.com";
  const model = process.env.AI_MODEL ?? "deepseek-chat";

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

/**
 * 生成契约草稿并写入单元目录。
 * @param name        功能单元名（需先 feat new）
 * @param requirement 一句话需求
 * @param mock        演示模式（不调 API）
 * @returns {ts, md, source} 草稿内容与来源（mock | live）
 */
export async function generateDraft(name, requirement, mock = true) {
  const dir = unitDir(name);
  if (!existsSync(join(dir, "contract.ts"))) {
    throw new Error(`功能单元不存在: ${GROUP}/features/${name}（请先执行 feat new ${name}）`);
  }

  let ts, md, source;
  if (mock) {
    ({ ts, md } = mockDraft(name, requirement));
    source = "mock";
  } else {
    const text = await callLLM(buildPrompt(name, requirement));
    ({ ts, md } = parseBlocks(text));
    if (!ts || !md) {
      throw new Error(`模型输出无法解析（需要 ts/md 两个代码块）。原始输出片段：\n${text.slice(0, 300)}`);
    }
    source = "live";
  }

  writeFileSync(join(dir, "contract.ts"), ts);
  writeFileSync(join(dir, "spec.md"), md);
  return { ts, md, source };
}

// ---------------------------------------------------------------------------
// ② 机器初审
// ---------------------------------------------------------------------------

/**
 * 机器初审：结构检查 + 端口引用存在性 + tsc 全项目类型检查。
 * @returns {checks: [{label, ok}], tsc: {ok, unitErrors: string[]}}
 */
export function machineCheck(name, ts, md) {
  const checks = [
    { label: "结构：包含 z.object 输入 schema", ok: ts.includes("z.object") },
    { label: "结构：不变量注释 ≥ 3 条", ok: (ts.match(/不变量/g) ?? []).length >= 3 },
    { label: "结构：spec 含错误码与不变量章节", ok: md.includes("## 4. 错误码") && md.includes("## 6. 不变量") },
  ];

  // 端口引用检查：解析草稿里 import 的 ports 相对路径，验证对应文件真实存在
  const portRefs = [...ts.matchAll(/from "((?:\.\.\/)+ports\/[a-z-]+)"/g)].map((m) => m[1]);
  const portsDir = join(GROUPS_DIR, GROUP, "ports");
  checks.push({
    label: `端口引用：${portRefs.length ? portRefs.join(", ") : "(无)"} 均存在`,
    ok: portRefs.every((p) => {
      const segments = p.split("/").filter((s) => s !== "..");
      return existsSync(join(portsDir, segments[segments.length - 1] + ".ts"));
    }),
  });

  // tsc 全项目类型检查（草稿的代码级体检）
  const tsc = spawnSync("npx", ["tsc", "--noEmit"], { cwd: ROOT, encoding: "utf8", timeout: 120_000 });
  const unitErrors = (tsc.stdout + tsc.stderr)
    .split("\n")
    .filter((l) => l.includes(`features/${name}/`));
  checks.push({
    label: `类型：tsc ${tsc.status === 0 ? "全项目通过" : `有 ${(tsc.stdout + tsc.stderr).split("\n").filter(Boolean).length} 处错误（本单元 ${unitErrors.length} 处）`}`,
    ok: tsc.status === 0,
  });

  return { checks, tsc: { ok: tsc.status === 0, unitErrors } };
}

// ---------------------------------------------------------------------------
// ④ 冻结（写入冻结记录 + git 提交）
// ---------------------------------------------------------------------------

/**
 * 评审通过后冻结契约：文件头部写入冻结记录，并 git 提交。
 * @param meta {generation, reviewer, approved, notes}
 * @returns {committed, message}
 */
export function freeze(name, meta = {}) {
  const dir = unitDir(name);
  const contractPath = join(dir, "contract.ts");
  const original = readFileSync(contractPath, "utf8");

  const freezeRecord = `/**
 * 冻结记录（机器生成，勿手改）：
 *   - 生成方式: ${meta.generation ?? "未知"}
 *   - 评审人: ${meta.reviewer ?? "未知评审人"}（人，${new Date().toISOString().slice(0, 10)}）
 *   - 评审结果: ${meta.approved ?? "?"} 项通过
 *   - 冻结后任何修改必须走契约演进流程
 */
`;

  writeFileSync(contractPath, freezeRecord + original);
  spawnSync("git", ["add", "-A"], { cwd: ROOT });
  const commit = spawnSync("git", ["commit", "-q", "-m", `contract: ${name} 冻结（${meta.generation ?? ""} + 人评审 ${meta.approved ?? "?"}/10 通过）`], { cwd: ROOT });
  return {
    committed: commit.status === 0,
    message: commit.status === 0 ? `已冻结并提交: contract: ${name}` : `冻结记录已写入文件，但 git 提交失败：${commit.stderr?.toString().trim() || "无变更可提交"}`,
  };
}

// ---------------------------------------------------------------------------
// 测试运行
// ---------------------------------------------------------------------------

/** 运行单单元判据（vitest 单文件），返回结构化结果。 */
export function runUnitTest(name) {
  const file = join(unitDir(name), "impl.test.ts");
  if (!existsSync(file)) return { ok: false, summary: "无判据文件", output: "" };

  const r = spawnSync("npx", ["vitest", "run", file], { cwd: ROOT, encoding: "utf8", timeout: 120_000 });
  const output = r.stdout + r.stderr;
  // 解析 vitest 汇总行：如 " Tests  7 passed (7)" / " Tests  2 failed | 5 passed (7)"
  const testsLine = output.split("\n").find((l) => /^\s*(Tests|Test Files)\s/.test(l));
  const failed = /failed/.test(testsLine ?? "");
  return {
    ok: r.status === 0 && !failed,
    summary: (testsLine ?? "（无汇总输出）").trim(),
    output: output.slice(-4000), // 只回传尾部，避免超大响应
  };
}

/** 运行全部测试（总闸）。 */
export function runAllTests() {
  const r = spawnSync("npx", ["vitest", "run"], { cwd: ROOT, encoding: "utf8", timeout: 180_000 });
  const output = r.stdout + r.stderr;
  const summaryLines = output
    .split("\n")
    .filter((l) => /^\s*(Test Files|Tests)\s/.test(l))
    .map((l) => l.trim());
  return { ok: r.status === 0, summary: summaryLines.join("；") || "（无汇总输出）", output: output.slice(-4000) };
}

// ---------------------------------------------------------------------------
// Ticket
// ---------------------------------------------------------------------------

/** 生成该单元的 AI ticket 文本（docs/agent-prompts/03 的填充版）。 */
export function buildTicketText(name) {
  const prompt = readFileSync(join(ROOT, "docs/agent-prompts/03-unit-implementer.md"), "utf8");
  return prompt
    .replaceAll("{FEATURE_NAME}", name)
    .replaceAll("{GROUP}", `src/groups/${GROUP}`)
    .replaceAll("{FEATURE_PATH}", unitDir(name));
}

// ---------------------------------------------------------------------------
// 源码浏览（限制在 src/groups 内，防路径穿越）
// ---------------------------------------------------------------------------

const SRC_ROOT = join(GROUPS_DIR, GROUP);

/** 读取服务组内任意源码文件（相对路径），越界返回 null。 */
export function readSourceFile(relPath) {
  const target = resolve(SRC_ROOT, relPath);
  if (!target.startsWith(SRC_ROOT + "/") && target !== SRC_ROOT) return null; // 防路径穿越
  if (!existsSync(target)) return null;
  return readFileSync(target, "utf8");
}

/** 列出可浏览的源码文件清单（端口/适配器/组合根等）。 */
export function listSourceFiles() {
  const out = [];
  const walk = (rel) => {
    const dir = join(SRC_ROOT, rel);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(r);
      else if (entry.name.endsWith(".ts") || entry.name.endsWith(".json") || entry.name.endsWith(".md")) out.push(r);
    }
  };
  walk("");
  return out.sort();
}
