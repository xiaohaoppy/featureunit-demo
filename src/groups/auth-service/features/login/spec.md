# 契约规格：login（v1.0）

## 1. 一句话目标
邮箱 + 密码换会话 token：验证凭据，创建会话，返回 token 与用户信息。

## 2. 输入
- `email`：合法邮箱格式（zod 兜底）
- `password`：非空字符串（密码规则是注册侧的事）

## 3. 输出
成功 → `{ token, user: { id, email } }`。失败 → 抛 AppError。

## 4. 错误码
- `INVALID_INPUT` (400)：email 非法 / 密码为空（组合根 zod 兜底）
- `INVALID_CREDENTIALS` (401)：用户不存在 **或** 密码错误（同一码，防枚举）

## 5. 端口
- `users: UserStore` —— 按邮箱查用户
- `sessions: SessionStore` —— 创建会话
- `hasher: PasswordHasher` —— 校验密码哈希
- `logger: Logger` —— 记录登录事件
- `now: () => Date` + `sessionTtlMs: number` —— 会话过期计算（组合根注入）

## 6. 不变量 / 边界情况
- 用户不存在与密码错误返回**同一个**错误码
- 返回的 user 不含 `passwordHash`
- 会话过期时间 = `now() + sessionTtlMs`
- 明文密码绝不入日志
- 【不】负责：注册、会话的销毁、记住我/多设备策略（那是会话 TTL 配置的事）
