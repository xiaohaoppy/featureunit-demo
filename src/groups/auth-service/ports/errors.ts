/**
 * ============================================================================
 * [角色] 端口：错误协议（冻结区）
 * ----------------------------------------------------------------------------
 * 一句话：全组统一的错误语言。所有功能单元只抛 AppError（带错误码），
 *         绝不抛带用户文案的错误，也绝不直接抛底层异常（如数据库错误）。
 *
 * 为什么这样设计（人要为 AI 的产品负责，所以纪律要写成代码）：
 *   1. 单元只需要回答"业务上这是哪种错"，不需要关心"用户会看到什么"。
 *      用户文案是展示层的事，只存在于 HTTP 适配器的映射表里。
 *   2. 未知错误（AI 没预料到的）由适配器统一兜底为 500，不会泄漏堆栈。
 *   3. 错误码是字符串常量，跨单元可 grep、可断言、可枚举——机器可判据。
 *
 * 谁可以改：只有人（功能规格演进流程）。AI 实现任务中禁止修改本文件。
 * ============================================================================
 */

/** 全组错误码清单：新增错误码 = 走功能规格演进流程，并同步 HTTP 映射表。 */
export const ErrorCodes = {
  /** 输入不符合功能规格 schema（由组合根在边界用 zod 校验后抛出） */
  INVALID_INPUT: "INVALID_INPUT",
  /** 会话 token 无效 / 过期 / 对应用户已不存在（会话切面：随第一个需要会话的功能接入） */
  INVALID_SESSION: "INVALID_SESSION",
  /** 触发限流（通用安全码：防爆破/防滥用） */
  RATE_LIMITED: "RATE_LIMITED",
} as const;

/** 错误码的静态类型（编译期约束：只能使用 ErrorCodes 里定义的值） */
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * 组级业务错误。
 *
 * 规则：
 * - code：机器可判定的错误码（见 ErrorCodes）
 * - status：建议的 HTTP 状态码（HTTP 适配器以此为默认映射，可覆盖）
 * - 单元【禁止】把用户消息、堆栈、敏感数据放进错误里
 */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly status: number,
    options?: { cause?: unknown },
  ) {
    super(code, options); // message 即错误码本身，简洁且可 grep
    this.name = "AppError";
  }
}
