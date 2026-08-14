/**
 * ============================================================================
 * [角色] 配置：config —— 全组唯一允许读环境变量的文件
 * ----------------------------------------------------------------------------
 * 纪律：
 *   1. 只有本文件能碰 process.env；组合根从这里拿配置，功能单元只拿
 *      已经注入好的值（TTL、时钟等），永远接触不到环境变量；
 *   2. 启动即校验（fail fast）：配置缺失/非法直接退出，绝不带病运行——
 *      "半死不活的服务"比"起不来的服务"难查一百倍；
 *   3. 秘密（DB 密码、SMTP 密钥）绝不进功能单元、绝不进测试。
 * ============================================================================
 */

import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** 环境变量 schema：所有字段都有默认值（本地零配置可跑），显式声明即覆盖。 */
const EnvSchema = z.object({
  /** HTTP 端口。 */
  PORT: z.coerce.number().int().positive().default(3000),
  /** 用户存储实现：memory（进程内存）| file（JSON 文件持久化）。 */
  USER_STORE: z.enum(["memory", "file"]).default("memory"),
  /** USER_STORE=file 时的数据目录。 */
  DATA_DIR: z.string().default("./data"),
  /** 会话有效期（天）。 */
  SESSION_TTL_DAYS: z.coerce.number().positive().default(30),
  /** 重置密码 token 有效期（分钟）。 */
  RESET_TOKEN_TTL_MINUTES: z.coerce.number().positive().default(30),
  /** 找回密码限流：窗口内最大次数。 */
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(3),
  /** 找回密码限流：窗口长度（毫秒）。 */
  RATE_LIMIT_WINDOW_MS: z.coerce.number().positive().default(10 * 60 * 1000),
});

/** 解析后的配置类型（与 schema 单一事实来源）。 */
export type AppConfig = z.infer<typeof EnvSchema>;

/**
 * 读取管理台写入的本地配置（.featureunit.local.json，不进 git）。
 * 位置：项目根。文件不存在/损坏 → {}（一切走环境变量/默认值）。
 * 值统一转成字符串（zod 的 z.coerce 会再按需转换）。
 */
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
    /* 损坏的配置文件按空处理，不阻断启动 */
  }
  return {};
}

/**
 * 加载并校验配置。校验失败 → 打印原因并退出（fail fast）。
 * 优先级：本地配置文件（管理台写入）→ 环境变量 → schema 默认值。
 * @param env 环境变量来源（默认 process.env；测试可注入假环境）
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const merged: NodeJS.ProcessEnv = { ...env, ...localConfig() }; // 本地文件优先
  const parsed = EnvSchema.safeParse(merged);
  if (!parsed.success) {
    // 启动即失败：把缺失/非法的字段名打出来，人一眼定位
    console.error(
      "[config] 配置校验失败（fail fast）：",
      JSON.stringify(parsed.error.flatten().fieldErrors),
    );
    process.exit(1);
  }
  return parsed.data;
}
