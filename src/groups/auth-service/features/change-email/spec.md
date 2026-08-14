# 契约规格：change-email（v1.0）

## 1. 一句话目标
登录用户修改自己的邮箱：重新验证密码 → 检查新邮箱占用 → 更新 → 全端下线。

## 2. 输入
- `token`：当前会话（必须有效）
- `currentPassword`：旧密码（敏感操作必须重新验证身份）
- `newEmail`：合法邮箱格式

## 3. 输出
成功 → `void`。失败 → 抛 AppError。

## 4. 错误码
- `INVALID_INPUT` (400)：输入不合法（组合根 zod 兜底）
- `INVALID_SESSION` (401)：token 无效 / 过期
- `WRONG_PASSWORD` (401)：旧密码错误
- `EMAIL_TAKEN` (409)：新邮箱已被其他用户占用

## 5. 端口
- `sessions: SessionStore` —— 查会话 + 成功后清除全部会话
- `users: UserStore` —— 查用户 + 查新邮箱占用 + 更新邮箱
- `hasher: PasswordHasher` —— 验证旧密码
- `logger: Logger` —— 记录改邮箱事件（不含邮箱）
- `now: () => Date` —— 会话过期判定

## 6. 不变量 / 边界情况
- 旧密码错误 → 不修改任何数据（哈希、邮箱、会话都不动）
- 新邮箱被他人占用 → 不修改任何数据
- 新邮箱 = 自己的旧邮箱 → 幂等成功（不做任何修改）
- 成功后所有会话失效（含当前）——强制重新登录
- 邮箱（PII）绝不入日志
- 【不】负责：邮箱验证邮件（真实系统应发"邮箱已变更"通知）、登录、
  密码修改（那是 change-password 单元的活）
