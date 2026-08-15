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
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, mkdtempSync, rmSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

export const ROOT = resolve(import.meta.dirname, "..");
export const GROUPS_DIR = join(ROOT, "src/groups");
export const GROUP = "auth-service";

// ---------------------------------------------------------------------------
// 本地配置（管理台写入；密钥不进 git）
// ---------------------------------------------------------------------------

/** 本地配置文件路径（.gitignore 已忽略，密钥只存在本机）。 */
export const LOCAL_CONFIG_PATH = join(ROOT, ".featureunit.local.json");

/** 读取本地配置（文件不存在/损坏 → {}）。 */
export function readLocalConfig() {
  try {
    if (!existsSync(LOCAL_CONFIG_PATH)) return {};
    return JSON.parse(readFileSync(LOCAL_CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

/**
 * 写入本地配置：只更新传入的 key；值为空字符串 = 删除该 key。
 * 不传 key 的已有配置会被保留（只改用户点的那几项）。
 */
export function writeLocalConfig(values) {
  const cfg = readLocalConfig();
  for (const [key, value] of Object.entries(values)) {
    if (value === "" || value === null || value === undefined) delete cfg[key];
    else cfg[key] = value;
  }
  writeFileSync(LOCAL_CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n");
  return cfg;
}

/**
 * 配置取值优先级：本地配置文件 → 环境变量 → 默认值。
 * 这样"写死的配置"（管理台保存）和"临时覆盖"（CI/服务器环境变量）两不误。
 */
export function resolveConfigValue(key, fallback = "") {
  const local = readLocalConfig();
  const v = local[key] ?? process.env[key];
  return v === undefined || v === null || v === "" ? fallback : String(v);
}

/** 管理台配置面板的 key 清单与默认值（与 config.ts 的 EnvSchema 保持一致）。 */
export const CONFIG_KEYS = [
  { key: "AI_API_KEY", label: "AI 密钥（OpenAI 兼容 API）", secret: true, fallback: "" },
  { key: "AI_BASE_URL", label: "AI 接口地址", secret: false, fallback: "https://api.deepseek.com" },
  { key: "AI_MODEL", label: "AI 模型名（保存时自动从 API 获取列表）", secret: false, fallback: "deepseek-v4-flash", options: ["deepseek-v4-flash", "deepseek-v4-pro"] },
  { key: "AI_REASONING", label: "推理等级（low=快/省 high=深度推理）", secret: false, fallback: "medium", options: ["low", "medium", "high"] },
  { key: "PORT", label: "业务服务端口", secret: false, fallback: "3000" },
  { key: "USER_STORE", label: "存储模式", secret: false, fallback: "memory", options: ["memory", "file", "sqlite"] },
  { key: "SQLITE_PATH", label: "SQLite 数据库文件（相对项目根）", secret: false, fallback: "./data/auth-service.db" },
  { key: "DATA_DIR", label: "JSON 文件存储目录（file 模式）", secret: false, fallback: "./data" },
  { key: "SESSION_TTL_DAYS", label: "会话有效期（天）", secret: false, fallback: "30" },
  { key: "RESET_TOKEN_TTL_MINUTES", label: "重置 token 有效期（分钟）", secret: false, fallback: "30" },
  { key: "RATE_LIMIT_MAX", label: "找回密码限流（次/窗口）", secret: false, fallback: "3" },
  { key: "RATE_LIMIT_WINDOW_MS", label: "限流窗口（毫秒）", secret: false, fallback: "600000" },
];

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

/** 功能单元目录（支持任意服务组）。 */
export function unitDir(name, group = GROUP) {
  return join(GROUPS_DIR, group, "features", name);
}

/** kebab-case → PascalCase（delete-account → DeleteAccount）。 */
export function pascal(kebab) {
  return kebab.split("-").map((s) => s[0].toUpperCase() + s.slice(1)).join("");
}

/** kebab-case → camelCase（delete-account → deleteAccount）。 */
export function camel(kebab) {
  const p = pascal(kebab);
  return p[0].toLowerCase() + p.slice(1);
}

// ---------------------------------------------------------------------------
// 新建功能单元（模板与 feat.mjs CLI 共用——单一事实来源）
// ---------------------------------------------------------------------------

/** 新单元 4 文件模板（与 CLI feat new 生成的内容完全一致）。 */
function unitTemplates(name) {
  const P = pascal(name);
  return {
    "contract.ts": `/**
 * [角色] 功能单元：${name} —— 契约（冻结区）
 * 谁可以改：只有人（契约演进流程）。AI 实现任务中【禁止】修改本文件。
 * 填写指南：docs/contract-template.md（六要素）
 */

import { z } from "zod";

// TODO(人/契约设计师)：定义输入 schema（含边界规则，见模板第 2 节）
export const ${P}Input = z.object({
  // example: email: z.string().email(),
});

export type ${P}Input = z.infer<typeof ${P}Input>;

// TODO：声明依赖端口（只允许纯数据 + 接口，禁止 ORM/HTTP/框架类型）
export interface ${P}Deps {
  // example: users: UserStore;
}

export interface ${P}Result {
  // example: ok: true;
}

export interface ${P} {
  (input: ${P}Input, deps: ${P}Deps): Promise<${P}Result>;
}

/**
 * 不变量（≥3 条，条条可被测试断言；impl.test.ts 会逐条验证）：
 * 1. TODO
 * 2. TODO
 * 3. TODO
 */
`,
    "spec.md": `# 契约规格：${name}（v0.1-draft）

<!-- 按 docs/contract-template.md 六要素填写 -->

## 1. 一句话目标
TODO

## 2. 输入
TODO

## 3. 输出
TODO

## 4. 错误码
TODO

## 5. 端口
TODO

## 6. 不变量 / 边界情况
- TODO（≥3 条，条条可测）
- 【不】负责：TODO
`,
    "impl.ts": `/**
 * [角色] 功能单元：${name} —— 实现（AI 写入区）
 * 本文件是单元内【唯一】允许 AI 修改的文件。
 * 当前为桩实现：判据是红的，交给 AI（或人）按契约填成真的。
 */

import type { ${P} } from "./contract";

export const ${camel(name)}: ${P} = async (_input, _deps) => {
  throw new Error("NOT_IMPLEMENTED: 按 contract.ts 的不变量实现本单元");
};
`,
    "impl.test.ts": `/**
 * [角色] 功能单元：${name} —— 判据（冻结区）
 * AI 的"完成标准"：AI 不得修改本文件（改了判据 = 作弊）。
 * TODO(人/契约评审)：契约冻结后，把不变量逐条翻译成测试。
 * 全部使用内存适配器（src/groups/<组>/adapters/memory/**），不依赖基础设施。
 */

import { describe, expect, it } from "vitest";
import { ${camel(name)} } from "./impl";

describe("${name} 单元判据", () => {
  it("TODO: 不变量 1", async () => {
    // TODO: 组装内存适配器 → 调用 ${camel(name)} → 断言结果/错误码
    expect(true).toBe(true);
  });
});
`,
  };
}

/**
 * 创建新功能单元（4 文件模板）。
 * @param name kebab-case 功能名（如 verify-2fa）
 */
export function createUnit(name, group = GROUP) {
  if (!/^[a-z0-9-]+$/.test(name)) {
    throw new Error("功能名只允许小写字母、数字、连字符（kebab-case）");
  }
  const dir = unitDir(name, group);
  if (existsSync(join(dir, "contract.ts"))) {
    throw new Error(`功能单元已存在: ${group}/features/${name}`);
  }
  mkdirSync(dir, { recursive: true });
  for (const [file, content] of Object.entries(unitTemplates(name))) {
    writeFileSync(join(dir, file), content);
  }
  return { name, dir };
}

// ---------------------------------------------------------------------------
// 文件编辑（管理台：人编辑 + git 留痕）
// ---------------------------------------------------------------------------

const UNIT_FILES = { contract: "contract.ts", spec: "spec.md", impl: "impl.ts", test: "impl.test.ts" };

/**
 * 保存单元文件（管理台编辑用）。人编辑冻结区文件是允许的，
 * 但每次保存必须 git 提交留痕（"谁在什么时候改了什么"可追溯）。
 * @returns {saved, committed, message}
 */
export function saveUnitFile(name, file, content, note = "", group = GROUP) {
  const target = UNIT_FILES[file];
  if (!target) throw new Error(`不允许编辑的文件: ${file}`);
  const path = join(unitDir(name, group), target);
  if (!existsSync(path)) throw new Error(`文件不存在: ${target}`);

  writeFileSync(path, content);
  spawnSync("git", ["add", "-A"], { cwd: ROOT });
  const commit = spawnSync("git", ["commit", "-q", "-m", `admin: 编辑 ${name}/${target} — ${note || "（无备注）"}`], { cwd: ROOT });
  return {
    saved: true,
    committed: commit.status === 0,
    message: commit.status === 0
      ? `已保存并提交: ${name}/${target}`
      : `已保存到磁盘，但 git 提交失败（${commit.stderr?.toString().trim() || "内容无变化"}）`,
  };
}

// ---------------------------------------------------------------------------
// 判据生成（Agent-B）与内置实现器（Agent-C 自动迭代）
// ---------------------------------------------------------------------------

/** 判据是否为"占位"（未真正写测试）：去掉注释后，仍含 expect(true) 或 TODO。 */
export function isJudgePlaceholder(test) {
  if (!test) return true;
  // 去注释再判断——注释里出现"expect(true)"字样不应触发占位判定
  const code = test.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  return code.includes("expect(true)") || code.includes("TODO");
}

/** 实现是否还是桩（NOT_IMPLEMENTED）。 */
export function isImplStub(impl) {
  return !impl || impl.includes("NOT_IMPLEMENTED");
}

/** 从契约文本里提取不变量条目（"N. 文本" 形式，供 mock 判据生成用）。 */
function extractInvariants(contract) {
  const m = /不变量[^]*?\n\s*\*\/[^]*?\*\/|不变量[\s\S]*?\*\//.exec(contract ?? "");
  const block = m?.[0] ?? "";
  const items = [...block.matchAll(/\*\s*(\d+)\.\s*([^\n*]+)/g)].map((x) => x[2].trim());
  return items.length ? items : ["（契约未写明不变量，请先评审契约）"];
}

/**
 * 生成判据草稿（Agent-B）并写入 impl.test.ts。
 * - 真实模式：调 API，按 04-judge-drafter.md 生成完整判据；
 * - mock 模式：生成"不变量驱动的测试骨架"——每条不变量一个 it，body 显式
 *   抛 TODO（必红，杜绝 expect(true) 假绿），供人逐条补全断言。
 */
export async function generateJudgeTest(name, mock = true, group = GROUP) {
  const files = readUnitFiles(name, group);
  if (!files.contract) throw new Error(`功能单元不存在: ${group}/features/${name}`);

  // 纪律守卫：已冻结的判据不允许被 AI 生成重写（改了判据 = 作弊）。
  // 需要重写必须走契约演进流程（git 历史可追溯）。
  if ((files.test ?? "").includes("冻结记录")) {
    throw new Error("判据已冻结——不允许被 AI 生成覆盖。如需修改请走契约演进流程（人工编辑 + git 留痕）");
  }
  const contract = files.contract;

  let test;
  if (mock) {
    const items = extractInvariants(contract);
    const c = camel(name);
    test = `/**
 * [角色] 功能单元：${name} —— 判据（草稿，模拟 AI 生成，未冻结）
 * 每条不变量一个 it；body 为显式 TODO（必红），请逐条补全断言。
 * 判据作者（Agent-B）纪律：禁止占位断言、禁止改契约/实现。
 */

import { describe, it, expect } from "vitest";
import { ${c} } from "./impl";

describe("${name} 单元判据", () => {
${items.map((inv, i) => `  it("不变量${i + 1}｜${inv}", async () => {
    // TODO: 组装内存适配器 → 调用 ${c} → 断言「${inv}」
    throw new Error("TODO: 断言不变量${i + 1}（${inv}）");
  });`).join("\n\n")}
});
`;
  } else {
    const promptText = readFileSync(join(ROOT, "docs/agent-prompts/04-judge-drafter.md"), "utf8");
    const system = promptText.replace("{CONTRACT_CONTENT}", contract);
    const raw = await callLLM({
      system,
      user: `单元名：${name}（服务组 ${group}）\n只输出一个 ts 代码块：impl.test.ts 的完整内容。`,
    });
    const m = /```(?:ts|typescript)\n([\s\S]*?)```/.exec(raw);
    if (!m) throw new Error(`模型输出无法解析（需要单个 ts 代码块）。原始输出片段：\n${raw.slice(0, 300)}`);
    test = m[1];
  }

  writeFileSync(join(unitDir(name, group), "impl.test.ts"), test);
  return { name, test, invariants: extractInvariants(contract) };
}

/**
 * 冻结判据：人确认后，在 impl.test.ts 头部写冻结记录 + git 提交。
 * 判据冻结后，实现者（Agent-C）才被允许对照它写 impl.ts。
 * 纪律：占位判据（含 TODO/expect(true)）不允许冻结——考卷没写完不许开考。
 */
export function freezeJudge(name, reviewer = "管理台操作员", group = GROUP) {
  const path = join(unitDir(name, group), "impl.test.ts");
  if (!existsSync(path)) throw new Error(`判据文件不存在: ${name}/impl.test.ts`);
  if (isJudgePlaceholder(readFileSync(path, "utf8"))) {
    throw new Error("判据仍是占位（含 TODO / expect(true)）——请先逐条补全真实断言，再冻结");
  }
  const record = `/**
 * 冻结记录（判据）：${new Date().toISOString().slice(0, 10)} 由 ${reviewer} 确认后冻结。
 * 冻结后任何修改必须走契约演进流程（改了判据 = 作弊，git 历史可追溯）。
 */
`;
  writeFileSync(path, record + readFileSync(path, "utf8"));
  spawnSync("git", ["add", "-A"], { cwd: ROOT });
  const commit = spawnSync("git", ["commit", "-q", "-m", `judge: ${name} 判据冻结（人确认）`], { cwd: ROOT });
  return { committed: commit.status === 0, message: commit.status === 0 ? `已冻结并提交: ${name}/impl.test.ts` : "判据已写盘，git 提交失败" };
}

/**
 * 内置实现器（Agent-C 自动迭代）：
 * 读契约 + 判据 → 生成 impl.ts → 跑判据 → 红了带失败信息重试（≤ maxRounds）→
 * 全绿才 git 提交；超限则停止并报告（失败安全：干不了就求援，绝不假装成功）。
 *
 * - 真实模式：调 API（03-unit-implementer 纪律），判据失败输出作为下一轮反馈；
 * - mock 模式：演示"迭代与失败安全"路径——每轮写一个带轮次的桩，必然红灯，
 *   演示读失败信息、重试、最终停手报告。
 */
export async function implementUnit(name, { mock = true, maxRounds = 5 } = {}, group = GROUP) {
  const files = readUnitFiles(name, group);
  if (!files.contract) throw new Error(`功能单元不存在: ${group}/features/${name}`);
  if (isJudgePlaceholder(files.test)) {
    throw new Error("判据尚未就绪（还是占位测试）——先写判据并确认，再让 AI 实现");
  }

  const rounds = [];
  for (let round = 1; round <= maxRounds; round++) {
    // ① 生成实现
    if (mock) {
      // mock 实现器：每轮写一个"看起来在努力"但故意不满足判据的桩，
      // 用于演示"红灯 → 读失败 → 重试"循环与最终停手。
      const impl = `/**
 * [角色] 功能单元：${name} —— 实现（内置实现器 mock，第 ${round}/${maxRounds} 轮尝试）
 * 演示失败安全：此实现未满足判据，判据会红。
 */
import { AppError, ErrorCodes } from "../../ports/errors";
import type { ${pascal(name)} } from "./contract";

export const ${camel(name)}: ${pascal(name)} = async (_input, _deps) => {
  throw new AppError(ErrorCodes.INVALID_INPUT, 400); // 第 ${round} 轮：故意不满足不变量
};
`;
      writeFileSync(join(unitDir(name, group), "impl.ts"), impl);
    } else {
      const promptText = readFileSync(join(ROOT, "docs/agent-prompts/03-unit-implementer.md"), "utf8");
      const feedback = rounds.length
        ? `\n\n【上一轮判据失败信息，请修正】\n${rounds[rounds.length - 1].summary}\n${rounds[rounds.length - 1].tail}`
        : "";
      const system = promptText
        .replaceAll("{FEATURE_NAME}", name)
        .replaceAll("{GROUP}", `src/groups/${GROUP}`)
        + feedback;
      const raw = await callLLM({ system, user: `只输出一个 ts 代码块：impl.ts 的完整内容。` });
      const m = /```(?:ts|typescript)\n([\s\S]*?)```/.exec(raw);
      if (!m) throw new Error(`模型输出无法解析：\n${raw.slice(0, 300)}`);
      writeFileSync(join(unitDir(name, group), "impl.ts"), m[1]);
    }

    // ② 跑判据
    const result = runUnitTest(name);
    const summary = result.summary;
    const tail = result.output.slice(-1500);
    rounds.push({ round, ok: result.ok, summary, tail });

    if (result.ok) {
      // ③ 全绿 → 提交
      spawnSync("git", ["add", "-A"], { cwd: ROOT });
      spawnSync("git", ["commit", "-q", "-m", `feat(${name}): implement（内置实现器，${round}/${maxRounds} 轮判据全绿）`], { cwd: ROOT });
      return { ok: true, rounds, message: `判据全绿（第 ${round} 轮），已提交实现` };
    }
  }

  return {
    ok: false,
    rounds,
    message: `达到最大迭代 ${maxRounds} 轮仍未通过判据——停手，需人工介入（这是失败安全，不是假装成功）`,
  };
}

/**
 * 单元状态聚合（供开发向导）：契约冻结 / 判据就绪 / 实现完成 / 接线 / 上线。
 */
export function unitStatus(name, group = GROUP) {
  const files = readUnitFiles(name, group);
  if (!files.contract) return null;
  const frozen = (files.contract ?? "").includes("冻结记录");
  const judgePlaceholder = isJudgePlaceholder(files.test);
  const judgeFrozen = (files.test ?? "").includes("冻结记录");
  const implStub = isImplStub(files.impl);
  const wiring = checkWiring(name, group);
  const test = runUnitTest(name, group);

  const steps = [
    { id: "contract", label: "① 契约冻结", done: frozen, hint: frozen ? "已冻结" : "契约尚未冻结（走 AI 生成 + 人评审）" },
    { id: "judge", label: "② 判据就绪", done: judgeFrozen && !judgePlaceholder, hint: judgeFrozen ? "判据已冻结" : judgePlaceholder ? "判据还是占位（需 AI 生成 + 人确认）" : "判据已写但未冻结" },
    { id: "impl", label: "③ 实现完成", done: !implStub && test.ok, hint: implStub ? "实现还是桩（需 AI 实现）" : test.ok ? "实现完成且判据绿" : "实现已写但判据红" },
    { id: "wiring", label: "④ 接线完成", done: wiring.allOk, hint: wiring.allOk ? "已接线" : `接线缺口 ${wiring.checks.filter((x) => !x.ok).length} 项` },
    { id: "ship", label: "⑤ 上线就绪", done: false, hint: "跑总闸确认（tsc + 全部测试）" },
  ];

  return {
    name,
    frozen,
    judgePlaceholder,
    judgeFrozen,
    implStub,
    wired: wiring.allOk,
    testsGreen: test.ok,
    testSummary: test.summary,
    steps,
    stepsDone: steps.filter((s) => s.done).length,
    stepsTotal: steps.length,
  };
}

// ---------------------------------------------------------------------------
// 一键接线（组合根/HTTP/manifest 的改动由机器生成，人审 diff 后才落盘）
// ---------------------------------------------------------------------------

/** 在 content 中 anchor 行之后插入 toInsert；找不到 anchor 返回 null。 */
function insertAfter(content, anchor, toInsert) {
  const idx = content.indexOf(anchor);
  if (idx === -1) return null;
  const end = idx + anchor.length;
  return content.slice(0, end) + "\n" + toInsert + content.slice(end);
}

/** 从契约文本提取 Deps 接口的字段名（AuthDeps 字段命名一致，可直接映射）。 */
function extractDepsFields(contract) {
  const m = /interface \w+Deps \{([\s\S]*?)\n\}/.exec(contract ?? "");
  if (!m) return [];
  return [...m[1].matchAll(/^\s*(\w+):/gm)].map((x) => x[1]);
}

/** 从契约文本提取输入 schema 字段名（用于判断是否走 cookie + body 字段）。 */
function extractInputFields(contract) {
  const m = /z\.object\(\{([\s\S]*?)\n\}\)/.exec(contract ?? "");
  if (!m) return [];
  return [...m[1].matchAll(/^\s*(\w+):/gm)].map((x) => x[1]);
}

/** 用 git 生成 unified diff（精确到 hunk，支持多点插入）。 */
function simpleDiff(before, after) {
  if (before === after) return "";
  const dir = mkdtempSync(join(tmpdir(), "feat-diff-"));
  const a = join(dir, "a");
  const b = join(dir, "b");
  writeFileSync(a, before);
  writeFileSync(b, after);
  const r = spawnSync("git", ["diff", "--no-index", "--no-color", "--", a, b], { encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  // 去掉 git diff 的文件头（diff --git / index / --- / +++），只留 hunk
  return (r.stdout ?? "")
    .replace(/^diff --git.*$/gm, "")
    .replace(/^index .*$/gm, "")
    .replace(/^--- .*$/gm, "")
    .replace(/^\+\+\+ .*$/gm, "")
    .trim();
}

/**
 * 生成接线 diff（不落盘）：读契约推断依赖与输入，生成三处改动（index.ts /
 * http.ts / manifest.json）的 before/after + 行级 diff，供人审阅。
 * @returns { alreadyWired, files: [{path, before, after, diffText}] }
 */
export function generateWiring(name, group = GROUP) {
  const wiring = checkWiring(name, group);
  if (wiring.allOk) return { alreadyWired: true, files: [] };

  const files = readUnitFiles(name, group);
  if (!files.contract) throw new Error(`功能单元不存在: ${group}/features/${name}`);

  const P = pascal(name);
  const c = camel(name);
  const depsFields = extractDepsFields(files.contract);
  const inputFields = extractInputFields(files.contract);
  const hasToken = inputFields.includes("token");

  const results = [];

  // ── ① index.ts（组合根）────────────────────────────────────────────
  const index = readSourceFile("index.ts");
  if (index && !wiring.checks[0].ok) {
    let next = index;
    next = insertAfter(next, `import { resetPassword } from "./features/reset-password/impl";`,
      `import { ${c} } from "./features/${name}/impl";`);
    next = insertAfter(next, `import type { ResetPasswordDeps } from "./features/reset-password/contract";`,
      `import type { ${P}Deps } from "./features/${name}/contract";`);
    next = insertAfter(next, `import { ResetPasswordInput } from "./features/reset-password/contract";`,
      `import { ${P}Input } from "./features/${name}/contract";`);
    next = insertAfter(next, `  resetPassword(input: unknown): Promise<void>;`,
      `  ${c}(input: unknown): Promise<void>;`);
    next = insertAfter(next, `    resetPassword: (input) => resetPassword(parseOrThrow(ResetPasswordInput, input), toResetPasswordDeps(deps)),`,
      `    ${c}: (input) => ${c}(parseOrThrow(${P}Input, input), to${P}Deps(deps)),`);
    const depArgs = depsFields.length ? depsFields.map((f) => `${f}: d.${f}`).join(", ") : "logger: d.logger";
    next = insertAfter(next, `function toResetPasswordDeps(d: AuthDeps): ResetPasswordDeps {\n  return { resetTokens: d.resetTokens, users: d.users, sessions: d.sessions, hasher: d.hasher, logger: d.logger, now: d.now };\n}`,
      `function to${P}Deps(d: AuthDeps): ${P}Deps {\n  return { ${depArgs} };\n}`);
    if (next && next !== index) {
      results.push({ path: "index.ts", before: index, after: next, diffText: simpleDiff(index, next) });
    }
  }

  // ── ② http.ts（路由）──────────────────────────────────────────────
  const http = readSourceFile("adapters/http.ts");
  if (http && !wiring.checks[4].ok) {
    const cookieLine = hasToken
      ? `    const token = getCookie(c, SESSION_COOKIE);\n    if (!token) throw new AppError(ErrorCodes.INVALID_SESSION, 401);\n`
      : "";
    const callLine = hasToken
      ? `    await api.${c}({ token, ...body });`
      : `    await api.${c}(body);`;
    const route = `  // ── ${name} ────────────────────────────────────────────────
  app.post("/api/${name}", async (c) => {
${cookieLine}    const body = (await readJson(c)) as Record<string, unknown>;
${callLine}
    return c.json({ ok: true });
  });`;
    const anchor = `  app.post("/api/password-reset", async (c) => {
    await api.resetPassword(await readJson(c));
    deleteCookie(c, SESSION_COOKIE); // 密码已重置，旧会话 cookie 一并清掉
    return c.json({ ok: true });
  });`;
    const next = insertAfter(http, anchor, route);
    if (next && next !== http) {
      results.push({ path: "adapters/http.ts", before: http, after: next, diffText: simpleDiff(http, next) });
    }
  }

  // ── ③ manifest.json（版本登记）─────────────────────────────────────
  const manifest = readSourceFile("manifest.json");
  if (manifest && !wiring.checks[5].ok) {
    const anchor = `    "reset-password": "1.0.0"`;
    const next = insertAfter(manifest, anchor, `    "${name}": "1.0.0"`);
    if (next && next !== manifest) {
      results.push({ path: "manifest.json", before: manifest, after: next, diffText: simpleDiff(manifest, next) });
    }
  }

  return { alreadyWired: false, files: results };
}

/**
 * 应用接线：把 generateWiring 生成的 after 写盘 + git 提交。
 * 人看完 diff 点"确认"才调用——落盘权在人。
 */
export function applyWiring(name, note = "", group = GROUP) {
  const { alreadyWired, files } = generateWiring(name, group);
  if (alreadyWired) return { ok: true, message: "该单元已接线，无需改动", applied: 0 };
  if (!files.length) return { ok: false, message: "未能生成接线改动（锚点缺失或已接线），请人工检查", applied: 0 };

  for (const f of files) {
    // f.path 相对服务组目录（如 "index.ts" / "adapters/http.ts" / "manifest.json"）
    const full = join(GROUPS_DIR, group, f.path);
    writeFileSync(full, f.after);
  }
  spawnSync("git", ["add", "-A"], { cwd: ROOT });
  const commit = spawnSync("git", ["commit", "-q", "-m", `wire(${name}): 一键接线（人确认）${note ? " — " + note : ""}`], { cwd: ROOT });
  return {
    ok: commit.status === 0,
    applied: files.length,
    message: commit.status === 0
      ? `已接线 ${files.length} 个文件并提交（${files.map((f) => f.path).join(", ")}）`
      : `文件已写盘（${files.map((f) => f.path).join(", ")}），git 提交失败`,
  };
}

/**
 * 检查新单元是否已"接线"进服务：组合根 import / AuthApi / createAuthApp /
 * HTTP 路由 / manifest 版本。机器检查、人动手——组合根仍由人编辑。
 */
export function checkWiring(name, group = GROUP) {
  const c = camel(name);
  const index = readSourceFile("index.ts", group) ?? "";
  const http = readSourceFile("adapters/http.ts", group) ?? "";
  const manifest = readSourceFile("manifest.json", group) ?? "";

  const checks = [
    { label: `index.ts 已 import 实现 (features/${name}/impl)`, ok: index.includes(`features/${name}/impl`) },
    { label: `index.ts 已 import 契约 (features/${name}/contract)`, ok: index.includes(`features/${name}/contract`) },
    { label: "AuthApi 已声明操作方法", ok: index.includes(`${c}(input: unknown)`) || index.includes(`${c}: (`) },
    { label: "createAuthApp 已接线（parseOrThrow + 注入）", ok: index.includes(`${c}: (input) => ${c}(`) },
    { label: "HTTP 路由已添加（adapters/http.ts）", ok: http.includes(`/api/${name}`) },
    { label: "manifest.json 已登记版本", ok: manifest.includes(`"${name}"`) },
  ];
  return { name, checks, allOk: checks.every((x) => x.ok) };
}

// ---------------------------------------------------------------------------
// 单元扫描与文件读取
// ---------------------------------------------------------------------------

/** 列出全部服务组（src/groups/ 下有 features 目录的组）。 */
export function listGroups() {
  return readdirSync(GROUPS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(GROUPS_DIR, d.name, "features")))
    .map((d) => d.name)
    .sort();
}

/** 列出某组的全部功能单元（目录含 contract.ts 即算一个单元）。 */
export function listUnits(group = GROUP) {
  const dir = join(GROUPS_DIR, group, "features");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "contract.ts")))
    .map((d) => d.name)
    .sort();
}

/** 读取单元的 4 个文件（缺失的文件返回 null）。 */
export function readUnitFiles(name, group = GROUP) {
  const dir = unitDir(name, group);
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
export function mockDraft(name, requirement, group = GROUP) {
  // 只引用目标组里真实存在的端口（新组只有 errors/logger，避免硬编码 auth 端口）
  const portsDir = join(GROUPS_DIR, group, "ports");
  const has = (f) => existsSync(join(portsDir, f));
  const imports = [];
  const depFields = [];
  if (has("user-store.ts")) { imports.push('import type { UserStore } from "../../ports/user-store";'); depFields.push("  users: UserStore;"); }
  if (has("session-store.ts")) { imports.push('import type { SessionStore } from "../../ports/session-store";'); depFields.push("  sessions: SessionStore;"); }
  if (has("email-sender.ts")) { imports.push('import type { EmailSender } from "../../ports/email-sender";'); depFields.push("  mail: EmailSender;"); }
  imports.push('import type { Logger } from "../../ports/logger";');
  depFields.push("  logger: Logger;");

  const ts = `/**
 * [角色] 功能单元：${name} —— 契约（草稿 v0.1，模拟 AI 生成，未冻结）
 */

import { z } from "zod";
${imports.join("\n")}

export const ${pascal(name)}Input = z.object({
  token: z.string().min(1),
  payload: z.any(), // TODO: 具体字段待定
});

export type ${pascal(name)}Input = z.infer<typeof ${pascal(name)}Input>;

export interface ${pascal(name)}Deps {
${depFields.join("\n")}
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
  // 优先级：本地配置（管理台写入）→ 环境变量 → 默认值
  const key = resolveConfigValue("AI_API_KEY");
  if (!key) {
    throw new Error("未配置 API Key：请在管理台「配置」面板填写 AI_API_KEY，或设置环境变量。演示模式请用 mock: true");
  }
  const base = resolveConfigValue("AI_BASE_URL", "https://api.deepseek.com");
  const model = resolveConfigValue("AI_MODEL", "deepseek-v4-flash");

  // 推理等级 → 采样参数（所有 OpenAI 兼容 API 都认 temperature；
  // high 时附 reasoning_effort，V4 系列模型可据此进入深度推理模式）
  const reasoning = resolveConfigValue("AI_REASONING", "medium");
  const TEMPERATURE = { low: 0.7, medium: 0.3, high: 0.1 };
  const body = {
    model,
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
    temperature: TEMPERATURE[reasoning] ?? 0.3,
    max_tokens: 4000,
  };
  if (reasoning === "high") body.reasoning_effort = "high"; // 深度推理模式

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`API 调用失败 (${res.status}): ${detail}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

/**
 * 自动获取可用模型列表（OpenAI 兼容 GET /models）。
 * 管理台配置面板用它填充 AI_MODEL 下拉——不用手填模型名。
 * 需要已配置 AI_API_KEY；失败抛错（调用方做兜底）。
 */
export async function fetchModels() {
  const key = resolveConfigValue("AI_API_KEY");
  if (!key) throw new Error("未配置 AI_API_KEY，无法获取模型列表");
  const base = resolveConfigValue("AI_BASE_URL", "https://api.deepseek.com");
  const res = await fetch(`${base}/models`, { headers: { authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`模型列表获取失败 (${res.status})`);
  const data = await res.json();
  return (data.data ?? []).map((m) => m.id).sort();
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
export async function generateDraft(name, requirement, mock = true, group = GROUP) {
  const dir = unitDir(name, group);
  if (!existsSync(join(dir, "contract.ts"))) {
    throw new Error(`功能单元不存在: ${group}/features/${name}（请先执行 feat new ${name}）`);
  }
  // 纪律守卫：已冻结的契约不允许被 AI 生成重写（与判据/端口守卫一致）
  if (readFileSync(join(dir, "contract.ts"), "utf8").includes("冻结记录")) {
    throw new Error(`契约已冻结（${group}/features/${name}）——不允许被 AI 生成覆盖，请走契约演进流程`);
  }

  let ts, md, source;
  if (mock) {
    ({ ts, md } = mockDraft(name, requirement, group));
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
export function machineCheck(name, ts, md, group = GROUP) {
  // 统计契约注释里的编号不变量条目（"1. " 形式）——真实 AI 按编号写，mock 只有 1 条
  const invariantCount = [...(ts ?? "").matchAll(/^\s*\*\s*\d+\.\s/gm)].length;
  const checks = [
    { label: "结构：包含 z.object 输入 schema", ok: ts.includes("z.object") },
    { label: `结构：不变量注释 ≥ 3 条（实际 ${invariantCount} 条）`, ok: invariantCount >= 3 },
    { label: "结构：spec 含错误码与不变量章节", ok: md.includes("## 4. 错误码") && md.includes("## 6. 不变量") },
  ];

  // 端口引用检查：解析草稿里 import 的 ports 相对路径，验证对应文件真实存在
  const portRefs = [...ts.matchAll(/from "((?:\.\.\/)+ports\/[a-z-]+)"/g)].map((m) => m[1]);
  const portsDir = join(GROUPS_DIR, group, "ports");
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
export function freeze(name, meta = {}, group = GROUP) {
  const dir = unitDir(name, group);
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
export function runUnitTest(name, group = GROUP) {
  const file = join(unitDir(name, group), "impl.test.ts");
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
export function buildTicketText(name, group = GROUP) {
  const prompt = readFileSync(join(ROOT, "docs/agent-prompts/03-unit-implementer.md"), "utf8");
  return prompt
    .replaceAll("{FEATURE_NAME}", name)
    .replaceAll("{GROUP}", `src/groups/${group}`)
    .replaceAll("{FEATURE_PATH}", unitDir(name, group));
}

// ---------------------------------------------------------------------------
// 源码浏览（限制在服务组目录内，防路径穿越）
// ---------------------------------------------------------------------------

/** 读取服务组内任意源码文件（相对路径），越界返回 null。 */
export function readSourceFile(relPath, group = GROUP) {
  const root = join(GROUPS_DIR, group);
  const target = resolve(root, relPath);
  if (!target.startsWith(root + "/") && target !== root) return null; // 防路径穿越
  if (!existsSync(target)) return null;
  return readFileSync(target, "utf8");
}

/** 列出可浏览的源码文件清单（端口/适配器/组合根等）。 */
export function listSourceFiles(group = GROUP) {
  const root = join(GROUPS_DIR, group);
  const out = [];
  const walk = (rel) => {
    const dir = join(root, rel);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(r);
      else if (entry.name.endsWith(".ts") || entry.name.endsWith(".json") || entry.name.endsWith(".md")) out.push(r);
    }
  };
  walk("");
  return out.sort();
}

// ---------------------------------------------------------------------------
// P2：回滚 / 端口依赖矩阵 / 错误码一致性检查
// ---------------------------------------------------------------------------

/** 单元最近提交历史（git log，最多 10 条）。 */
export function unitHistory(name, group = GROUP) {
  const dir = unitDir(name, group);
  if (!existsSync(join(dir, "contract.ts"))) throw new Error(`功能单元不存在: ${group}/features/${name}`);
  const r = spawnSync("git", ["log", "--oneline", "-10", "--", dir], { cwd: ROOT, encoding: "utf8" });
  return r.stdout.split("\n").filter(Boolean).map((line) => {
    const [hash, ...rest] = line.split(" ");
    return { hash, subject: rest.join(" ") };
  });
}

/**
 * 回滚该单元的指定提交（git revert，生成一次反向提交，历史保留）。
 * @param commitHash 完整或短哈希（来自 unitHistory）
 */
export function rollbackUnit(name, commitHash, group = GROUP) {
  const dir = unitDir(name, group);
  if (!existsSync(join(dir, "contract.ts"))) throw new Error(`功能单元不存在: ${group}/features/${name}`);
  const r = spawnSync("git", ["revert", "--no-edit", commitHash], { cwd: ROOT, encoding: "utf8", timeout: 30_000 });
  if (r.status === 0) return { ok: true, message: `已回滚 ${commitHash.slice(0, 7)}（git revert，历史保留可追溯）` };
  // revert 失败常见原因：冲突 / 该提交已被后续提交覆盖
  const err = (r.stderr ?? "").slice(-400) || (r.stdout ?? "").slice(-400);
  return { ok: false, message: `回滚失败：${err}` };
}

/** 端口依赖矩阵：每个单元 import 了哪些 ports（解析契约的 import）。 */
export function portDependencyMap(group = GROUP) {
  const units = listUnits(group).map((name) => {
    const contract = readUnitFiles(name, group).contract ?? "";
    const ports = [...contract.matchAll(/from "(?:\.\.\/)+ports\/([a-z-]+)"/g)].map((m) => m[1]);
    return { name, ports: [...new Set(ports)].sort() };
  });
  const allPorts = [...new Set(units.flatMap((u) => u.ports))].sort();
  return { group, units, ports: allPorts };
}

/**
 * 错误码一致性检查（契约 vs 实现 vs 定义）：
 *  - spec 第 4 节声明的错误码是否都在 ports/errors.ts 定义；
 *  - impl 实际抛出的错误码是否都在 spec 声明（防"实现漏了失败路径/加了未声明错误"）。
 */
export function checkErrorCodes(name, group = GROUP) {
  const files = readUnitFiles(name, group);
  if (!files.contract) throw new Error(`功能单元不存在: ${group}/features/${name}`);
  const errorsSrc = readSourceFile("ports/errors.ts", group) ?? "";

  const defined = [...errorsSrc.matchAll(/^\s*([A-Z][A-Z_]{2,}):\s*"/gm)].map((m) => m[1]);
  const specSection = /## 4\. 错误码[\s\S]*?(?=## 5\.)/.exec(files.spec ?? "")?.[0] ?? "";
  const declared = [...specSection.matchAll(/`([A-Z][A-Z_]{2,})`/g)].map((m) => m[1]);
  const thrown = [...(files.impl ?? "").matchAll(/AppError\(ErrorCodes\.([A-Z][A-Z_]{2,})/g)].map((m) => m[1]);

  // INVALID_INPUT 由组合根 zod 边界兜底抛出（单元内部假定输入已合法）——不算单元漏抛
  const boundaryCodes = ["INVALID_INPUT"];
  const problems = [];
  if (!declared.length) problems.push("spec 第 4 节未声明任何错误码（契约不完整）");
  if (!thrown.length && !isImplStub(files.impl)) problems.push("impl 未抛出任何 AppError（可能漏了全部失败路径）");
  if (isImplStub(files.impl)) problems.push("impl 还是桩（NOT_IMPLEMENTED），错误路径未实现");
  problems.push(
    ...declared.filter((c) => !defined.includes(c)).map((c) => `spec 声明了但 ports/errors.ts 未定义：${c}`),
    ...thrown.filter((c) => !declared.includes(c)).map((c) => `impl 抛出了但 spec 未声明：${c}`),
    ...declared
      .filter((c) => !thrown.includes(c) && !boundaryCodes.includes(c))
      .map((c) => `spec 声明了但 impl 未抛出：${c}（实现可能漏了该失败路径）`),
  );
  return {
    name,
    defined: [...new Set(defined)],
    declaredInSpec: [...new Set(declared)],
    thrownInImpl: [...new Set(thrown)],
    problems,
    ok: problems.length === 0,
  };
}

// ---------------------------------------------------------------------------
// 新建服务组（P2 多组支持：src/groups/ 下每个含 features/ 的目录即一个组）
// ---------------------------------------------------------------------------

/** 新组组合根骨架（空 API；加第一个功能单元时参照 auth-service 接线）。 */
const NEW_GROUP_INDEX = (name) => `/**
 * ============================================================================
 * [角色] 组合根：${name} —— 骨架（人维护，AI 禁止触碰）
 * ----------------------------------------------------------------------------
 * 新组从空 API 开始。接入第一个功能单元时：
 *   1. 参照 auth-service/index.ts 的接线模式（import → AuthApi → createApp → toXDeps）；
 *   2. 管理台「一键接线」的锚点目前面向 auth-service——新组第一个单元请人工接线，
 *      之后可扩展锚点支持多组；
 *   3. 接线完跑总闸（npm run check）确认。
 * ============================================================================
 */

import { z } from "zod";
import { AppError, ErrorCodes } from "./ports/errors";
import { consoleLogger, type Logger } from "./ports/logger";
import type { AppConfig } from "./config";

/** 全组依赖（由 buildDeps 组装；测试可用 overrides 替换任意一个）。 */
export interface GroupDeps {
  logger: Logger;
  now: () => Date;
}

/** 组装依赖——"换基础设施"的唯一位置。 */
export function buildDeps(config: AppConfig, overrides: Partial<GroupDeps> = {}): GroupDeps {
  return { logger: consoleLogger, now: () => new Date(), ...overrides };
}

/** 边界校验：zod parse 全部发生在组合根这一层（单元内部假定输入已合法）。 */
function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new AppError(ErrorCodes.INVALID_INPUT, 400);
  return parsed.data;
}

/** 对外 API（空骨架——每加一个功能单元，这里加一个方法）。 */
export interface GroupApi {
  /** 健康检查：验证组合根与配置可用。 */
  health(): { ok: boolean };
}

export function createApp(deps: GroupDeps): GroupApi {
  return {
    health: () => ({ ok: true }),
  };
}
`;

/** 新组配置骨架（fail fast；与管理台本地配置兼容）。 */
const NEW_GROUP_CONFIG = (name) => `/**
 * [角色] 配置：${name} —— 唯一允许读配置的文件（fail fast）
 * 优先级：本地配置文件（.featureunit.local.json）→ 环境变量 → 默认值。
 */

import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const EnvSchema = z.object({
  /** 业务服务端口。 */
  PORT: z.coerce.number().int().positive().default(3000),
});

export type AppConfig = z.infer<typeof EnvSchema>;

function localConfig(): Record<string, string> {
  try {
    const p = join(import.meta.dirname, "..", "..", "..", ".featureunit.local.json");
    if (existsSync(p)) {
      const raw = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (v !== null && v !== undefined) out[k] = String(v);
      }
      return out;
    }
  } catch {
    /* 损坏的配置文件按空处理 */
  }
  return {};
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const merged: NodeJS.ProcessEnv = { ...env, ...localConfig() };
  const parsed = EnvSchema.safeParse(merged);
  if (!parsed.success) {
    console.error("[config] 配置校验失败（fail fast）：", JSON.stringify(parsed.error.flatten().fieldErrors));
    process.exit(1);
  }
  return parsed.data;
}
`;

/** 新组判据占位（第一个功能单元接线后替换为真实端到端用例）。 */
const NEW_GROUP_TEST = (name) => `/**
 * [角色] 组判据：${name} —— 组合判据（占位）
 * 注意：这是"假绿"占位——第一个功能单元接线后，请替换为真实的端到端用例。
 */

import { describe, expect, it } from "vitest";

describe("${name} 组判据", () => {
  it("占位：等待第一个功能单元", () => {
    expect(true).toBe(true);
  });
});
`;

/**
 * 创建服务组：src/groups/<name>/ 骨架。
 * 从 auth-service 复制通用端口（errors/logger），生成组合根/配置/manifest/组判据。
 * @param name kebab-case 组名（如 order-service）
 */
export function createGroup(name) {
  if (!/^[a-z0-9-]+$/.test(name)) {
    throw new Error("组名只允许小写字母、数字、连字符（kebab-case）");
  }
  const dir = join(GROUPS_DIR, name);
  if (existsSync(dir)) {
    throw new Error(`服务组已存在: ${name}`);
  }

  mkdirSync(join(dir, "features"), { recursive: true });
  mkdirSync(join(dir, "ports"), { recursive: true });
  mkdirSync(join(dir, "adapters"), { recursive: true });

  // 通用端口从 auth-service 复制（错误协议与日志端口全组一致，保证错误码/日志语义统一）
  copyFileSync(join(GROUPS_DIR, GROUP, "ports", "errors.ts"), join(dir, "ports", "errors.ts"));
  copyFileSync(join(GROUPS_DIR, GROUP, "ports", "logger.ts"), join(dir, "ports", "logger.ts"));

  writeFileSync(join(dir, "index.ts"), NEW_GROUP_INDEX(name));
  writeFileSync(join(dir, "config.ts"), NEW_GROUP_CONFIG(name));
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify(
      {
        name,
        description: `服务组：${name}（新建，等待第一个功能单元）`,
        version: "0.1.0",
        owner: "human",
        features: {},
        rules: {
          compositionRootOwner: "human",
          aiWritablePaths: ["**/impl.ts"],
          frozenPaths: ["**/contract.ts", "**/spec.md", "**/impl.test.ts", "ports/**", "index.ts"],
        },
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(join(dir, "group.test.ts"), NEW_GROUP_TEST(name));

  return { name, dir };
}

// ---------------------------------------------------------------------------
// 端口统一管理（列表/依赖/适配器/新建）
// ---------------------------------------------------------------------------

/** 从端口文件头提取"一句话：..."用途描述。 */
function portDescription(content) {
  const m = /一句话[:：]\s*([^\n*]+)/.exec(content ?? "");
  return m ? m[1].trim() : "（未写用途说明）";
}

/**
 * 端口列表：扫描 ports/ 目录，汇总每个端口的
 * 一句话用途 / 依赖它的单元 / 实现了它的适配器。
 */
export function portList(group = GROUP) {
  const portsDir = join(GROUPS_DIR, group, "ports");
  if (!existsSync(portsDir)) return { group, ports: [] };

  // 单元 → 端口 反向依赖
  const unitPorts = listUnits(group).map((u) => ({
    unit: u,
    ports: [...(readUnitFiles(u, group).contract ?? "").matchAll(/from "(?:\.\.\/)+ports\/([a-z-]+)"/g)].map((m) => m[1]),
  }));

  // 适配器扫描：adapters/**/*.ts 里 implements <接口名> 的实现
  const adapters = [];
  const walk = (rel) => {
    const dir = join(GROUPS_DIR, group, "adapters", rel);
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(r);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        const content = readFileSync(join(dir, entry.name), "utf8");
        const impls = [...content.matchAll(/implements\s+(\w+)/g)].map((m) => m[1]);
        if (impls.length) adapters.push({ path: r, impls });
      }
    }
  };
  walk("");

  const ports = readdirSync(portsDir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".ts") && !d.name.endsWith(".test.ts"))
    .map((d) => {
      const name = d.name.replace(/\.ts$/, "");
      const interfaceName = pascal(name);
      const content = readFileSync(join(portsDir, d.name), "utf8");
      return {
        name,
        interfaceName,
        description: portDescription(content),
        usedBy: unitPorts.filter((u) => u.ports.includes(name)).map((u) => u.unit),
        adapters: adapters.filter((a) => a.impls.includes(interfaceName)).map((a) => a.path),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return { group, ports };
}

/**
 * 新建端口：ports/<name>.ts 接口模板（冻结区——人创建，AI 不许碰）。
 * @param name kebab-case 端口名（如 token-verifier）
 * @param description 一句话用途（写入文件头）
 */
export function createPort(name, description, group = GROUP) {
  if (!/^[a-z0-9-]+$/.test(name)) {
    throw new Error("端口名只允许小写字母、数字、连字符（kebab-case）");
  }
  const P = pascal(name);
  const path = join(GROUPS_DIR, group, "ports", `${name}.ts`);
  if (existsSync(path)) {
    throw new Error(`端口已存在: ${group}/ports/${name}.ts`);
  }
  const content = `/**
 * ============================================================================
 * [角色] 端口：${P} —— ${description ?? "（待补用途说明）"}
 * ----------------------------------------------------------------------------
 * 谁可以改：只有人（契约演进流程）。AI 实现任务中禁止修改本文件。
 * 纪律：
 *   - 只允许纯数据 + 接口，禁止任何实现代码（这是端口，不是实现）；
 *   - 禁止引入 ORM / HTTP / 框架类型；
 *   - 语义必须能被内存适配器完整模拟（否则单元无法独立测试）；
 *   - 不可控因素（时钟/随机数）设计成注入，测试才能固定时间。
 * ============================================================================
 */

// TODO(人/契约设计师)：定义端口接口。示例：
//   findByEmail(email: string): Promise<Xxx | null>;
export interface ${P} {
  // 待填：端口方法（语义见文件头"一句话"）
}
`;
  writeFileSync(path, content);
  return { name, path, interfaceName: P };
}

// ---------------------------------------------------------------------------
// 端口作者（Agent-D）：AI 生成端口接口 → 机器初审 → 人确认冻结
// ---------------------------------------------------------------------------

/**
 * 检查 interface 内每个方法是否都紧邻 JSDoc 语义注释（以斜杠双星号开头的块注释）。
 * 返回违规的方法名列表（空 = 全部合规）。
 */
function methodsWithoutDocs(content) {
  const iface = /export\s+interface\s+\w+\s*\{([\s\S]*?)\n\}/.exec(content ?? "")?.[1] ?? "";
  const lines = iface.split("\n");
  const bad = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*(\w+)\(/.exec(lines[i]); // 方法签名行
    if (!m) continue;
    // 判断方法是否有文档：向上找最近的非空行，必须是 JSDoc 块（*/ 结尾或单行 /** */）
    let j = i - 1;
    while (j >= 0 && lines[j].trim() === "") j--;
    const prev = lines[j] ?? "";
    if (!prev.includes("*/") && !prev.includes("/**")) bad.push(m[1]);
  }
  return bad;
}

/**
 * 从端口描述提取语义，建议贴合的方法骨架（mock 模式用）。
 * 关键词 → 方法模板；默认给 CRUD 骨架。返回 [{ sig, doc }]。
 */
/**
 * 从端口描述提取语义，建议贴合的方法骨架（mock 模式用）。
 * 关键词 → 方法模板；默认给 CRUD 骨架。
 * 返回 [{ sig, doc, types? }]——types 为方法引用的内联类型定义（保证草稿可编译）。
 */
function suggestMethods(description) {
  const d = description ?? "";
  if (/验证|凭证|token|令牌|验证码|一次性|verify|code/i.test(d)) {
    return {
      methods: [
        { sig: "issue(target: string, ttlMs: number): Promise<string>", doc: "签发一次性凭证（ttlMs 由调用方传入——时钟纪律）" },
        { sig: "verify(token: string): Promise<string | null>", doc: "验证凭证并返回目标；无效/过期返回 null（幂等）" },
        { sig: "consume(token: string): Promise<void>", doc: "作废凭证（一次性使用；不存在静默忽略）" },
      ],
    };
  }
  if (/订单|order|交易|trade/i.test(d)) {
    return {
      methods: [
        { sig: "findById(id: string): Promise<OrderRecord | null>", doc: "按 id 查订单；不存在返回 null（幂等）" },
        { sig: "create(order: OrderRecord): Promise<void>", doc: "创建订单（id 冲突覆盖）" },
        { sig: "updateStatus(id: string, status: OrderStatus): Promise<void>", doc: "更新状态（id 不存在静默忽略）" },
      ],
      types: `/** 纯数据：订单实体（草稿内联定义——真实字段由人拍板）。 */
export interface OrderRecord {
  id: string;
  userId: string;
  status: OrderStatus;
}

export type OrderStatus = "pending" | "paid" | "shipped" | "cancelled";`,
    };
  }
  return {
    methods: [
      { sig: "findById(id: string): Promise<Xxx | null>", doc: "按 id 查找；不存在返回 null（幂等）" },
      { sig: "save(record: Xxx): Promise<void>", doc: "保存（冲突覆盖）" },
      { sig: "delete(id: string): Promise<void>", doc: "删除（不存在静默忽略）" },
    ],
    types: `/** 占位实体类型——请替换为真实定义。 */
export interface Xxx {
  id: string;
}`,
  };
}

/**
 * 统计 interface 中返回类型不是 Promise 的方法数（仅看方法签名，不看数据字段）。
 */
function nonPromiseMethodCount(content) {
  const body = /export\s+interface\s+\w+\s*\{([\s\S]*?)\n\}/.exec(content ?? "")?.[1] ?? "";
  const sigs = [...body.matchAll(/^\s*\w+\([^;]*\):\s*([^;]+);/gm)];
  return sigs.filter((m) => !m[1].trim().startsWith("Promise")).length;
}

/**
 * 端口机器初审（纪律检查）：
 *  - 纯接口（有 export interface，无 class）；
 *  - 零基础设施 import（端口接口不得依赖任何外部包）；
 *  - 有一句话用途；方法均为 Promise 返回；每个方法带 JSDoc。
 */
export function machineCheckPort(content) {
  const bad = methodsWithoutDocs(content);
  const checks = [
    { label: "结构：包含 export interface", ok: /export\s+interface\s+\w+/.test(content) },
    { label: "纪律：无实现代码（无 class / 无方法体）", ok: !/class\s+\w+/.test(content) && !/=>\s*\{/.test(content) && !/\)\s*\{[\s\S]*\}/.test(content) },
    { label: "纪律：零 import（端口接口不依赖任何外部包）", ok: !/^\s*import\s/m.test(content) },
    { label: "纪律：无基础设施字样（pg/redis/express/knex…）", ok: !/\b(pg|redis|express|knex|prisma|mongoose|mysql)\b/i.test(content) },
    { label: "结构：有一句话用途", ok: /一句话[:：]/.test(content) },
    { label: `惯例：方法返回 Promise${nonPromiseMethodCount(content) ? `（${nonPromiseMethodCount(content)} 个非异步方法）` : ""}`, ok: nonPromiseMethodCount(content) === 0 },
    { label: `纪律：每个方法都有 JSDoc 语义注释${bad.length ? `（缺: ${bad.join(", ")}）` : ""}`, ok: bad.length === 0 },
  ];
  return { checks, ok: checks.every((c) => c.ok) };
}

/**
 * 生成端口草稿（Agent-D）并写入 ports/<name>.ts。
 * - mock 模式：内置"带典型缺陷的草稿"（泄漏实现/同步返回/缺语义注释），供评审抓；
 * - 真实模式：调 API（05-port-drafter.md 纪律）。
 * 守卫：已冻结的端口不允许被 AI 重写（冻结区纪律）。
 */
export async function generatePort(name, description, mock = true, group = GROUP) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error("端口名只允许小写字母、数字、连字符（kebab-case）");
  const P = pascal(name);
  const path = join(GROUPS_DIR, group, "ports", `${name}.ts`);

  if (existsSync(path) && readFileSync(path, "utf8").includes("冻结记录")) {
    throw new Error(`端口已冻结（${group}/ports/${name}.ts）——不允许被 AI 生成覆盖，请走契约演进流程`);
  }

  let content;
  if (mock) {
    // "坏学生"草稿：语义贴合描述（suggestMethods），但保留两个纪律缺陷供评审抓：
    // ① 违规 import（注释展示——不破坏编译，评审可见）② 方法缺失 JSDoc。
    // 重要：草稿必须可编译（类型内联、违规 import 注释化），否则会破坏 tsc 总闸。
    const { methods, types } = suggestMethods(description);
    content = `/**
 * [角色] 端口：${P} —— 草稿 v0.1（模拟 AI 生成，未冻结）
 * 一句话：${description ?? "（待补用途说明）"}
 */

// ⚠️ 缺陷：端口接口禁止依赖具体存储（实现细节泄漏）——以下 import 不允许出现在最终版本
// import { Redis } from "redis";

export interface ${P} {
${methods.map((m) => `  // ⚠️ 缺陷：方法缺少 JSDoc 语义注释（应有：${m.doc}）\n  ${m.sig};`).join("\n")}
}
${types ? "\n" + types : ""}
`;
  } else {
    const promptText = readFileSync(join(ROOT, "docs/agent-prompts/05-port-drafter.md"), "utf8")
      .replace("{PORT_NAME}", name)
      .replace("{PORT_REQUIREMENT}", description ?? "");
    const raw = await callLLM({
      system: promptText,
      user: `只输出一个 ts 代码块：ports/${name}.ts 的完整内容。`,
    });
    const m = /```(?:ts|typescript)\n([\s\S]*?)```/.exec(raw);
    if (!m) throw new Error(`模型输出无法解析（需要单个 ts 代码块）。原始输出片段：\n${raw.slice(0, 300)}`);
    content = m[1];
  }

  writeFileSync(path, content);
  const { checks, ok } = machineCheckPort(content);
  return { name, interfaceName: P, content, checks, machineOk: ok };
}

/** 冻结端口：人确认后，文件头写冻结记录 + git 提交。 */
export function freezePort(name, reviewer = "管理台操作员", group = GROUP) {
  const path = join(GROUPS_DIR, group, "ports", `${name}.ts`);
  if (!existsSync(path)) throw new Error(`端口不存在: ${group}/ports/${name}.ts`);
  const record = `/**
 * 冻结记录（端口）：${new Date().toISOString().slice(0, 10)} 由 ${reviewer} 确认后冻结。
 * 冻结后任何修改必须走契约演进流程。
 */
`;
  writeFileSync(path, record + readFileSync(path, "utf8"));
  spawnSync("git", ["add", "-A"], { cwd: ROOT });
  const commit = spawnSync("git", ["commit", "-q", "-m", `port: ${name} 端口冻结（人确认）`], { cwd: ROOT });
  return { committed: commit.status === 0, message: commit.status === 0 ? `已冻结并提交: ports/${name}.ts` : "冻结记录已写入，git 提交失败" };
}

// ---------------------------------------------------------------------------
// 端口文件编辑（管理台：人编辑 + git 留痕，与单元文件编辑一致）
// ---------------------------------------------------------------------------

/**
 * 保存端口文件（管理台编辑用）。人编辑冻结区文件是允许的，
 * 但每次保存必须 git 提交留痕（"谁在什么时候改了什么"可追溯）。
 */
export function savePortFile(name, content, note = "", group = GROUP) {
  const path = join(GROUPS_DIR, group, "ports", `${name}.ts`);
  if (!existsSync(path)) throw new Error(`端口不存在: ${group}/ports/${name}.ts`);

  writeFileSync(path, content);
  spawnSync("git", ["add", "-A"], { cwd: ROOT });
  const commit = spawnSync("git", ["commit", "-q", "-m", `admin: 编辑端口 ${name} — ${note || "（无备注）"}`], { cwd: ROOT });
  return {
    saved: true,
    committed: commit.status === 0,
    message: commit.status === 0
      ? `已保存并提交: ports/${name}.ts`
      : `已保存到磁盘，但 git 提交失败（${commit.stderr?.toString().trim() || "内容无变化"}）`,
  };
}

// ---------------------------------------------------------------------------
// 打包（Agent-E）：AI 辅助生成组合根接线 → 机器预演(tsc) → 人粘贴/确认
// ---------------------------------------------------------------------------

/**
 * 接线预演（mock 模式用）：把规则生成的接线写入文件 → 跑 tsc → 自动还原。
 * 机器判据：可编译才允许人确认；还原保证仓库不被预演污染。
 * @returns { ok, files, summary }——ok = tsc 通过
 */
export function preflightWiring(name, group = GROUP) {
  const { alreadyWired, files } = generateWiring(name, group);
  if (alreadyWired) return { ok: true, alreadyWired: true, files: [], summary: "该单元已接线，无需改动" };
  if (!files.length) return { ok: false, alreadyWired: false, files: [], summary: "无法生成接线改动（锚点缺失）" };

  // 写入 → tsc → 还原（不提交，仓库零污染）
  for (const f of files) writeFileSync(join(GROUPS_DIR, group, f.path), f.after);
  const tsc = spawnSync("npx", ["tsc", "--noEmit"], { cwd: ROOT, encoding: "utf8", timeout: 120_000 });
  for (const f of files) spawnSync("git", ["checkout", "-q", "--", join(GROUPS_DIR, group, f.path)], { cwd: ROOT });

  const errors = (tsc.stdout + tsc.stderr).split("\n").filter(Boolean).length;
  return {
    ok: tsc.status === 0,
    alreadyWired: false,
    files,
    summary: tsc.status === 0
      ? `✅ 预演通过：接线可编译（${files.length} 个文件，tsc 全项目 0 错误）`
      : `❌ 预演失败：接线后 tsc 有 ${errors} 处错误（已自动还原，请人工检查）`,
  };
}

/**
 * 打包助手（Agent-E）：生成接线草稿。
 * - mock 模式：规则生成（generateWiring）+ tsc 预演（机器判据，自动还原）；
 * - 真实模式：调 API（06-composition-drafter.md），产出三段粘贴片段 + 结构初审
 *   （机器检查关键模式），人粘贴后自行跑总闸验证。
 */
export async function generateWiringDraft(name, { mock = true } = {}, group = GROUP) {
  const files = readUnitFiles(name, group);
  if (!files.contract) throw new Error(`功能单元不存在: ${group}/features/${name}`);

  if (mock) {
    const preflight = preflightWiring(name, group);
    return {
      source: "mock（规则生成 + tsc 预演）",
      name,
      preflight,
      files: preflight.files.map((f) => ({ path: f.path, diffText: f.diffText })),
    };
  }

  // 真实模式：AI 生成三段片段
  const contract = files.contract;
  const existing = [
    "===== index.ts =====",
    readSourceFile("index.ts", group) ?? "",
    "===== adapters/http.ts =====",
    readSourceFile("adapters/http.ts", group) ?? "",
    "===== manifest.json =====",
    readSourceFile("manifest.json", group) ?? "",
  ].join("\n");
  const promptText = readFileSync(join(ROOT, "docs/agent-prompts/06-composition-drafter.md"), "utf8")
    .replace("{CONTRACT_CONTENT}", contract)
    .replace("{EXISTING_FILES}", existing);
  const raw = await callLLM({
    system: promptText,
    user: `单元名：${name}（服务组 ${group}）\n只输出三个代码块：ts(index) / ts(http) / json(manifest)。`,
  });

  // 结构初审：关键模式检查（真实片段无法自动应用，机器检查"该有的都有"）
  const P = pascal(name);
  const c = camel(name);
  const checks = [
    { label: `index 片段含 import（features/${name}/impl）`, ok: raw.includes(`features/${name}/impl`) },
    { label: `index 片段含接线方法 ${c}(input) => ${c}(parseOrThrow`, ok: raw.includes(`${c}: (input) => ${c}(parseOrThrow(${P}Input`) },
    { label: `index 片段含 to${P}Deps 依赖装配`, ok: raw.includes(`to${P}Deps`) && raw.includes(`${P}Deps`) },
    { label: "http 片段含路由 /api/" + name, ok: raw.includes(`/api/${name}`) },
    { label: "manifest 片段含版本登记", ok: raw.includes(`"${name}"`) },
  ];
  return { source: "live（AI 生成片段，人粘贴后跑总闸）", name, checks, raw, machineOk: checks.every((x) => x.ok) };
}

// ---------------------------------------------------------------------------
// 流水线（超级向导）：从一句话需求自动规划 → 逐步生成 → 人逐步确认
// ---------------------------------------------------------------------------

/**
 * 分析一句话需求，规划方案：服务组 / 单元 / 端口（mock：关键词规则；
 * 真实模式可让 AI 解析——本函数即"需求解析器"的最小实现）。
 *
 * 规则设计：新业务域（订单/库存/地址/收藏…）→ 新服务组 + 新端口 + 新单元；
 * 已有域（认证/登录/邮箱…）→ 复用 auth-service 与现有端口。
 */
export function analyzeRequirement(requirement, group = GROUP) {
  const d = requirement ?? "";

  // ── 组推断 ──
  let newGroup = null;
  let g = group;
  if (/订单|order|下单/i.test(d)) newGroup = "order-service";
  else if (/库存|stock|inventory/i.test(d)) newGroup = "inventory-service";
  else if (/地址|address|收货/i.test(d)) newGroup = "address-service";
  else if (/收藏|favorite|wishlist|心愿/i.test(d)) newGroup = "favorite-service";
  else if (/认证|登录|注册|邮箱|密码|账号|session|auth|会话/i.test(d)) g = "auth-service";
  else newGroup = "app-service";

  // ── 单元名（动词+对象）──
  let unitName = "process-request";
  if (/收藏/.test(d)) unitName = "toggle-favorite";
  else if (/地址/.test(d)) unitName = "manage-address";
  else if (/库存/.test(d)) unitName = "record-stock-movement";
  else if (/订单/.test(d)) unitName = "create-order";
  else if (/登录|认证|会话|token/i.test(d)) unitName = "verify-session";

  // ── 端口（该域的外部能力切面）──
  let portName = null;
  let portDescription = "";
  if (/收藏/.test(d)) { portName = "favorite-item"; portDescription = "用户收藏的商品条目存储"; }
  else if (/地址/.test(d)) { portName = "shipping-address"; portDescription = "用户收货地址的存储"; }
  else if (/库存/.test(d)) { portName = "inventory-snapshot"; portDescription = "库存快照的存储"; }
  else if (/订单/.test(d)) { portName = "order"; portDescription = "订单数据存储"; }

  return {
    group: newGroup ?? g,
    newGroup,
    unitName,
    portName,
    portDescription,
    unitDescription: requirement,
    reasons: [
      newGroup ? `新业务域 → 创建服务组 ${newGroup}` : `已有业务域 → 复用 ${g}`,
      portName ? `需要数据切面 → 生成端口 ${portName}` : "复用现有端口，无需新端口",
      `核心动作 → 单元 ${unitName}`,
    ],
  };
}
