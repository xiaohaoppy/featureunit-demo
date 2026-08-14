# 契约规格：change-password（v1.0）

## 1. 一句话目标
登录用户修改自己的密码：验证旧密码 → 更新哈希 → 全端强制下线。

## 2. 输入
- `token`：当前会话（必须有效）
- `currentPassword`：旧密码（非空）
- `newPassword`：8–128 位

## 3. 输出
成功 → `void`。失败 → 抛 AppError。

## 4. 错误码
- `INVALID_INPUT` (400)：输入不合法（组合根 zod 兜底）
- `INVALID_SESSION` (401)：token 无效 / 过期
- `WRONG_PASSWORD` (401)：旧密码错误

## 5. 端口
- `sessions: SessionStore` —— 查会话 + 成功后清除全部会话
- `users: UserStore` —— 查用户 + 更新哈希
- `hasher: PasswordHasher` —— 验证旧密码 / 哈希新密码
- `logger: Logger` —— 记录改密事件
- `now: () => Date` —— 会话过期判定

## 6. 不变量 / 边界情况
- 旧密码错误 → 不修改任何数据（哈希、会话都不动）
- 成功后所有会话失效（含当前会话）——强制重新登录
- 新密码与旧密码相同？允许（业务拍板：不做额外限制，但可在此追加不变量）
- 明文密码绝不入日志
- 【不】负责：密码强度策略（除长度外）、找回密码（那是 reset 单元的活）
