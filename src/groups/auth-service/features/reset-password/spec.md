# 契约规格：reset-password（v1.0）

## 1. 一句话目标
凭邮件里的重置 token 设置新密码：校验 token → 更新哈希 → 全端下线 → token 作废。

## 2. 输入
- `token`：邮件链接里的一次性 token
- `newPassword`：8–128 位

## 3. 输出
成功 → `void`。失败 → 抛 AppError。

## 4. 错误码
- `INVALID_INPUT` (400)：输入不合法（组合根 zod 兜底）
- `RESET_TOKEN_INVALID` (400)：token 无效 / 过期 / 已使用 / 用户已删除

## 5. 端口
- `resetTokens: ResetTokenStore` —— 查 token / 用后即删
- `users: UserStore` —— 查用户 + 更新哈希
- `sessions: SessionStore` —— 成功后清除全部会话
- `hasher: PasswordHasher` —— 哈希新密码
- `logger: Logger` —— 记录重置事件
- `now: () => Date` —— token 过期判定

## 6. 不变量 / 边界情况
- token 无效 / 过期 / 已使用 / 用户被删 → 一律 `RESET_TOKEN_INVALID`
- token 一次性：用后立即作废（防重放）
- 成功后所有会话失效（全端下线）
- 明文密码绝不入日志
- 【不】负责：token 的生成与邮件发送（那是 request 单元的活）、登录后的引导
