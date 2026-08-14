/**
 * ============================================================================
 * [角色] 组合根：index —— 全组唯一"知道一切"的文件（人维护，AI 禁止触碰）
 * ----------------------------------------------------------------------------
 * 这个文件是整个框架的枢纽，也是唯一的例外：
 *   - 功能单元互相不知道对方存在（只能通过端口协作）；
 *   - 适配器互相不知道对方存在；
 *   - 【只有这里】知道"7 个单元 + 5 组适配器 + 配置"如何拼成一个服务。
 *
 * 纪律：
 *   1. 本文件由人维护。AI 的任何 ticket 都【不允许】修改它
 *      （manifest.json 的 aiWritablePaths 只放行各单元的 impl.ts）；
 *   2. 新增/替换适配器、调整 TTL、换限流策略——都只改这里（或 config.ts）；
 *   3. 本文件不写业务逻辑，只做"接线"。
 * ============================================================================
 */

import { join } from "node:path";
import { z } from "zod";
import { AppError, ErrorCodes } from "./ports/errors";
import { consoleLogger, type Logger } from "./ports/logger";
import type { UserStore } from "./ports/user-store";
import type { SessionStore } from "./ports/session-store";
import type { PasswordHasher } from "./ports/password-hasher";
import type { EmailSender } from "./ports/email-sender";
import type { ResetTokenStore } from "./ports/reset-token-store";
import type { RateLimiter } from "./ports/rate-limiter";

import { MemoryUserStore } from "./adapters/memory/memory-user-store";
import { MemorySessionStore } from "./adapters/memory/memory-session-store";
import { MemoryResetTokenStore } from "./adapters/memory/memory-reset-token-store";
import { MemoryEmailSender } from "./adapters/memory/memory-email-sender";
import { FixedWindowRateLimiter } from "./adapters/memory/fixed-window-rate-limiter";
import { FileUserStore } from "./adapters/file-user-store";
import { ScryptPasswordHasher } from "./adapters/scrypt-password-hasher";

import { registerUser } from "./features/register-user/impl";
import { login } from "./features/login/impl";
import { logout } from "./features/logout/impl";
import { currentUser } from "./features/current-user/impl";
import { changePassword } from "./features/change-password/impl";
import { changeEmail } from "./features/change-email/impl";
import { requestPasswordReset } from "./features/request-password-reset/impl";
import { resetPassword } from "./features/reset-password/impl";

// 依赖子集类型定义在各自契约里（单一事实来源：接口在 contract.ts，实现只在 impl.ts）
import type { RegisterUserDeps } from "./features/register-user/contract";
import type { LoginDeps } from "./features/login/contract";
import type { LogoutDeps } from "./features/logout/contract";
import type { CurrentUserDeps } from "./features/current-user/contract";
import type { ChangePasswordDeps } from "./features/change-password/contract";
import type { ChangeEmailDeps } from "./features/change-email/contract";
import type { RequestPasswordResetDeps } from "./features/request-password-reset/contract";
import type { ResetPasswordDeps } from "./features/reset-password/contract";

import { RegisterUserInput } from "./features/register-user/contract";
import { LoginInput } from "./features/login/contract";
import { LogoutInput } from "./features/logout/contract";
import { CurrentUserInput } from "./features/current-user/contract";
import { ChangePasswordInput } from "./features/change-password/contract";
import { ChangeEmailInput } from "./features/change-email/contract";
import { RequestPasswordResetInput } from "./features/request-password-reset/contract";
import { ResetPasswordInput } from "./features/reset-password/contract";

import type { AppConfig } from "./config";

// ---------------------------------------------------------------------------
// 依赖集：组合根对"外部世界"的完整清单（组装一次，供所有单元注入）
// ---------------------------------------------------------------------------

/** 全组依赖（由 buildDeps 组装；测试可用 overrides 替换其中任意一个）。 */
export interface AuthDeps {
  users: UserStore;
  sessions: SessionStore;
  resetTokens: ResetTokenStore;
  hasher: PasswordHasher;
  mail: EmailSender;
  rate: RateLimiter;
  logger: Logger;
  now: () => Date;
  /** 会话有效期（毫秒）——从配置换算，注入单元。 */
  sessionTtlMs: number;
  /** 重置 token 有效期（毫秒）——从配置换算，注入单元。 */
  resetTokenTtlMs: number;
}

/**
 * 组装依赖。这是"换基础设施"的唯一位置：
 *   换数据库 → 换 users 那一行；换 Redis 会话 → 换 sessions 那一行；
 *   换 SMTP → 换 mail 那一行。7 个功能单元对此毫无感知。
 *
 * @param config    已校验的配置
 * @param overrides 测试用覆盖（如注入 MemoryEmailSender 以便断言邮件内容）
 */
export function buildDeps(config: AppConfig, overrides: Partial<AuthDeps> = {}): AuthDeps {
  const base: AuthDeps = {
    // 用户存储：按配置选择内存或 JSON 文件实现（生产：替换为 Postgres 适配器）
    users: config.USER_STORE === "file"
      ? new FileUserStore(join(config.DATA_DIR, "users.json"))
      : new MemoryUserStore(),
    // 会话存储：演示用内存实现（生产：替换为 Redis 适配器，TTL 由 Redis 兜底）
    sessions: new MemorySessionStore(),
    resetTokens: new MemoryResetTokenStore(),
    hasher: new ScryptPasswordHasher(), // 真实 scrypt；可换 argon2/bcrypt 适配器
    mail: new MemoryEmailSender(),      // 演示：邮件打印进内存（生产：SMTP 适配器）
    rate: new FixedWindowRateLimiter(config.RATE_LIMIT_MAX, config.RATE_LIMIT_WINDOW_MS),
    logger: consoleLogger,
    now: () => new Date(), // 真时钟；测试注入假时钟
    sessionTtlMs: config.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    resetTokenTtlMs: config.RESET_TOKEN_TTL_MINUTES * 60 * 1000,
  };
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// 边界校验：zod parse 全部发生在组合根这一层（单元内部假定输入已合法）
// ---------------------------------------------------------------------------

/** 在边界把未知数据 parse 成契约类型；非法输入 → AppError(INVALID_INPUT, 400)。 */
function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new AppError(ErrorCodes.INVALID_INPUT, 400);
  return parsed.data;
}

// ---------------------------------------------------------------------------
// 服务门面：组合根把 7 个单元"接上线"后的对外 API
// ---------------------------------------------------------------------------

/** 登录系统的对外 API（HTTP 层和组测试都只跟它打交道）。 */
export interface AuthApi {
  register(input: unknown): Promise<{ id: string; email: string }>;
  login(input: unknown): Promise<{ token: string; user: { id: string; email: string } }>;
  logout(input: unknown): Promise<void>;
  me(input: unknown): Promise<{ id: string; email: string }>;
  changePassword(input: unknown): Promise<void>;
  changeEmail(input: unknown): Promise<void>;
  requestPasswordReset(input: unknown): Promise<void>;
  resetPassword(input: unknown): Promise<void>;
}

/**
 * 组合根：把依赖注入 7 个单元，并包上边界校验。
 * 注意每个单元拿到的只是【它契约里声明的子集】——单元看不到其他端口，
 * 这从结构上杜绝了"单元偷偷绕过端口直接用别的依赖"。
 */
export function createAuthApp(deps: AuthDeps): AuthApi {
  return {
    register: (input) => registerUser(parseOrThrow(RegisterUserInput, input), toRegisterDeps(deps)),
    login: (input) => login(parseOrThrow(LoginInput, input), toLoginDeps(deps)),
    logout: (input) => logout(parseOrThrow(LogoutInput, input), toLogoutDeps(deps)),
    me: (input) => currentUser(parseOrThrow(CurrentUserInput, input), toCurrentUserDeps(deps)),
    changePassword: (input) => changePassword(parseOrThrow(ChangePasswordInput, input), toChangePasswordDeps(deps)),
    changeEmail: (input) => changeEmail(parseOrThrow(ChangeEmailInput, input), toChangeEmailDeps(deps)),
    requestPasswordReset: (input) => requestPasswordReset(parseOrThrow(RequestPasswordResetInput, input), toRequestResetDeps(deps)),
    resetPassword: (input) => resetPassword(parseOrThrow(ResetPasswordInput, input), toResetPasswordDeps(deps)),
  };
}

// 依赖子集装配（每个单元只见自己的契约）。这些函数保持"接线"性质，无业务逻辑。
function toRegisterDeps(d: AuthDeps): RegisterUserDeps {
  return { users: d.users, hasher: d.hasher, logger: d.logger };
}
function toLoginDeps(d: AuthDeps): LoginDeps {
  return { users: d.users, sessions: d.sessions, hasher: d.hasher, logger: d.logger, now: d.now, sessionTtlMs: d.sessionTtlMs };
}
function toLogoutDeps(d: AuthDeps): LogoutDeps {
  return { sessions: d.sessions, logger: d.logger };
}
function toCurrentUserDeps(d: AuthDeps): CurrentUserDeps {
  return { sessions: d.sessions, users: d.users, now: d.now };
}
function toChangePasswordDeps(d: AuthDeps): ChangePasswordDeps {
  return { sessions: d.sessions, users: d.users, hasher: d.hasher, logger: d.logger, now: d.now };
}
function toChangeEmailDeps(d: AuthDeps): ChangeEmailDeps {
  return { sessions: d.sessions, users: d.users, hasher: d.hasher, logger: d.logger, now: d.now };
}
function toRequestResetDeps(d: AuthDeps): RequestPasswordResetDeps {
  return { users: d.users, mail: d.mail, resetTokens: d.resetTokens, rate: d.rate, logger: d.logger, now: d.now, resetTokenTtlMs: d.resetTokenTtlMs };
}
function toResetPasswordDeps(d: AuthDeps): ResetPasswordDeps {
  return { resetTokens: d.resetTokens, users: d.users, sessions: d.sessions, hasher: d.hasher, logger: d.logger, now: d.now };
}
