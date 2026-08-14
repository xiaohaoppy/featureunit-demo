# 契约规格：register-user（v1.0）

## 1. 一句话目标
注册新用户：校验邮箱与密码，密码只存哈希，返回用户 id。

## 2. 输入
- `email`：合法邮箱格式（zod 兜底，非法的请求到不了单元）
- `password`：8–128 位（边界校验在组合根层完成）

## 3. 输出
成功 → `{ id, email }`。失败 → 抛 AppError，见错误码。

## 4. 错误码
- `INVALID_INPUT` (400)：email 非法 / 密码过短过长（组合根 zod 兜底）
- `EMAIL_TAKEN` (409)：邮箱已注册

## 5. 端口
- `users: UserStore` —— 查重 + 创建
- `hasher: PasswordHasher` —— 哈希密码（单元不关心算法）
- `logger: Logger` —— 记录业务事件

## 6. 不变量 / 边界情况
- 邮箱已存在 → `EMAIL_TAKEN`，且不覆盖原用户
- 存储的必须是哈希，明文绝不落库、绝不入日志
- 返回结果不含 `passwordHash`
- 【不】负责：邮箱验证、密码强度策略（除长度外）、登录、会话
