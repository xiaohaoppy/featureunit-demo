# 契约规格：request-password-reset（v1.0）

## 1. 一句话目标
用户提交邮箱 → 生成一次性重置 token → 发邮件（内含重置链接）。

## 2. 输入
- `email`：合法邮箱格式（zod 兜底）

## 3. 输出
成功 → `void`（无论邮箱是否存在都返回成功——防枚举）。

## 4. 错误码
- `INVALID_INPUT` (400)：email 非法（组合根 zod 兜底）
- `RATE_LIMITED` (429)：同一邮箱在窗口内请求超限

## 5. 端口
- `users: UserStore` —— 判断邮箱是否存在（不存在则假装成功）
- `mail: EmailSender` —— 发送含 token 的邮件
- `resetTokens: ResetTokenStore` —— 存 token / 作废旧 token
- `rate: RateLimiter` —— 限流（找回密码是爆破重灾区）
- `logger: Logger` —— 记录事件（不含邮箱）
- `now` + `resetTokenTtlMs` —— token 过期时间（组合根注入）

## 6. 不变量 / 边界情况
- 邮箱不存在 → 返回成功、不发邮件、不写 token
- 重复请求 → 旧 token 作废，只保留最新
- token 过期时间 = `now() + resetTokenTtlMs`
- 邮件正文必须包含重置 token
- 邮箱不进日志
- 【不】负责：邮件模板/品牌样式（适配器层）、新密码校验、实际重置（reset 单元的活）
