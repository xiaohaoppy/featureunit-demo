/**
 * ============================================================================
 * [角色] 端口：Logger —— 日志端口（冻结区）
 * ----------------------------------------------------------------------------
 * 一句话：把"记日志"也变成端口，业务单元只记录业务事实，不关心日志去向。
 *
 * 为什么必须端口化（这是踩过坑才定的规则）：
 *   1. 如果不端口化，AI 会在业务代码里到处 console.log，或者干脆不记——
 *      观测性变成玄学。端口化后，单元在【关键业务节点】调用 deps.logger，
 *      组合根注入真实现（结构化 JSON → stdout），测试注入哑实现。
 *   2. 日志内容本身是契约的一部分：密码、token、邮箱等敏感字段【禁止】入日志，
 *      这可以写进契约注释，并由测试断言。
 *
 * 谁可以改：只有人。AI 实现任务中禁止修改本文件。
 * ============================================================================
 */

export interface Logger {
  /** 业务事件：如 register-user.ok、login.ok。msg 用 kebab-case 的"单元.事件"格式。 */
  info(msg: string, meta?: Record<string, unknown>): void;
  /** 可恢复的异常情况：如限流触发。 */
  warn(msg: string, meta?: Record<string, unknown>): void;
  /** 不可恢复的错误：如未知异常。不含敏感数据。 */
  error(msg: string, meta?: Record<string, unknown>): void;
}

/** 测试用哑实现：什么都不做（判据里不需要日志断言时用它，保证测试安静）。 */
export const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * 生产/开发用实现：结构化 JSON 输出到 stdout。
 * 为什么用 JSON：可被日志采集系统（ELK/Loki）直接解析，人读时用 jq 即可。
 * 注：本文件是端口文件里唯一的"带实现"的例外——Logger 的实现太薄，
 *     不值得单独开适配器；组合根也可用自定义 Logger 覆盖它。
 */
export const consoleLogger: Logger = {
  info: (msg, meta) => console.log(JSON.stringify({ level: "info", msg, ...meta })),
  warn: (msg, meta) => console.warn(JSON.stringify({ level: "warn", msg, ...meta })),
  error: (msg, meta) => console.error(JSON.stringify({ level: "error", msg, ...meta })),
};
