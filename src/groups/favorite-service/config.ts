/**
 * [角色] 配置：favorite-service —— 唯一允许读配置的文件（fail fast）
 * 优先级：本地配置文件（.featureunit.local.json）→ 环境变量 → 默认值。
 */

import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const EnvSchema = z.object({
  /** 业务服务数据接口。 */
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
