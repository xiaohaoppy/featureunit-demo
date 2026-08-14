#!/usr/bin/env node
/**
 * ============================================================================
 * [角色] 脚手架：feat —— 框架的日常工具
 * ----------------------------------------------------------------------------
 * 用法（在 featureunit-demo/ 下执行 npm run feat -- <命令>）：
 *
 *   feat new register-user --group auth-service
 *       生成一个新功能单元的 4 个文件（契约/规格/判据/实现桩）
 *
 *   feat test login
 *       只跑该单元的判据（AI 迭代时用它，毫秒级）
 *
 *   feat check
 *       类型检查 + 全部测试（提交前的总闸）
 *
 *   feat ticket login
 *       打印该单元的 AI ticket（docs/agent-prompts/03 的填充版）
 *
 * 为什么用纯 JS 写：零依赖、零编译，任何环境直接 node 跑。
 * ============================================================================
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const GROUPS_DIR = join(ROOT, "src/groups");

const [cmd, arg1, ...rest] = process.argv.slice(2);

// ---------------------------------------------------------------------------
// 通用工具
// ---------------------------------------------------------------------------

/** 打印用法并退出。 */
function usage(message) {
  if (message) console.error(`\n✗ ${message}\n`);
  console.error(`用法:
  feat new <功能名> [--group <组名>]    # 生成新功能单元（4 文件模板）
  feat ai-contract <功能名> "<需求>" [--mock] [--yes]
                                        # AI 生成契约草稿 → 机器初审 → 人确认 → 冻结
  feat test <功能名> [--group <组名>]   # 只跑该单元的判据
  feat check                            # 类型检查 + 全部测试
  feat ticket <功能名> [--group <组名>] # 打印该单元的 AI ticket`);
  process.exit(1);
}

/** 从 --group 参数或默认组解析组名。 */
function parseGroup() {
  const i = rest.indexOf("--group");
  return i >= 0 && rest[i + 1] ? rest[i + 1] : "auth-service";
}

/** 定位功能单元目录；不存在则报错退出。 */
function featureDir(name, group) {
  const dir = join(GROUPS_DIR, group, "features", name);
  if (!requireDirExists(dir)) usage(`功能单元不存在: ${group}/features/${name}`);
  return dir;
}

function requireDirExists(dir) {
  try {
    return readFileSync(join(dir, "contract.ts"), "utf8").length >= 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// feat new：生成 4 文件模板
// ---------------------------------------------------------------------------

const NEW_CONTRACT = (name) => `/**
 * [角色] 功能单元：${name} —— 契约（冻结区）
 * 谁可以改：只有人（契约演进流程）。AI 实现任务中【禁止】修改本文件。
 * 填写指南：docs/contract-template.md（六要素）
 */

import { z } from "zod";

// TODO(人/契约设计师)：定义输入 schema（含边界规则，见模板第 2 节）
export const ${pascal(name)}Input = z.object({
  // example: email: z.string().email(),
});

export type ${pascal(name)}Input = z.infer<typeof ${pascal(name)}Input>;

// TODO：声明依赖端口（只允许纯数据 + 接口，禁止 ORM/HTTP/框架类型）
export interface ${pascal(name)}Deps {
  // example: users: UserStore;
}

export interface ${pascal(name)}Result {
  // example: ok: true;
}

export interface ${pascal(name)} {
  (input: ${pascal(name)}Input, deps: ${pascal(name)}Deps): Promise<${pascal(name)}Result>;
}

/**
 * 不变量（≥3 条，条条可被测试断言；impl.test.ts 会逐条验证）：
 * 1. TODO
 * 2. TODO
 * 3. TODO
 */
`;

const NEW_SPEC = (name) => `# 契约规格：${name}（v0.1-draft）

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
`;

const NEW_IMPL = (name) => `/**
 * [角色] 功能单元：${name} —— 实现（AI 写入区）
 * 本文件是单元内【唯一】允许 AI 修改的文件。
 * 当前为桩实现：判据是红的，交给 AI（或人）按契约填成真的。
 */

import type { ${pascal(name)} } from "./contract";

export const ${camel(name)}: ${pascal(name)} = async (_input, _deps) => {
  throw new Error("NOT_IMPLEMENTED: 按 contract.ts 的不变量实现本单元");
};
`;

const NEW_TEST = (name) => `/**
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
`;

/** kebab-case → PascalCase（register-user → RegisterUser）。 */
function pascal(kebab) {
  return kebab.split("-").map((s) => s[0].toUpperCase() + s.slice(1)).join("");
}

/** kebab-case → camelCase（register-user → registerUser）。 */
function camel(kebab) {
  const p = pascal(kebab);
  return p[0].toLowerCase() + p.slice(1);
}

function cmdNew(name, group) {
  if (!/^[a-z0-9-]+$/.test(name)) usage("功能名只允许小写字母、数字、连字符（kebab-case）");
  const dir = join(GROUPS_DIR, group, "features", name);
  if (requireDirExists(name, group)) usage(`功能单元已存在: ${group}/features/${name}`);

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "contract.ts"), NEW_CONTRACT(name));
  writeFileSync(join(dir, "spec.md"), NEW_SPEC(name));
  writeFileSync(join(dir, "impl.ts"), NEW_IMPL(name));
  writeFileSync(join(dir, "impl.test.ts"), NEW_TEST(name));
  console.log(`✓ 已生成功能单元 ${group}/features/${name}/`);
  console.log(`  下一步：按 docs/contract-template.md 填 contract.ts → 评审冻结 → 写判据 → 交给 AI`);
}

// ---------------------------------------------------------------------------
// feat test / feat check：判据执行
// ---------------------------------------------------------------------------

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: ROOT });
  return r.status ?? 1;
}

function cmdTest(name, group) {
  const dir = featureDir(name, group);
  const status = run("npx", ["vitest", "run", join(dir, "impl.test.ts")]);
  process.exit(status);
}

function cmdCheck() {
  console.log("── 1/2 类型检查（tsc --noEmit）──");
  const tsc = run("npx", ["tsc", "--noEmit"]);
  console.log("── 2/2 全部测试（vitest run）──");
  const tests = run("npx", ["vitest", "run"]);
  process.exit(tsc === 0 && tests === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------
// feat ticket：打印 AI ticket
// ---------------------------------------------------------------------------

function cmdTicket(name, group) {
  const dir = featureDir(name, group);
  const prompt = readFileSync(join(ROOT, "docs/agent-prompts/03-unit-implementer.md"), "utf8");
  const filled = prompt
    .replaceAll("{FEATURE_NAME}", name)
    .replaceAll("{GROUP}", `src/groups/${group}`)
    .replaceAll("{FEATURE_PATH}", dir);
  console.log("=".repeat(72));
  console.log(`AI TICKET：${name}（${group}）——复制下面整段发给 AI`);
  console.log("=".repeat(72));
  console.log(filled);
}

// ---------------------------------------------------------------------------
// 分发
// ---------------------------------------------------------------------------

switch (cmd) {
  case "new": {
    if (!arg1) usage("feat new 需要功能名");
    cmdNew(arg1, parseGroup());
    break;
  }
  case "ai-contract": {
    if (!arg1) usage("feat ai-contract 需要功能名，例如: feat ai-contract delete-account \"登录用户可以删除自己的账号\" --mock");
    // 委托给独立脚本（它有自己的评审交互与冻结流程）
    const r = spawnSync("node", [join(ROOT, "scripts/ai-contract.mjs"), arg1, ...rest], { stdio: "inherit", cwd: ROOT });
    process.exit(r.status ?? 1);
    break;
  }
  case "test": {
    if (!arg1) usage("feat test 需要功能名");
    cmdTest(arg1, parseGroup());
    break;
  }
  case "check":
    cmdCheck();
    break;
  case "ticket": {
    if (!arg1) usage("feat ticket 需要功能名");
    cmdTicket(arg1, parseGroup());
    break;
  }
  default:
    usage(cmd ? `未知命令: ${cmd}` : undefined);
}
