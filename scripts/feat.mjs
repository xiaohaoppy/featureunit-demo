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
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createUnit, createGroup } from "./ai-contract-lib.mjs";

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
  feat new-group <组名>                 # 创建新服务组骨架（多组支持）
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
// feat new：生成 4 文件模板（模板在 ai-contract-lib.mjs——CLI 与管理台共用）
// ---------------------------------------------------------------------------

function cmdNew(name, group) {
  try {
    const { dir } = createUnit(name, group);
    console.log(`✓ 已生成功能单元 ${group}/features/${name}/`);
    console.log(`  下一步：填 contract.ts（或 feat ai-contract）→ 评审冻结 → 写判据 → 交给 AI`);
  } catch (err) {
    usage(err instanceof Error ? err.message : String(err));
  }
}

/** feat new-group <名字>：创建新服务组骨架。 */
function cmdNewGroup(name) {
  try {
    const { dir } = createGroup(name);
    console.log(`✓ 已创建服务组 ${name}/`);
    console.log(`  结构: features/ ports/(errors,logger) config.ts index.ts manifest.json group.test.ts`);
    console.log(`  下一步: feat new <功能名> --group ${name} 创建第一个功能单元`);
  } catch (err) {
    usage(err instanceof Error ? err.message : String(err));
  }
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
  case "new-group": {
    if (!arg1) usage("feat new-group 需要组名，例如: feat new-group order-service");
    cmdNewGroup(arg1);
    break;
  }
  case "ai-contract": {
    if (!arg1) usage("feat ai-contract 需要功能名，例如: feat ai-contract delete-order \"用户可以删除自己的订单\" --mock");
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
